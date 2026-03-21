#!/usr/bin/env node
/**
 * index.js — PocketDex entry point
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CodexProcess, getFreePort } = require('./codex-process');
const { createCodexClient } = require('./codex-client');
const { createServer } = require('./socket-server');
const { MessageRouter } = require('./message-router');
const { printQR } = require('./qr-auth');
const { normalizeTransportName } = require('./codex-protocol');

const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
);
const APP_VERSION = PACKAGE_JSON.version || '0.1.0';

const LOG_ENABLED = process.argv.includes('--log');
const LOG_DIR = path.join(os.homedir(), '.pocketdex', 'logs');
const RUN_DIR = path.join(os.homedir(), '.pocketdex', 'run');
const _rawPort = parseInt(process.env.POCKETDEX_PORT || '3000', 10);
if (!Number.isInteger(_rawPort) || _rawPort < 1 || _rawPort > 65535) {
  console.error(`[pocketdex] Invalid POCKETDEX_PORT: "${process.env.POCKETDEX_PORT}" — must be an integer between 1 and 65535.`);
  process.exit(1);
}
const PORT = _rawPort;
const CODEX_TRANSPORT = normalizeTransportName(
  process.env.POCKETDEX_CODEX_TRANSPORT || 'stdio'
);
const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 5;

let webpush = null;
try { webpush = require('web-push'); } catch (_) { /* optional */ }

const VAPID_FILE = path.join(os.homedir(), '.pocketdex', 'vapid.json');
let vapidKeys = null;
const subscriptions = new Map();
const MAX_PUSH_SUBSCRIPTIONS = parseInt(process.env.POCKETDEX_MAX_PUSH_SUBSCRIPTIONS || '32', 10);
let isShuttingDown = false;
let restartCount = 0;

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function lockFilePath(port) {
  return path.join(RUN_DIR, `pocketdex-${port}.json`);
}

function ensureNoRunningInstance(port) {
  const filePath = lockFilePath(port);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const info = JSON.parse(raw);
    const pid = Number(info && info.pid);
    if (processExists(pid)) {
      throw new Error(`PocketDex is already running on port ${port} (pid ${pid}). Stop it before starting another instance.`);
    }
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    if (err && /already running on port/i.test(err.message || '')) throw err;
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

function acquireInstanceLock(port) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const filePath = lockFilePath(port);
  const payload = {
    pid: process.pid,
    port,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const info = JSON.parse(raw);
      if (Number(info && info.pid) === process.pid) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  };
}

function appendLog(entry) {
  if (!LOG_ENABLED) return;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const date = new Date();
    const fname = date.toISOString().slice(0, 13).replace('T', '-') + '.jsonl';
    fs.appendFileSync(path.join(LOG_DIR, fname), JSON.stringify(entry) + '\n');
  } catch (_) {}
}

function loadOrCreateVapidKeys() {
  if (!webpush) return;
  try {
    const dir = path.dirname(VAPID_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(VAPID_FILE)) {
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    } else {
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), { mode: 0o600 });
    }
    webpush.setVapidDetails('mailto:pocketdex@localhost', vapidKeys.publicKey, vapidKeys.privateKey);
  } catch (err) {
    console.warn('[pocketdex] web-push VAPID setup failed:', err.message);
    vapidKeys = null;
  }
}

function listen(httpServer, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };

    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, host);
  });
}

async function startCodexRuntime() {
  const internalPort = CODEX_TRANSPORT === 'ws' ? await getFreePort() : null;
  const codexProc = new CodexProcess({ transport: CODEX_TRANSPORT, port: internalPort });
  await codexProc.start();
  try {
    const codexClient = createCodexClient(codexProc.getConnectionOptions());
    await codexClient.connect();
    return { codexProc, codexClient };
  } catch (err) {
    codexProc.stop();
    throw err;
  }
}

