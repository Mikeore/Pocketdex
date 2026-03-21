/**
 * qr-auth.js
 *
 * Authentication model:
 * - QR codes carry a short-lived one-time pairing token.
 * - The first successful pairing exchanges that token for a longer-lived
 *   device session token stored on the phone for reconnects and one-tap return.
 * - Session tokens are signed with a persistent secret so they survive
 *   PocketDex restarts on the same machine.
 */

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');

const PAIR_TOKEN_TTL = parseInt(process.env.POCKETDEX_TOKEN_TTL || '900', 10);
const SESSION_TOKEN_TTL = parseInt(
  process.env.POCKETDEX_SESSION_TTL || String(60 * 60 * 24 * 30),
  10
);
const TOKEN_USE_PAIRING = 'pocketdex-pairing';
const TOKEN_USE_SESSION = 'pocketdex-session';
const TOKEN_USE_PAIRING_CODE = 'p';
const TOKEN_USE_SESSION_CODE = 's';
const AUTH_STATE_PATH = process.env.POCKETDEX_AUTH_STATE_PATH ||
  path.join(os.homedir(), '.codex', 'pocketdex-auth.json');

const _authState = loadOrCreateAuthState();
const _usedPairingTokens = _authState.usedPairingTokens;
const _secret = _authState.secret;

function readAuthStateFile() {
  try {
    const raw = fs.readFileSync(AUTH_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(
        `[pocketdex] auth state file unreadable (${err.code || err.message}) — ` +
        'generating new credentials. Paired devices will need to re-scan the QR code.'
      );
    }
    return null;
  }
}

function normalizeUsedPairingTokens(value) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const normalized = new Map();
  if (!value) return normalized;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.jti === 'string' && Number.isFinite(entry.exp) && entry.exp > nowSeconds) {
        normalized.set(entry.jti, entry.exp);
      }
    }
    return normalized;
  }

  if (typeof value !== 'object') return normalized;

  for (const [jti, exp] of Object.entries(value)) {
    if (typeof jti !== 'string' || !Number.isFinite(exp) || exp <= nowSeconds) continue;
    normalized.set(jti, exp);
  }
  return normalized;
}

function serializeUsedPairingTokens(usedPairingTokens) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const serialized = {};
  for (const [jti, exp] of usedPairingTokens.entries()) {
    if (typeof jti === 'string' && Number.isFinite(exp) && exp > nowSeconds) {
      serialized[jti] = exp;
    }
  }
  return serialized;
}

function writeAuthStateFile(state) {
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  fs.writeFileSync(
    AUTH_STATE_PATH,
    JSON.stringify({
      secret: state.secret,
      createdAt: state.createdAt,
      usedPairingTokens: serializeUsedPairingTokens(state.usedPairingTokens),
    }, null, 2),
    { encoding: 'utf8', mode: 0o600 }
  );
}

function loadOrCreateAuthState() {
  const existing = readAuthStateFile();
  const secret = process.env.POCKETDEX_AUTH_SECRET ||
    (existing && typeof existing.secret === 'string' && existing.secret.length >= 32
      ? existing.secret
      : crypto.randomBytes(32).toString('hex'));
  const state = {
    secret,
    createdAt: existing && typeof existing.createdAt === 'string'
      ? existing.createdAt
      : new Date().toISOString(),
    usedPairingTokens: normalizeUsedPairingTokens(existing && existing.usedPairingTokens),
  };

  if (!existing || existing.secret !== state.secret) {
    writeAuthStateFile(state);
    return state;
  }

  const persistedTokens = serializeUsedPairingTokens(state.usedPairingTokens);
  const existingTokens = serializeUsedPairingTokens(normalizeUsedPairingTokens(existing.usedPairingTokens));
  if (JSON.stringify(existingTokens) !== JSON.stringify(persistedTokens)) {
    writeAuthStateFile(state);
  }
  return state;
}

function persistUsedPairingTokens() {
  writeAuthStateFile({
    secret: _secret,
    createdAt: _authState.createdAt,
    usedPairingTokens: _usedPairingTokens,
  });
}

function pruneExpiredPairingTokens() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const [jti, exp] of _usedPairingTokens.entries()) {
    if (!Number.isFinite(exp) || exp <= nowSeconds) {
      _usedPairingTokens.delete(jti);
      changed = true;
    }
  }
  if (changed) persistUsedPairingTokens();
}

function verifyTokenShape(token, expectedUse) {
  const payload = jwt.verify(token, _secret);
  const normalizedUse = normalizeTokenUse(payload);
  if (!payload || normalizedUse !== expectedUse) {
    throw new Error('Token type mismatch');
  }
  return normalizeVerifiedPayload(payload, normalizedUse);
}

function normalizeTokenUse(payload) {
  const rawUse = payload && typeof payload === 'object'
    ? (payload.use || payload.u || '')
    : '';
  if (rawUse === TOKEN_USE_PAIRING || rawUse === TOKEN_USE_PAIRING_CODE) {
    return TOKEN_USE_PAIRING;
  }
  if (rawUse === TOKEN_USE_SESSION || rawUse === TOKEN_USE_SESSION_CODE) {
    return TOKEN_USE_SESSION;
  }
  return rawUse;
}

function normalizeVerifiedPayload(payload, normalizedUse) {
  return {
    ...payload,
    use: normalizedUse,
    jti: payload.jti || payload.j,
    deviceId: payload.deviceId || payload.d,
  };
}

function parseIPv4(address) {
  if (typeof address !== 'string') return null;
  const parts = address.trim().split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return octets;
}

