'use strict';

const TRANSPORT_ALIASES = {
  stdio: 'stdio',
  'stdio://': 'stdio',
  ws: 'ws',
  websocket: 'ws',
  'ws://': 'ws',
};

const NOTIFICATION_ALIASES = {
  'thread/created': 'thread/started',
  'thread/resumed': 'thread/started',
  'thread/forked': 'thread/started',
  'request/resolved': 'serverRequest/resolved',
};

function normalizeTransportName(value) {
  const text = String(value || 'stdio').trim().toLowerCase();
  return TRANSPORT_ALIASES[text] || 'stdio';
}

function normalizeParams(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function canonicalNotificationMethod(method) {
  const text = typeof method === 'string' ? method : '';
  return NOTIFICATION_ALIASES[text] || text;
}

function isResponseMessage(msg) {
  return !!msg && typeof msg === 'object' && ('result' in msg || 'error' in msg) && 'id' in msg;
}

function isServerRequestMessage(msg) {
  return !!msg && typeof msg === 'object' && typeof msg.method === 'string' && 'id' in msg && msg.id !== null && msg.id !== undefined;
}

function isNotificationMessage(msg) {
  return !!msg && typeof msg === 'object' && typeof msg.method === 'string' && !('id' in msg);
}

function classifyServerRequestKind(method) {
  const text = String(method || '').toLowerCase();
  if (text.includes('commandexecution') || text.includes('exec')) return 'command';
  if (text.includes('filechange')) return 'fileChange';
  if (text.includes('permission')) return 'permissions';
  if (text.includes('userinput')) return 'userInput';
  if (text.includes('tool')) return 'tool';
  return 'generic';
}

function normalizeNotification(msg) {
  const params = normalizeParams(msg && msg.params);
  const rawMethod = msg && typeof msg.method === 'string' ? msg.method : '';
  const method = canonicalNotificationMethod(rawMethod);
  const next = {
    ...msg,
    method,
    params,
  };

  if (rawMethod && rawMethod !== method) {
    next.compat = {
      ...(next.compat || {}),
      rawMethod,
      canonicalMethod: method,
    };
  }

  return next;
}

function normalizeServerRequest(msg) {
  const params = normalizeParams(msg && msg.params);
  return {
    ...msg,
    params,
    compat: {
      ...(msg && msg.compat ? msg.compat : {}),
      requestKind: classifyServerRequestKind(msg && msg.method),
    },
  };
}

function extractSessionStateFromNotification(msg) {
  const normalized = normalizeNotification(msg);
  if (normalized.method !== 'thread/started') return null;

  const params = normalized.params;
  const thread = params.thread && typeof params.thread === 'object' ? params.thread : null;
  const threadId = (thread && thread.id) || params.threadId || null;
  const cwd = (thread && thread.cwd) || params.cwd || null;

  return {
    threadId,
    cwd,
  };
}

function normalizeInitializeResult(result) {
  if (!result || typeof result !== 'object') return {};
  return {
    ...result,
    platformOs: result.platformOs || result.platform || result.os || '',
    userAgent: result.userAgent || result.serverInfo || result.version || '',
  };
}

module.exports = {
  normalizeTransportName,
  isResponseMessage,
  isServerRequestMessage,
  isNotificationMessage,
  normalizeNotification,
  normalizeServerRequest,
  extractSessionStateFromNotification,
  normalizeInitializeResult,
  classifyServerRequestKind,
};
