/**
 * codex-client.js
 *
 * PocketDex talks to `codex app-server` over either:
 * - stdio JSONL (default, preferred)
 * - WebSocket (optional compatibility / debug transport)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const {
  normalizeTransportName,
  isResponseMessage,
  isServerRequestMessage,
  isNotificationMessage,
  normalizeNotification,
  normalizeServerRequest,
  normalizeInitializeResult,
} = require('./codex-protocol');

const INIT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.POCKETDEX_CODEX_REQUEST_TIMEOUT_MS || '120000', 10);
const PACKAGE_JSON = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
);
const CLIENT_INFO = {
  name: 'pocketdex',
  title: 'PocketDex',
  version: PACKAGE_JSON.version || '0.1.0',
};

function humanizeErrorIdentifier(value) {
  const text = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractCodexErrorText(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error.trim();
  if (typeof error === 'number' || typeof error === 'boolean') return String(error);
  if (Array.isArray(error)) {
    for (const item of error) {
      const text = extractCodexErrorText(item);
      if (text) return text;
    }
    return '';
  }
  if (typeof error !== 'object') return String(error).trim();

  const fields = ['message', 'error', 'title', 'detail', 'details', 'description', 'reason'];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(error, field)) continue;
    const text = extractCodexErrorText(error[field]);
    if (text) return text;
  }

  if (Object.prototype.hasOwnProperty.call(error, 'codexErrorInfo')) {
    const text = extractCodexErrorText(error.codexErrorInfo);
    if (text) return text;
  }

  const codeText = typeof error.code === 'string' ? humanizeErrorIdentifier(error.code) : '';
  const httpStatus = Number.isFinite(error.httpStatusCode) ? error.httpStatusCode : null;
  if (codeText && httpStatus !== null) return `${codeText} (HTTP ${httpStatus})`;
  if (codeText) return codeText;
  if (httpStatus !== null) return `HTTP ${httpStatus}`;

  const entries = Object.entries(error);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    const keyText = humanizeErrorIdentifier(key);
    const valueText = extractCodexErrorText(value);
    if (keyText && valueText && valueText !== keyText) return `${keyText}: ${valueText}`;
    return keyText || valueText;
  }

  return '';
}

function createCodexRpcError(errorPayload) {
  const errorText = extractCodexErrorText(errorPayload) || 'Codex request failed';
  const error = new Error(errorText);
  error.codexError = errorPayload;
  return error;
}

class BaseCodexClient extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = normalizeTransportName(transport);
    this._pending = new Map();
    this._nextId = 1;
    this._ready = false;
  }

  async _performInitializeHandshake() {
    const result = normalizeInitializeResult(await this.sendRequest('initialize', {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: false },
    }, { timeoutMs: INIT_TIMEOUT_MS }));

    this.sendNotification('initialized', {});
    this._ready = true;
    this.emit('ready', result);
    return result;
  }

  _handleMessage(msg) {
    if (isResponseMessage(msg)) {
      const pending = this._pending.get(msg.id);
      if (!pending) {
        console.warn('[codex-client] received response for unknown id:', msg.id);
        return;
      }
      this._pending.delete(msg.id);
      if (pending.timer) clearTimeout(pending.timer);
      if ('error' in msg) {
        pending.reject(createCodexRpcError(msg.error));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (isServerRequestMessage(msg)) {
      this.emit('serverRequest', normalizeServerRequest(msg));
      return;
    }

    if (isNotificationMessage(msg)) {
      this.emit('notification', normalizeNotification(msg));
      return;
    }

    console.warn('[codex-client] unrecognised message shape:', JSON.stringify(msg).slice(0, 120));
  }

  sendRequest(method, params, options = {}) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(0, options.timeoutMs)
        : REQUEST_TIMEOUT_MS;
      const pending = { resolve, reject, timer: null };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new Error(`Timed out waiting for Codex response to ${method}`));
        }, timeoutMs);
      }
      this._pending.set(id, pending);
      try {
        this._send({ method, id, params: params || {} });
      } catch (err) {
        this._pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(err);
      }
    });
  }

  sendResponse(id, result) {
    this._send({ id, result: result == null ? {} : result });
  }

  sendNotification(method, params) {
    this._send({ method, params: params || {} });
  }

  _rejectPending(reason) {
    const entries = Array.from(this._pending.values());
    this._pending.clear();
    for (const pending of entries) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  }
}

class WsCodexClient extends BaseCodexClient {
  constructor(options) {
    super('ws');
    this.port = options.port;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}`;
      console.log(`[codex-client] connecting over websocket: ${url}`);
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for Codex initialize response'));
        if (this.ws) this.ws.close();
      }, INIT_TIMEOUT_MS);

      this.ws.on('open', () => {
        this._performInitializeHandshake().then((result) => {
          clearTimeout(timeout);
          console.log(
            `[codex-client] initialized (${this.transport}) — platform=${result.platformOs}, agent=${result.userAgent}`
          );
          resolve(result);
        }).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          console.warn('[codex-client] received non-JSON WS message:', data.toString().slice(0, 100));
          return;
        }
        this._handleMessage(msg);
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.ws.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[codex-client] disconnected (${this.transport}, code=${code})`);
        this._rejectPending('WebSocket closed');
        this.emit('disconnected');
      });
    });
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(obj));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'PocketDex shutting down');
      this.ws = null;
    }
  }
}

class StdioCodexClient extends BaseCodexClient {
  constructor(options) {
    super('stdio');
    this.child = options.proc;
    this.rl = null;
    this._onExit = null;
    this._onError = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin || !this.child.stdout) {
        reject(new Error('Codex stdio process is not available'));
        return;
      }

      console.log('[codex-client] connecting over stdio JSONL');

      this.rl = readline.createInterface({ input: this.child.stdout });
      this.rl.on('line', (line) => {
        const text = String(line || '').trim();
        if (!text) return;
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          console.warn('[codex-client] received non-JSON stdio line:', text.slice(0, 120));
          return;
        }
        this._handleMessage(msg);
      });

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for Codex initialize response'));
      }, INIT_TIMEOUT_MS);

      this._onExit = (code, signal) => {
        clearTimeout(timeout);
        console.log(`[codex-client] disconnected (${this.transport}, code=${code}, signal=${signal})`);
        this._rejectPending('Codex stdio process exited');
        this.emit('disconnected');
      };
      this._onError = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      this.child.once('exit', this._onExit);
      this.child.once('error', this._onError);

      this._performInitializeHandshake().then((result) => {
        clearTimeout(timeout);
        console.log(
          `[codex-client] initialized (${this.transport}) — platform=${result.platformOs}, agent=${result.userAgent}`
        );
        resolve(result);
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  _send(obj) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('Codex stdio stdin is not available');
    }
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  disconnect() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.child && this._onExit) {
      this.child.off('exit', this._onExit);
      this._onExit = null;
    }
    if (this.child && this._onError) {
      this.child.off('error', this._onError);
      this._onError = null;
    }
  }
}

function createCodexClient(options) {
  const transport = normalizeTransportName(options && options.transport);
  if (transport === 'ws') return new WsCodexClient(options || {});
  return new StdioCodexClient(options || {});
}

module.exports = {
  BaseCodexClient,
  WsCodexClient,
  StdioCodexClient,
  createCodexClient,
  createCodexRpcError,
  extractCodexErrorText,
};
