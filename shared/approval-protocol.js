(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PocketDexApprovalProtocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_DECISIONS = {
    approve: 'approved',
    approveForSession: 'approved_for_session',
    deny: 'denied',
    cancel: 'abort',
  };

  var DECISION_ALIASES = {
    approve: ['accept', 'approved'],
    approveForSession: ['acceptForSession', 'approved_for_session', 'approve-all'],
    deny: ['decline', 'denied', 'reject'],
    cancel: ['cancel', 'abort'],
  };

  function getScalarDecisions(availableDecisions) {
    if (!Array.isArray(availableDecisions)) return [];
    return availableDecisions.filter(function (decision) {
      return typeof decision === 'string';
    });
  }

  function resolveDecision(kind, availableDecisions, fallback) {
    var candidates = DECISION_ALIASES[kind] || [];
    var scalarDecisions = getScalarDecisions(availableDecisions);
    var defaultValue = fallback === undefined ? DEFAULT_DECISIONS[kind] || null : fallback;

    if (scalarDecisions.length === 0) return defaultValue;

    for (var i = 0; i < candidates.length; i += 1) {
      if (scalarDecisions.indexOf(candidates[i]) !== -1) {
        return candidates[i];
      }
    }

    return null;
  }

  function getDecisionSet(request) {
    var params = request && request.params ? request.params : {};
    var availableDecisions = params.availableDecisions;

    return {
      approve: resolveDecision('approve', availableDecisions),
      approveForSession: resolveDecision('approveForSession', availableDecisions),
      deny: resolveDecision('deny', availableDecisions),
      cancel: resolveDecision('cancel', availableDecisions),
    };
  }

  function getDismissDecision(request) {
    var decisionSet = getDecisionSet(request);
    return decisionSet.deny || decisionSet.cancel || DEFAULT_DECISIONS.deny;
  }

  return {
    DEFAULT_DECISIONS: DEFAULT_DECISIONS,
    resolveDecision: resolveDecision,
    getDecisionSet: getDecisionSet,
    getDismissDecision: getDismissDecision,
  };
});
