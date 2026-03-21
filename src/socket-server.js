/**
 * socket-server.js
 *
 * Express + Socket.IO server that:
 * - Serves the static PWA from client/
 * - Accepts Socket.IO connections from phone browsers
 * - Validates JWT on connection (via qr-auth.js)
 * - Adds authenticated sockets to the 'authenticated' room
 * - Sends current session state (threadId, cwd) to each new connection
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
  verifySessionToken,
  issueSessionTokenFromPairingToken,
  refreshSessionToken,
} = require('./qr-auth');

/**
 * Create the Express/Socket.IO server.
 * @param {number} port — used only for logging; actual listen is called by caller
 * @param {() => { threadId: string|null, cwd: string }} [getState] — callback to retrieve current session state
 * @param {{ refreshQR?: function }} [options] — optional callbacks
 * @returns {{ httpServer: http.Server, io: Server }}
 */
function createServer(port, getState, options) {
  options = options || {};
  const app = express();

  const allowedOrigins = new Set(
    String(process.env.POCKETDEX_ALLOWED_ORIGINS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  function isAllowedOrigin(origin, requestHost) {
    if (!origin) return true;
    if (allowedOrigins.has(origin)) return true;
    try {
      const parsed = new URL(origin);
      return !!requestHost && parsed.host === requestHost;
    } catch {
      return false;
    }
  }

  // Serve the PWA statically
  app.use(express.static(path.join(__dirname, '..', 'client')));
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      methods: ['GET', 'POST'],
      origin: true,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers && req.headers.origin;
      const host = req.headers && req.headers.host;
      if (isAllowedOrigin(origin, host)) return callback(null, true);
      return callback('Origin not allowed by PocketDex', false);
    },
  });

  // Auth middleware: accept either a saved session token or a one-time pairing token.
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const credential = auth.token;
    if (!credential) {
      return next(new Error('No saved session found. Scan the PocketDex QR code to connect.'));
    }

    try {
      const refreshed = refreshSessionToken(credential);
      socket.data.deviceId = refreshed.deviceId;
      socket.data.sessionToken = refreshed.sessionToken;
      socket.data.authMode = 'session';
      next();
      return;
    } catch {
      // Fall back to first-time pairing below.
    }

    try {
      const paired = issueSessionTokenFromPairingToken(credential);
      socket.data.deviceId = paired.deviceId;
      socket.data.sessionToken = paired.sessionToken;
      socket.data.authMode = 'pairing';
      next();
    } catch (err) {
      next(new Error(`Auth failed: ${err.message}`));
    }
  });

  io.on('connection', (socket) => {
    socket.join('authenticated');
    console.log(`[socket] phone connected: ${socket.id}`);
    socket.emit('auth/session', {
      token: socket.data.sessionToken,
      deviceId: socket.data.deviceId,
      authMode: socket.data.authMode,
    });

    // Send current session state so the phone can resume mid-session
    if (typeof getState === 'function') {
      const state = getState();
      socket.emit('session_state', state);
    }

    socket.on('disconnect', (reason) => {
      console.log(`[socket] phone disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err) => {
      console.error(`[socket] error from ${socket.id}:`, err.message);
    });

    socket.on('token_refresh', () => {
      if (typeof options.refreshQR === 'function') options.refreshQR();
    });
  });

  return { httpServer, io, app };
}

module.exports = { createServer };