function isPrivateIPv4(address) {
  const octets = parseIPv4(address);
  if (!octets) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return false;
}

function scoreInterfaceCandidate(ifaceName, alias) {
  let score = 0;
  const name = String(ifaceName || '').toLowerCase();
  const address = alias && alias.address ? alias.address : '';

  if (isPrivateIPv4(address)) score += 400;
  if (/^192\.168\./.test(address)) score += 40;
  if (/^(10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address)) score += 20;

  if (/(wi-?fi|wlan|wireless)/.test(name)) score += 220;
  if (/(ethernet|eth|lan|^en\d)/.test(name)) score += 160;
  if (/(docker|wsl|tailscale|vpn|virtual|vmware|hyper-v|vethernet|hamachi|zerotier|loopback|bridge|^br-|tap|tun)/.test(name)) {
    score -= 500;
  }

  return score;
}

/**
 * Find the primary non-loopback IPv4 address.
 * @returns {string}
 */
function getLocalIP() {
  if (process.env.POCKETDEX_HOST) return process.env.POCKETDEX_HOST;
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [ifaceName, iface] of Object.entries(ifaces)) {
    for (const alias of iface || []) {
      if (alias.family === 'IPv4' && !alias.internal && parseIPv4(alias.address)) {
        candidates.push({
          address: alias.address,
          score: scoreInterfaceCandidate(ifaceName, alias),
        });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length > 0) return candidates[0].address;
  return '127.0.0.1';
}

/**
 * Generate a short-lived JWT used only for initial QR pairing.
 * @returns {string}
 */
function generatePairingToken() {
  return jwt.sign(
    { u: TOKEN_USE_PAIRING_CODE, j: crypto.randomBytes(8).toString('hex') },
    _secret,
    { expiresIn: PAIR_TOKEN_TTL }
  );
}

/**
 * Verify a one-time pairing token. Throws if invalid, expired, or consumed.
 * @param {string} token
 * @returns {object}
 */
function verifyPairingToken(token) {
  const payload = verifyTokenShape(token, TOKEN_USE_PAIRING);
  pruneExpiredPairingTokens();
  if (_usedPairingTokens.has(payload.jti)) {
    throw new Error('Token already used');
  }
  return payload;
}

/**
 * Mark a pairing token as consumed.
 * @param {string} token
 */
function consumePairingToken(token) {
  const payload = verifyTokenShape(token, TOKEN_USE_PAIRING);
  pruneExpiredPairingTokens();
  _usedPairingTokens.set(
    payload.jti,
    typeof payload.exp === 'number' ? payload.exp : Math.floor(Date.now() / 1000) + PAIR_TOKEN_TTL
  );
  persistUsedPairingTokens();
}

/**
 * Generate a persistent device session token.
 * @param {string} deviceId
 * @returns {string}
 */
function generateSessionToken(deviceId) {
  return jwt.sign(
    { u: TOKEN_USE_SESSION_CODE, d: deviceId },
    _secret,
    { expiresIn: SESSION_TOKEN_TTL }
  );
}

/**
 * Verify a device session token.
 * @param {string} token
 * @returns {{ use: string, deviceId: string }}
 */
function verifySessionToken(token) {
  return verifyTokenShape(token, TOKEN_USE_SESSION);
}

/**
 * Exchange a valid pairing token for a longer-lived device session token.
 * @param {string} token
 * @returns {{ sessionToken: string, deviceId: string }}
 */
function issueSessionTokenFromPairingToken(token) {
  verifyPairingToken(token);
  consumePairingToken(token);
  const deviceId = crypto.randomUUID();
  return {
    sessionToken: generateSessionToken(deviceId),
    deviceId,
  };
}

/**
 * Rotate a device session token while keeping the same device identity.
 * @param {string} token
 * @returns {{ sessionToken: string, deviceId: string }}
 */
function refreshSessionToken(token) {
  const payload = verifySessionToken(token);
  return {
    sessionToken: generateSessionToken(payload.deviceId),
    deviceId: payload.deviceId,
  };
}

/**
 * Generate a fresh pairing token, encode it in a URL, and print the QR code.
 * @param {number} port
 * @returns {Promise<string>}
 */
async function printQR(port) {
  const ip = getLocalIP();
  const token = generatePairingToken();
  const url = `http://${ip}:${port}/?token=${token}`;

  const qrString = await QRCode.toString(url, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'L',
    margin: 1,
  });

  console.log('\n' + '═'.repeat(60));
  console.log('  PocketDex is ready!');
  console.log('═'.repeat(60));
  console.log(qrString);
  console.log('  Scan the QR code or open:\n');
  console.log(`  ${url}\n`);
  console.log(`  Pairing link expires in ${Math.round(PAIR_TOKEN_TTL / 60)} minutes.`);
  console.log(`  Saved mobile sessions stay signed in for ${Math.round(SESSION_TOKEN_TTL / 86400)} days.`);
  console.log('═'.repeat(60) + '\n');

  return url;
}

/**
 * Generate a fresh pairing token (same as what printQR uses internally).
 * Useful for re-issuing a QR code on demand without restarting PocketDex.
 * @returns {string}
 */
function generateFreshToken() {
  return generatePairingToken();
}

module.exports = {
  AUTH_STATE_PATH,
  SESSION_TOKEN_TTL,
  PAIR_TOKEN_TTL,
  getLocalIP,
  generatePairingToken,
  generateFreshToken,
  verifyPairingToken,
  consumePairingToken,
  generateSessionToken,
  verifySessionToken,
  issueSessionTokenFromPairingToken,
  refreshSessionToken,
  printQR,
};
