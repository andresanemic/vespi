'use strict';
// K4 hardening (orchestrator review, R42): resuming never walks past a blocked, paused or waiting action.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const receiptFor = (goal, status) => buildReceipt({
  operation: { id: `op-${goal}`, goal, action: goal }, capabilityId: 'c', authority: { spend: [] },
  outcome: { status, exercised: [] }, evidence: null, verification: status === 'verified' ? { verified: true, checks: { a: true } } : null,
});

for (const status of ['blocked', 'paused', 'needs_human_decision']) {
  test(`K4-H1: a ${status} receipt for the next action returns it to the person`, () => {
    const agreement = { approved: [{ action: 'uno' }, { action: 'dos' }], workingMode: 'cercana' };
    const out = resumeFromReceipts([receiptFor('uno', 'verified'), receiptFor('dos', status)], agreement);
    assert.equal(out.needsPerson, true);
    assert.equal(out.nextAction, null);
    assert.equal(out.lastState, status);
    assert.equal(out.workingMode, 'cercana');
  });
}

test('K4-H2: continuity messages are in English only', () => {
  const out = resumeFromReceipts([], { approved: [{ action: 'uno', changes: { amount: '9' } }] });
  assert.doesNotMatch(out.reason, /descartados|requiere/);
});
