const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDecisionSet,
  getDismissDecision,
} = require('../shared/approval-protocol');

test('uses current protocol decisions when available', () => {
  const request = {
    params: {
      availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
    },
  };

  assert.deepEqual(getDecisionSet(request), {
    approve: 'accept',
    approveForSession: 'acceptForSession',
    deny: 'decline',
    cancel: 'cancel',
  });
});

test('stays compatible with legacy approval strings when advertised by the server', () => {
  const request = {
    params: {
      availableDecisions: ['approved', 'approved_for_session', 'denied'],
    },
  };

  assert.deepEqual(getDecisionSet(request), {
    approve: 'approved',
    approveForSession: 'approved_for_session',
    deny: 'denied',
    cancel: null,
  });
});

test('falls back to a safe dismissal decision', () => {
  assert.equal(getDismissDecision({ params: {} }), 'denied');
  assert.equal(getDismissDecision({
    params: { availableDecisions: ['cancel'] },
  }), 'cancel');
});
