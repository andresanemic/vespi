'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const { verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const base = () => ({
  id: 'emergency-1', owner: 'person-1', grantee: 'agent-1', destination: 'clinic-1',
  actions: ['open-record'], scope: ['allergy-summary'], startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z', maxUses: 2, triggers: [{ id: 'triage-red', verifierId: 'triage-service' }],
  reviewers: ['person-1'], reviewDueMs: 3600000, pausers: ['person-1'],
});
const grantAuthority = async (grant) => ({ verified: true, grantor: grant.owner, reason: 'person signed grant' });
const triggerVerifier = (valid = true) => ({
  id: 'triage-service', verify: (trigger, signal) => ({
    verified: valid && signal?.source === 'triage-service' && signal?.critical === true,
    evidence: { signalId: signal?.id }, reason: valid ? 'independent triage signal checked' : 'signal rejected',
  }),
});
const request = (overrides = {}) => ({
  useId: 'use-1', actor: 'agent-1', action: 'open-record', subject: 'allergy-summary',
  destination: 'clinic-1', triggerId: 'triage-red', triggerSignal: { id: 'signal-1', source: 'triage-service', critical: true }, ...overrides,
});

test('emergency grant requires independently verified authority from its owner', async () => {
  await assert.rejects(() => emergency.createEmergencyPermission(base(), { authorizeGrantor: async () => ({ verified: true, grantor: 'agent-1' }) }), /grantor|authority/i);
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  assert.equal(permission.owner, 'person-1');
});

test('agent cannot assert a trigger result; independent verifier evidence is sealed in immediate receipt', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  const result = emergency.exerciseEmergency(permission, request({ triggerVerified: true, triggerVerification: { verified: true } }), {
    ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier(),
  });
  assert.equal(result.receipt.trigger.verifierId, 'triage-service');
  assert.equal(result.receipt.trigger.verification.verified, true);
  assert.equal(result.receipt.review.status, 'pending');
  assert.equal(result.state, 'review_pending');
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('forged or agent-declared trigger without trusted verification is rejected', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const result = emergency.exerciseEmergency(permission, request({ triggerSignal: { id: 'forged', source: 'agent-1', critical: true }, triggerVerified: true }), {
    ledger: emergency.createEmergencyLedger(), now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier(),
  });
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /trigger|signal/i);
});

test('exercise outside action, subject, or destination scope is blocked', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  for (const overrides of [{ action: 'export-record' }, { subject: 'full-record' }, { destination: 'other-clinic' }]) {
    const result = emergency.exerciseEmergency(permission, request(overrides), {
      ledger: emergency.createEmergencyLedger(), now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier(),
    });
    assert.equal(result.state, 'blocked');
  }
});

test('expired and exhausted emergency grants cannot be exercised', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const expired = emergency.exerciseEmergency(permission, request(), { ledger: emergency.createEmergencyLedger(), now: '2026-10-06T00:00:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(expired.state, 'blocked');
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  emergency.reviewEmergencyUse(permission, 'use-1', { by: 'person-1', decision: 'accept', now: '2026-10-04T12:10:00Z' }, ledger);
  emergency.exerciseEmergency(permission, request({ useId: 'use-2' }), { ledger, now: '2026-10-04T12:20:00Z', triggerVerifier: triggerVerifier() });
  emergency.reviewEmergencyUse(permission, 'use-2', { by: 'person-1', decision: 'accept', now: '2026-10-04T12:30:00Z' }, ledger);
  const exhausted = emergency.exerciseEmergency(permission, request({ useId: 'use-3' }), { ledger, now: '2026-10-04T12:40:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(exhausted.state, 'blocked');
});

test('same use cannot be replayed under another request key', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  const replay = emergency.exerciseEmergency(permission, request({ requestKey: 'different-key' }), { ledger, now: '2026-10-04T12:01:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(replay.state, 'blocked');
  assert.match(replay.reason, /replay|already used/i);
});

test('renewal cannot expand action, subject, destination, trigger, use cap, or reviewers', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  assert.throws(() => emergency.renewEmergencyPermission(permission, { scope: ['allergy-summary', 'full-record'] }), /scope|renew/i);
  assert.throws(() => emergency.renewEmergencyPermission(permission, { actions: ['open-record', 'export-record'] }), /action|renew/i);
});

test('pending post-use review blocks later uses until an authorized reviewer closes it', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  const second = emergency.exerciseEmergency(permission, request({ useId: 'use-2' }), { ledger, now: '2026-10-04T12:01:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(second.state, 'blocked');
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'use-1', { by: 'agent-1', decision: 'accept', now: '2026-10-04T12:02:00Z' }, ledger), /reviewer|authorized/i);
});

test('review deadline is recorded but does not auto-close pending review', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  const result = emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(result.receipt.review.dueAt, '2026-10-04T13:00:00.000Z');
  assert.equal(emergency.getEmergencyState(permission, ledger).pendingReview, 'use-1');
  assert.equal(emergency.getEmergencyState(permission, ledger, '2026-10-04T14:00:00Z').pendingReview, 'use-1');
});

test('concurrent synchronous uses cannot exceed maxUses', async () => {
  const permission = await emergency.createEmergencyPermission({ ...base(), maxUses: 1 }, { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  const results = ['use-a', 'use-b'].map((useId) => emergency.exerciseEmergency(permission, request({ useId }), {
    ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier(),
  }));
  assert.equal(results.filter((result) => result.state === 'review_pending').length, 1);
  assert.equal(results.filter((result) => result.state === 'blocked').length, 1);
});

test('owner can revoke or an explicitly named pauser can pause between signal and exercise', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  emergency.pauseEmergencyPermission(permission, 'person-1', ledger);
  const paused = emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(paused.state, 'blocked');
  assert.throws(() => emergency.revokeEmergencyPermission(permission, 'agent-1', ledger), /owner|authorized/i);
  emergency.revokeEmergencyPermission(permission, 'person-1', ledger);
  const revoked = emergency.exerciseEmergency(permission, request({ useId: 'use-after-revoke' }), { ledger, now: '2026-10-04T12:01:00Z', triggerVerifier: triggerVerifier() });
  assert.equal(revoked.state, 'blocked');
});

test('emergency receipt forces continuity back to the person while exercised outcome is unresolved', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  const { receipt } = emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  const result = resumeFromReceipts([receipt], { approved: [{ action: 'open-record' }] });
  assert.equal(result.needsPerson, true);
});

test('person can pause, revoke, review; agent cannot close pending review', async () => {
  const permission = await emergency.createEmergencyPermission(base(), { authorizeGrantor: grantAuthority });
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, request(), { ledger, now: '2026-10-04T12:00:00Z', triggerVerifier: triggerVerifier() });
  const reviewed = emergency.reviewEmergencyUse(permission, 'use-1', { by: 'person-1', decision: 'accept', now: '2026-10-04T12:15:00Z' }, ledger);
  assert.equal(reviewed.review.status, 'reviewed');
  assert.equal(emergency.getEmergencyState(permission, ledger).pendingReview, null);
});
