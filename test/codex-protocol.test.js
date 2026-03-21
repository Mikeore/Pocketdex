const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTransportName,
  normalizeNotification,
  normalizeServerRequest,
  extractSessionStateFromNotification,
} = require('../src/codex-protocol');

test('defaults unknown transport values to stdio', () => {
  assert.equal(normalizeTransportName(undefined), 'stdio');
  assert.equal(normalizeTransportName('stdio://'), 'stdio');
  assert.equal(normalizeTransportName('websocket'), 'ws');
  assert.equal(normalizeTransportName('weird-future-thing'), 'stdio');
});

test('normalizes compatible notification aliases without dropping raw method', () => {
  const msg = normalizeNotification({ method: 'thread/resumed', params: { threadId: 'thr_123' } });
  assert.equal(msg.method, 'thread/started');
  assert.equal(msg.compat.rawMethod, 'thread/resumed');
  assert.equal(msg.compat.canonicalMethod, 'thread/started');
});

test('extracts session state from normalized thread lifecycle notifications', () => {
  const state = extractSessionStateFromNotification({
    method: 'thread/created',
    params: { thread: { id: 'thr_123', cwd: '/tmp/demo' } },
  });
  assert.deepEqual(state, { threadId: 'thr_123', cwd: '/tmp/demo' });
});

test('classifies server requests into stable UI-friendly kinds', () => {
  const req = normalizeServerRequest({ method: 'item/commandExecution/requestApproval', id: 7, params: {} });
  assert.equal(req.compat.requestKind, 'command');
});