async function main() {
  console.log(`PocketDex v${APP_VERSION}`);
  console.log(`[pocketdex] codex transport: ${CODEX_TRANSPORT}\n`);

  ensureNoRunningInstance(PORT);

  let { codexProc, codexClient } = await startCodexRuntime();
  let releaseInstanceLock = null;

  const router = new MessageRouter(codexClient, null, appendLog);
  const { httpServer, io, app } = createServer(PORT, () => router.getState(), { refreshQR: refreshQRCode });

  function refreshQRCode() {
    printQR(publicPort).catch((err) => console.error('[pocketdex] QR refresh failed:', err.message));
  }

  loadOrCreateVapidKeys();
  app.use(require('express').json());

  app.get('/push/vapid-key', (_req, res) => {
    if (!vapidKeys) return res.status(404).json({ error: 'web-push not available' });
    res.json({ publicKey: vapidKeys.publicKey });
  });


  function normalizePushSubscription(sub) {
    if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string') return null;
    const endpoint = sub.endpoint.trim();
    if (!endpoint) return null;
    const p256dh = sub.keys && typeof sub.keys === 'object' && typeof sub.keys.p256dh === 'string'
      ? sub.keys.p256dh.trim()
      : '';
    const auth = sub.keys && typeof sub.keys === 'object' && typeof sub.keys.auth === 'string'
      ? sub.keys.auth.trim()
      : '';
    if (!p256dh || !auth) return null;
    return {
      endpoint,
      expirationTime: Number.isFinite(sub.expirationTime) ? sub.expirationTime : null,
      keys: { p256dh, auth },
    };
  }

  function registerPushSubscription(sub) {
    const normalized = normalizePushSubscription(sub);
    if (!normalized || !normalized.endpoint) return false;
    if (!subscriptions.has(normalized.endpoint) && subscriptions.size >= MAX_PUSH_SUBSCRIPTIONS) {
      const oldestKey = subscriptions.keys().next().value;
      if (oldestKey) subscriptions.delete(oldestKey);
    }
    subscriptions.set(normalized.endpoint, JSON.stringify(normalized));
    return true;
  }

  io.on('connection', (socket) => {
    socket.on('push_subscribe', (sub) => {
      registerPushSubscription(sub);
    });
  });

  router.io = io;
  router.init();

  function sendApprovalPush(payload) {
    if (!webpush || !vapidKeys || subscriptions.size === 0) return;
    const message = JSON.stringify(payload);
    const stale = [];
    for (const [endpoint, raw] of subscriptions.entries()) {
      try {
        const sub = JSON.parse(raw);
        webpush.sendNotification(sub, message).catch((err) => {
          if (err.statusCode === 410 || err.statusCode === 404) stale.push(endpoint);
        });
      } catch (_) {
        stale.push(endpoint);
      }
    }
    stale.forEach((endpoint) => subscriptions.delete(endpoint));
  }

  router.on('approval_request', (req) => {
    const requestKind = req && req.compat && req.compat.requestKind;
    const isCmd = requestKind === 'command';
    sendApprovalPush({
      title: 'PocketDex — Approval needed',
      body: isCmd ? 'Codex wants to run a command.' : 'Codex wants your approval.',
    });
  });

  let publicPort = PORT;
  try {
    await listen(httpServer, publicPort, '0.0.0.0');
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      publicPort = await getFreePort();
      ensureNoRunningInstance(publicPort);
      console.warn(`[pocketdex] port ${PORT} is already in use; falling back to ${publicPort}`);
      await listen(httpServer, publicPort, '0.0.0.0');
    } else {
      throw err;
    }
  }
  releaseInstanceLock = acquireInstanceLock(publicPort);
  console.log(`[pocketdex] server listening on port ${publicPort}`);

  await printQR(publicPort);

  async function handleCodexExit(code, signal) {
    if (isShuttingDown) return;

    restartCount += 1;
    if (restartCount > MAX_RESTARTS) {
      console.error(`[pocketdex] Codex exited ${MAX_RESTARTS} times — giving up.`);
      io.to('authenticated').emit('codex_disconnected');
      return;
    }

    console.log(`[pocketdex] Codex exited (code=${code}, signal=${signal}). Restarting in ${RESTART_DELAY_MS / 1000}s... (attempt ${restartCount}/${MAX_RESTARTS})`);
    io.to('authenticated').emit('codex_restarting', { attempt: restartCount, max: MAX_RESTARTS });

    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    if (isShuttingDown) return;

    try {
      const runtime = await startCodexRuntime();
      codexProc = runtime.codexProc;
      codexClient = runtime.codexClient;
      router.replaceCodexClient(codexClient);

      codexProc.on('error', (err) => {
        console.error(`[pocketdex] codex process error: ${err.message}`);
      });
      codexProc.on('exit', (c, s) => handleCodexExit(c, s));

      restartCount = 0;
      console.log('[pocketdex] Codex restarted successfully.');
      io.to('authenticated').emit('codex_reconnected');
    } catch (err) {
      console.error(`[pocketdex] Failed to restart Codex: ${err.message}`);
      io.to('authenticated').emit('codex_disconnected');
    }
  }

  codexProc.on('error', (err) => {
    console.error(`[pocketdex] codex process error: ${err.message}`);
  });
  codexProc.on('exit', (code, signal) => handleCodexExit(code, signal));

  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[pocketdex] shutting down...');
    if (releaseInstanceLock) releaseInstanceLock();
    codexClient.disconnect();
    codexProc.stop();
    // Close Socket.IO before httpServer — otherwise Socket.IO keeps the server alive
    io.close();
    // Force-exit after 5 seconds if graceful close stalls
    const forceExit = setTimeout(() => {
      console.warn('[pocketdex] graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 5000);
    if (forceExit.unref) forceExit.unref();
    httpServer.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };

  process.on('exit', () => {
    if (releaseInstanceLock) releaseInstanceLock();
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('[pocketdex] unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

main().catch((err) => {
  console.error('[pocketdex] fatal error:', err.message);
  process.exit(1);
});
