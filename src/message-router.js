/**
 * message-router.js
 *
 * Central message bus between Codex app-server and PWA clients.
 */

const { EventEmitter } = require('events');
const { getDismissDecision } = require('../shared/approval-protocol');
const {
  normalizeNotification,
  normalizeServerRequest,
  extractSessionStateFromNotification,
} = require('./codex-protocol');

const _rawGraceMs = parseInt(process.env.POCKETDEX_APPROVAL_GRACE_MS || '15000', 10);
const AUTO_REJECT_GRACE_MS = Number.isFinite(_rawGraceMs) && _rawGraceMs >= 100
  ? _rawGraceMs
  : 15000;


function sanitizeApprovalResult(result) {
  if (result == null) return {};
  if (typeof result !== 'object' || Array.isArray(result)) return null;
  if (Object.prototype.hasOwnProperty.call(result, 'decision') && typeof result.decision !== 'string') {
    return null;
  }
  return { ...result };
}

class MessageRouter extends EventEmitter {
  constructor(codexClient, io, appendLog) {
    super();
    this.codex = codexClient;
    this.io = io;
    this._pendingApprovals = new Map();
    this._threadId = null;
    this._cwd = process.cwd();
    this._autoRejectTimer = null;
    const _rawTimeoutMs = parseInt(process.env.POCKETDEX_APPROVAL_TIMEOUT_MS || '300000', 10);
    this._approvalTimeoutMs = Number.isFinite(_rawTimeoutMs) && _rawTimeoutMs >= 1000
      ? _rawTimeoutMs
      : 300000;
    this._appendLog = typeof appendLog === 'function' ? appendLog : () => {};
  }

  init() {
    this._subscribeCodex();

    this.io.on('connection', (socket) => {
      this._cancelAutoReject();

      socket.on('request', (payload = {}) => {
        const { method, params, clientRequestId } = payload || {};
        if (typeof method !== 'string' || !method) return;
        if (method === 'turn/start') {
          this._appendLog({ type: 'userMessage', params, ts: Date.now() });
        }
        this.codex.sendRequest(method, params).then((result) => {
          socket.emit('request_result', { method, result, clientRequestId });
        }).catch((err) => {
          socket.emit('request_error', { method, error: err.message, clientRequestId });
        });
      });

      socket.on('approval_response', (payload = {}) => {
        const { id, result } = payload || {};
        if (id === undefined || id === null) return;
        if (!this._pendingApprovals.has(id)) {
          console.warn(`[router] received approval for unknown id ${id}`);
          return;
        }
        const safeResult = sanitizeApprovalResult(result);
        if (safeResult === null) {
          console.warn(`[router] rejected malformed approval result for id ${id}`);
          socket.emit('request_error', {
            method: 'approval_response',
            error: 'Malformed approval response',
            clientRequestId: payload && payload.clientRequestId,
          });
          return;
        }
        const entry = this._pendingApprovals.get(id);
        clearTimeout(entry.timer);
        this._pendingApprovals.delete(id);
        this.codex.sendResponse(id, safeResult);
      });

      socket.on('disconnect', () => {
        const remaining = this.io.sockets.adapter.rooms.get('authenticated');
        if (!remaining || remaining.size === 0) {
          this._scheduleAutoReject('All phone clients disconnected');
        }
      });

      for (const entry of this._pendingApprovals.values()) {
        socket.emit('approval_request', this._attachApprovalMeta(entry.req, entry.expiresAt));
      }
    });
  }

  _attachApprovalMeta(req, expiresAt) {
    return {
      ...req,
      timeoutMs: Math.max(0, expiresAt - Date.now()),
      expiresAt,
    };
  }

  _subscribeCodex() {
    this.codex.on('notification', (incoming) => {
      const msg = normalizeNotification(incoming);
      const state = extractSessionStateFromNotification(msg);
      if (state) {
        if (state.threadId) this._threadId = state.threadId;
        if (state.cwd) this._cwd = state.cwd;
      }
      if (msg.method === 'serverRequest/resolved') {
        const requestId = msg.params && msg.params.requestId;
        if (requestId !== undefined && requestId !== null) {
          const entry = this._pendingApprovals.get(requestId);
          if (entry) clearTimeout(entry.timer);
          this._pendingApprovals.delete(requestId);
        }
      }
      this._appendLog({ type: 'notification', method: msg.method, params: msg.params, ts: Date.now() });
      this.io.to('authenticated').emit('notification', msg);
    });

    this.codex.on('serverRequest', (incoming) => {
      const msg = normalizeServerRequest(incoming);
      const expiresAt = Date.now() + this._approvalTimeoutMs;
      const timer = setTimeout(() => {
        if (this._pendingApprovals.has(msg.id)) {
          console.warn(`[router] approval timeout for id=${msg.id}`);
          this._pendingApprovals.delete(msg.id);
          this.io.to('authenticated').emit('approval_timeout', { id: msg.id, expiresAt });
          try {
            this.codex.sendResponse(msg.id, { decision: getDismissDecision(msg) });
          } catch (_) {}
        }
      }, this._approvalTimeoutMs);
      this._pendingApprovals.set(msg.id, { req: msg, timer, expiresAt });
      const emittedReq = this._attachApprovalMeta(msg, expiresAt);
      this.io.to('authenticated').emit('approval_request', emittedReq);
      this.emit('approval_request', emittedReq);
    });

    this.codex.on('disconnected', () => {
      this._threadId = null;
      this.io.to('authenticated').emit('codex_disconnected');
      this._autoRejectAll('Codex disconnected');
    });
  }

  replaceCodexClient(newClient) {
    this.codex.removeAllListeners('notification');
    this.codex.removeAllListeners('serverRequest');
    this.codex.removeAllListeners('disconnected');
    this.codex = newClient;
    this._subscribeCodex();
  }

  getState() {
    return { threadId: this._threadId, cwd: this._cwd };
  }

  _autoRejectAll(reason) {
    this._cancelAutoReject();
    if (this._pendingApprovals.size === 0) return;
    console.warn(`[router] auto-rejecting ${this._pendingApprovals.size} pending approvals: ${reason}`);
    for (const [id, { req, timer }] of this._pendingApprovals) {
      clearTimeout(timer);
      this.codex.sendResponse(id, { decision: getDismissDecision(req) });
    }
    this._pendingApprovals.clear();
  }

  _scheduleAutoReject(reason) {
    if (this._pendingApprovals.size === 0) return;
    this._cancelAutoReject();
    this._autoRejectTimer = setTimeout(() => {
      this._autoRejectTimer = null;
      this._autoRejectAll(reason);
    }, AUTO_REJECT_GRACE_MS);
  }

  _cancelAutoReject() {
    if (this._autoRejectTimer) {
      clearTimeout(this._autoRejectTimer);
      this._autoRejectTimer = null;
    }
  }
}

module.exports = { MessageRouter };
