const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function loadQrAuth(tempDir, secret) {
  const authStatePath = path.join(tempDir, 'pocketdex-auth.json');
  process.env.POCKETDEX_AUTH_SECRET = secret;
  process.env.POCKETDEX_AUTH_STATE_PATH = authStatePath;
  delete require.cache[require.resolve('../src/qr-auth')];
  return require('../src/qr-auth');
}

test.afterEach(() => {
  delete process.env.POCKETDEX_AUTH_SECRET;
  delete process.env.POCKETDEX_AUTH_STATE_PATH;
  delete process.env.POCKETDEX_HOST;
  delete require.cache[require.resolve('../src/qr-auth')];
});

test('pairing token exchanges into a reusable device session token', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  const auth = loadQrAuth(tempDir, 'test-secret-for-pocketdex-auth-module-32bytes');
  const pairingToken = auth.generatePairingToken();
  const { sessionToken, deviceId } = auth.issueSessionTokenFromPairingToken(pairingToken);
  const payload = auth.verifySessionToken(sessionToken);

  assert.equal(payload.use, 'pocketdex-session');
  assert.equal(payload.deviceId, deviceId);
});

test('pairing tokens are one-time use', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  const auth = loadQrAuth(tempDir, 'test-secret-for-pocketdex-auth-module-32bytes');
  const pairingToken = auth.generatePairingToken();
  auth.issueSessionTokenFromPairingToken(pairingToken);

  assert.throws(() => auth.verifyPairingToken(pairingToken), /already used/i);
});

test('used pairing tokens stay consumed after module reload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  const secret = 'test-secret-for-pocketdex-auth-module-32bytes';
  const firstLoad = loadQrAuth(tempDir, secret);
  const pairingToken = firstLoad.generatePairingToken();
  firstLoad.issueSessionTokenFromPairingToken(pairingToken);

  const secondLoad = loadQrAuth(tempDir, secret);
  assert.throws(() => secondLoad.verifyPairingToken(pairingToken), /already used/i);
});

test('refreshing a session keeps the same device identity', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  const auth = loadQrAuth(tempDir, 'test-secret-for-pocketdex-auth-module-32bytes');
  const pairingToken = auth.generatePairingToken();
  const { sessionToken, deviceId } = auth.issueSessionTokenFromPairingToken(pairingToken);
  const rotated = auth.refreshSessionToken(sessionToken);

  assert.equal(rotated.deviceId, deviceId);
  assert.equal(auth.verifySessionToken(rotated.sessionToken).deviceId, deviceId);
});

test('verifySessionToken accepts legacy session tokens', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  const secret = 'test-secret-for-pocketdex-auth-module-32bytes';
  const auth = loadQrAuth(tempDir, secret);
  const legacyToken = jwt.sign(
    { use: 'pocketdex-session', deviceId: 'legacy-device-id' },
    secret,
    { expiresIn: 60 }
  );

  const payload = auth.verifySessionToken(legacyToken);
  assert.equal(payload.use, 'pocketdex-session');
  assert.equal(payload.deviceId, 'legacy-device-id');
});

test('getLocalIP prefers a private Wi-Fi address over virtual adapters', () => {
  const original = os.networkInterfaces;
  os.networkInterfaces = () => ({
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.22.224.1' }],
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.24' }],
    DockerNAT: [{ family: 'IPv4', internal: false, address: '10.0.75.1' }],
  });

  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
    const auth = loadQrAuth(tempDir, 'test-secret-for-pocketdex-auth-module-32bytes');
    assert.equal(auth.getLocalIP(), '192.168.0.24');
  } finally {
    os.networkInterfaces = original;
  }
});

test('printQR uses query-string tokens for better mobile scanner compatibility', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocketdex-auth-'));
  process.env.POCKETDEX_HOST = '192.168.0.24';
  const auth = loadQrAuth(tempDir, 'test-secret-for-pocketdex-auth-module-32bytes');
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));

  try {
    const url = await auth.printQR(3000);
    assert.match(url, /^http:\/\/192\.168\.0\.24:3000\/\?token=/);
    assert.doesNotMatch(url, /#token=/);
  } finally {
    console.log = originalLog;
  }

  assert.ok(lines.some((line) => line.includes('Scan the QR code or open:')));
});
