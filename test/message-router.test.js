const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { MessageRouter } = require('../src/message-router');

class FakeIo extends EventEmitter {
  constructor() {
    super();
    this.emitted = [];
    this.sockets = { adapter: { rooms: new Map([['authenticated', new Set()]]) } };
  }

  to(room) {
    return {
      emit: (event, payload) => {
        this.emitted.push({ room, event, payload });
      },
    };
  }
}

class FakeSocket extends EventEmitter {
  join() {}
}

test('approval requests carry server timeout metadata and emit approval_timeout when they expire', async () => {
  const prev = process.env.POCKETDEX_APPROVAL_TIMEOUT_MS;
  process.env.POCKETDEX_APPROVAL_TIMEOUT_MS = '25';

  const codex = new EventEmitter();
  const responses = [];
  codex.sendRequest = async () => ({});
  codex.sendResponse = (id, result) => responses.push({ id, result });

  const io = new FakeIo();
  const router = new MessageRouter(codex, io, () => {});
  router.init();
  io.emit('connection', new FakeSocket());

  codex.emit('serverRequest', {
    id: 42,
    method: 'applyPatchApproval',
    params: { availableDecisions: ['accept', 'decline'] },
  });

  const approvalEvent = io.emitted.find((entry) => entry.event === 'approval_request');
  assert.ok(approvalEvent, 'expected approval_request event');
  assert.equal(approvalEvent.payload.id, 42);
  assert.ok(approvalEvent.payload.timeoutMs > 0);
  assert.ok(approvalEvent.payload.expiresAt >= Date.now());

  await new Promise((resolve) => setTimeout(resolve, 50));

  const timeoutEvent = io.emitted.find((entry) => entry.event === 'approval_timeout');
  assert.ok(timeoutEvent, 'expected approval_timeout event');
  assert.equal(timeoutEvent.payload.id, 42);
  assert.deepEqual(responses, [{ id: 42, result: { decision: 'decline' } }]);

  if (prev === undefined) delete process.env.POCKETDEX_APPROVAL_TIMEOUT_MS;
  else process.env.POCKETDEX_APPROVAL_TIMEOUT_MS = prev;
});


test('socket request handler ignores malformed payloads instead of throwing', () => {
  const codex = new EventEmitter();
  codex.sendRequest = async () => ({});
  codex.sendResponse = () => {};

  const io = new FakeIo();
  const router = new MessageRouter(codex, io, () => {});
  router.init();

  const socket = new FakeSocket();
  io.emit('connection', socket);

  assert.doesNotThrow(() => socket.emit('request'));
  assert.doesNotThrow(() => socket.emit('approval_response'));
});


test('approval_response rejects malformed decision payloads', () => {
  const codex = new EventEmitter();
  const responses = [];
  codex.sendRequest = async () => ({});
  codex.sendResponse = (id, result) => responses.push({ id, result });

  const io = new FakeIo();
  const router = new MessageRouter(codex, io, () => {});
  router.init();

  const socket = new FakeSocket();
  const emitted = [];
  socket.emit = ((orig) => (event, payload) => {
    emitted.push({ event, payload });
    return orig.call(socket, event, payload);
  })(socket.emit);

  io.emit('connection', socket);
  codex.emit('serverRequest', {
    id: 7,
    method: 'applyPatchApproval',
    params: { availableDecisions: ['accept', 'decline'] },
  });

  socket.emit('approval_response', { id: 7, result: { decision: 123 } });

  assert.deepEqual(responses, []);
  assert.ok(emitted.some((entry) => entry.event === 'request_error' && entry.payload && entry.payload.method === 'approval_response'));
});
