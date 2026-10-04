'use strict';

// K1 · emergency access with triggers (decision 27, kernel 0.1.4).
//
// The shape under test: authority a person grants IN ADVANCE, exercised against a signal that
// somebody other than the exercising agent verified, sealed in an immediate receipt, and always
// leaving a post-use review that only a declared reviewer can close.
//
// What the tests refuse to allow (each one first written red):
//   · the agent asserting its own emergency, with its own "verified: true" and its own verifier
//   · exercise outside action, subject or destination; before the clock opens; after it closes
//   · the same use replayed under another request key, or one signal opening two uses
//   · renewal quietly widening the grant the person signed
//   · a review nobody closes, closed by the agent, or closed by a stranger
//   · two uses in one tick spending one slot of the cap
//   · a revocation landing between the signal and the exercise
//   · a permission object that never went through the grant path, and hostile getters on both
//     the permission and the request
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const receiptKernel = require('../src/receipt.js');
const { verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');

const GRANT = () => ({
  id: 'emergency-1',
  owner: 'person-1',
  grantee: 'agent-1',
  destination: 'clinic-1',
  purpose: 'the patient cannot answer and continuity of care needs the allergy summary',
  actions: ['open-record'],
  scope: ['allergy-summary'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
  maxUses: 2,
  triggers: [{ id: 'triage-red', verifierId: 'triage-service' }],
  reviewers: ['person-1'],
  reviewDueMs: 3600000,
  pausers: ['person-1'],
});

// The host, not the kernel, decides who is allowed to grant. What the kernel checks is that the
// answer names the person who claims to own the permission.
const GRANTOR_OK = async (grant) => ({
  verified: true,
  grantor: grant.owner,
  reason: 'the patient signed this grant in advance',
});

// The host also decides which object is the independent verifier for a declared trigger id. It is
// resolved once, when the person grants, and bound to the permission from then on.
const RESOLVE_OK = () => async (verifierId) => ({ id: verifierId, verify: TRIAGE() });
const TRIAGE = (result) => (trigger, signal) => {
  const base = {
    verified: signal?.source === 'triage-service' && signal?.critical === true,
    reason: 'the triage service signed this signal',
  };
  return typeof result === 'function' ? result(trigger, signal, base) : { ...base, ...(result || {}) };
};

async function granted(overrides = {}, deps = {}) {
  return emergency.createEmergencyPermission({ ...GRANT(), ...overrides }, {
    authorizeGrantor: deps.authorizeGrantor || GRANTOR_OK,
    resolveVerifier: deps.resolveVerifier || RESOLVE_OK(),
  });
}

const AT = '2026-10-04T12:00:00Z';
const REQUEST = (overrides = {}) => ({
  useId: 'use-1',
  actor: 'agent-1',
  action: 'open-record',
  subject: 'allergy-summary',
  destination: 'clinic-1',
  triggerId: 'triage-red',
  triggerSignal: { id: 'signal-1', source: 'triage-service', critical: true },
  ...overrides,
});

const use = (permission, request, now, extra = {}) => emergency.exerciseEmergency(permission, request, {
  ledger: emergency.createEmergencyLedger(), now, ...extra,
});
const review = (permission, useId, ledger, decision, now) => emergency.reviewEmergencyUse(permission, useId, {
  ledger, by: 'person-1', decision, now,
});

// ─── The grant: who may give emergency authority, and to whom ────────────────────────────────

test('a grant needs an injected grantor check that names the person who owns the permission', async () => {
  await assert.rejects(() => granted({}, { authorizeGrantor: async () => ({ verified: true, grantor: 'agent-1' }) }), /grantor|owner|authority/i);
  await assert.rejects(() => granted({}, { authorizeGrantor: async () => ({ verified: false, grantor: 'person-1' }) }), /grantor|owner|authority/i);
  await assert.rejects(() => granted({}, { authorizeGrantor: undefined }), /grantor|verifier|required/i);
  const permission = await granted();
  assert.equal(permission.owner, 'person-1');
  assert.equal(permission.grantee, 'agent-1');
});

test('a trigger verifier the exercising agent could also be is refused: the signal must be independent', async () => {
  await assert.rejects(() => granted({ triggers: [{ id: 'triage-red', verifierId: 'agent-1' }] }), /independent|verifier/i);
  await assert.rejects(() => granted({ triggers: [{ id: 'triage-red', verifierId: 'person-1' }] }), /independent|verifier/i);
});

test('a declared verifier that cannot be resolved, or that resolves to another id, refuses the grant', async () => {
  await assert.rejects(() => granted({}, { resolveVerifier: undefined }), /verifier|resolve|required/i);
  await assert.rejects(() => granted({}, { resolveVerifier: async () => ({ id: 'someone-else', verify: TRIAGE() }) }), /verifier|independent/i);
  await assert.rejects(() => granted({}, { resolveVerifier: async () => ({ id: 'triage-service' }) }), /verifier|verify/i);
});

test('the permission is a frozen copy: what the caller mutates afterwards is not authority', async () => {
  const draft = GRANT();
  const permission = await emergency.createEmergencyPermission(draft, {
    authorizeGrantor: GRANTOR_OK, resolveVerifier: RESOLVE_OK(),
  });
  draft.scope.push('full-record');
  draft.maxUses = 99;
  assert.deepEqual(permission.scope, ['allergy-summary']);
  assert.equal(permission.maxUses, 2);
  assert.ok(Object.isFrozen(permission));
  const widened = { ...permission, scope: ['full-record'] };
  const result = use(widened, REQUEST({ subject: 'full-record' }), AT);
  assert.equal(result.state, 'blocked', 'an object that was never granted exercises nothing');
});

test('extra injected keys buy nothing: the verifier consulted is the one bound at grant time', async () => {
  const permission = await granted();
  let forgedCalls = 0;
  const forged = {
    id: 'triage-service',
    verify: () => { forgedCalls += 1; return { verified: true, reason: 'the agent says it is fine' }; },
  };
  const result = use(permission, REQUEST({ triggerVerified: true, triggerVerification: { verified: true } }), AT, { triggerVerifier: forged });
  assert.equal(result.state, 'blocked');
  assert.equal(forgedCalls, 0, 'the verifier supplied at exercise time must never be called');
});

// ─── The trigger: a signal somebody else verified ──────────────────────────────────────────

test('exercising emits an immediate receipt with the trigger, its verification and the pending review', async () => {
  const permission = await granted();
  const result = use(permission, REQUEST(), AT);
  assert.equal(result.state, 'review_pending');
  assert.equal(result.receipt.status, 'not_verified');
  assert.equal(result.receipt.capability, 'emergency-access');
  assert.equal(result.receipt.operation.goal, permission.purpose);
  assert.equal(result.receipt.trigger.id, 'triage-red');
  assert.equal(result.receipt.trigger.verifierId, 'triage-service');
  assert.equal(result.receipt.trigger.verification.verified, true);
  assert.equal(result.receipt.review.status, 'pending');
  assert.deepEqual(result.receipt.review.reviewers, ['person-1']);
  assert.equal(result.receipt.review.dueAt, '2026-10-04T13:00:00.000Z');
  assert.deepEqual(result.receipt.coverage, ['grantor_authority', 'trigger_verified']);
  assert.ok(result.receipt.notCovered.includes('effect_verified'));
  assert.ok(result.receipt.notCovered.includes('post_use_review'));
  assert.equal(result.receipt.verification.verified, false);
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('a signal the agent signed for itself is blocked, and its own "verified" claim is ignored', async () => {
  const permission = await granted();
  const result = use(permission, REQUEST({
    triggerVerified: true,
    triggerVerification: { verified: true, reason: 'emergency confirmed' },
    triggerSignal: { id: 'forged', source: 'agent-1', critical: true },
  }), AT);
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /trigger|signal|source|independent/i);
  assert.equal(result.receipt.status, 'blocked');
  assert.deepEqual(result.receipt.authority.exercised, [], 'nothing was exercised');
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('a signal whose source is not the declared verifier is blocked before any verifier is asked', async () => {
  let calls = 0;
  const permission = await granted({}, { resolveVerifier: async (verifierId) => ({ id: verifierId, verify: () => { calls += 1; return { verified: true, reason: 'always yes' }; } }) });
  const result = use(permission, REQUEST({ triggerSignal: { id: 'signal-1', source: 'somebody', critical: true } }), AT);
  assert.equal(result.state, 'blocked');
  assert.equal(calls, 0);
});

test('a verifier that answers with a promise is refused: the kernel does not wait for async verification', async () => {
  const permission = await granted({}, { resolveVerifier: async (verifierId) => ({ id: verifierId, verify: async () => ({ verified: true, reason: 'later' }) }) });
  const ledger = emergency.createEmergencyLedger();
  const first = emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  assert.equal(first.state, 'blocked');
  assert.match(first.reason, /verif|verifier/i);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 0, 'a refused verification spends nothing');
  const blockedByCap = emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-2' }), { ledger, now: AT });
  assert.equal(blockedByCap.state, 'blocked');
  assert.match(blockedByCap.reason, /review/i, 'the refused attempt left no pending review behind');
});

test('a verifier that throws, or answers with anything but verified true, is blocked', async () => {
  const throwing = await granted({}, { resolveVerifier: async (verifierId) => ({ id: verifierId, verify: () => { throw new Error('boom'); } }) });
  assert.equal(use(throwing, REQUEST(), AT).state, 'blocked');
  const silent = await granted({}, { resolveVerifier: async (verifierId) => ({ id: verifierId, verify: TRIAGE({ verified: false, reason: 'the signal does not match' }) }) });
  const result = use(silent, REQUEST(), AT);
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /trigger|signal|verif/i);
});

// ─── Scope, clock and cap ────────────────────────────────────────────────────────────────────

test('exercise outside the declared action, subject or destination is blocked', async () => {
  const permission = await granted();
  for (const overrides of [{ action: 'export-record' }, { subject: 'full-record' }, { destination: 'other-clinic' }, { actor: 'agent-2' }]) {
    const result = use(permission, REQUEST(overrides), AT);
    assert.equal(result.state, 'blocked', JSON.stringify(overrides));
    assert.equal(verifyReceipt(result.receipt).ok, true);
  }
});

test('a permission cannot be exercised before its clock opens or after it closes', async () => {
  const permission = await granted();
  const early = use(permission, REQUEST(), '2026-09-30T23:59:59Z');
  assert.equal(early.state, 'blocked');
  assert.match(early.reason, /period|valid|start/i);
  const late = use(permission, REQUEST(), '2026-10-05T00:00:00Z');
  assert.equal(late.state, 'blocked');
  assert.match(late.reason, /period|valid|expir/i);
});

test('the cap is spent only by uses that were actually exercised', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  for (const overrides of [{ action: 'export-record' }, { actor: 'agent-2' }, { triggerSignal: { id: 'forged', source: 'agent-1', critical: true } }]) {
    assert.equal(emergency.exerciseEmergency(permission, REQUEST(overrides), { ledger, now: AT }).state, 'blocked');
  }
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 0);
  assert.equal(emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT }).state, 'review_pending');
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 1);
});

test('the cap cannot be exceeded: two uses in one tick, one slot granted', async () => {
  const permission = await granted({ maxUses: 1 });
  const ledger = emergency.createEmergencyLedger();
  const results = ['use-a', 'use-b'].map((useId) => emergency.exerciseEmergency(permission, REQUEST({ useId }), { ledger, now: AT }));
  assert.equal(results.filter((result) => result.state === 'review_pending').length, 1);
  assert.equal(results.filter((result) => result.state === 'blocked').length, 1);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 1);
});

test('an exhausted cap blocks further exercise even inside the clock', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  for (const useId of ['use-1', 'use-2']) {
    assert.equal(emergency.exerciseEmergency(permission, REQUEST({ useId }), { ledger, now: AT }).state, 'review_pending');
    review(permission, useId, ledger, 'accept', AT);
  }
  const exhausted = emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-3' }), { ledger, now: AT });
  assert.equal(exhausted.state, 'blocked');
  assert.match(exhausted.reason, /limit|cap|exhaust/i);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).status, 'exhausted');
});

test('the same use cannot be replayed under another request key, and one signal opens one use', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  review(permission, 'use-1', ledger, 'accept', AT);
  const replay = emergency.exerciseEmergency(permission, REQUEST({ requestKey: 'a-different-key' }), { ledger, now: '2026-10-04T12:05:00Z' });
  assert.equal(replay.state, 'blocked');
  assert.match(replay.reason, /replay|already used/i);
  const sameSignal = emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-2' }), { ledger, now: '2026-10-04T12:06:00Z' });
  assert.equal(sameSignal.state, 'blocked');
  assert.match(sameSignal.reason, /signal|replay|already used/i);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 1);
});

// ─── The post-use review: pending, named, closed only by a person ────────────────────────────

test('a pending review blocks the next use and the state says so', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  const first = emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  assert.equal(first.nextUse, 'blocked_until_review');
  const state = emergency.getEmergencyState(permission, { ledger, now: AT });
  assert.equal(state.status, 'review_pending');
  assert.equal(state.pendingReview, 'use-1');
  assert.equal(state.nextUse, 'blocked_until_review');
  const second = emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-2' }), { ledger, now: '2026-10-04T12:05:00Z' });
  assert.equal(second.state, 'blocked');
  assert.match(second.reason, /review/i);
});

test('only a declared reviewer can close the review, and only with a decision', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'use-1', { ledger, by: 'agent-1', decision: 'accept', now: AT }), /reviewer|authorized/i);
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'use-1', { ledger, by: 'person-1', decision: 'maybe', now: AT }), /accept|reject/i);
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'use-9', { ledger, by: 'person-1', decision: 'accept', now: AT }), /pending|no matching/i);
});

test('closing the review re-seals the receipt and the receipt still verifies', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  const { receipt } = emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  const closed = review(permission, 'use-1', ledger, 'accept', '2026-10-04T12:15:00Z');
  assert.equal(closed.review.status, 'reviewed');
  assert.equal(closed.review.decision, 'accept');
  assert.equal(closed.review.by, 'person-1');
  assert.equal(closed.review.reviewedAt, '2026-10-04T12:15:00.000Z');
  assert.notEqual(closed.digest, receipt.digest);
  assert.equal(verifyReceipt(closed).ok, true);
  assert.equal(verifyReceipt(receipt).ok, true, 'the original receipt is a separate sealed object');
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).pendingReview, null);
});

test('a rejected review stops the permission: it cannot be resumed and it cannot be used again', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  const closed = review(permission, 'use-1', ledger, 'reject', '2026-10-04T12:15:00Z');
  assert.equal(closed.review.decision, 'reject');
  const state = emergency.getEmergencyState(permission, { ledger, now: AT });
  assert.equal(state.status, 'stopped_by_review');
  assert.equal(state.rejectedUse, 'use-1');
  assert.equal(state.nextUse, 'blocked_stopped');
  const again = emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-2' }), { ledger, now: '2026-10-04T12:20:00Z' });
  assert.equal(again.state, 'blocked');
  assert.match(again.reason, /rejected|stopped|review/i);
  assert.throws(() => emergency.resumeEmergencyPermission(permission, { ledger, by: 'person-1' }), /rejected|stopped|revoked/i);
});

test('an overdue review is visible and never closes itself', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  const later = '2026-10-04T15:00:00Z';
  const state = emergency.getEmergencyState(permission, { ledger, now: later });
  assert.equal(state.pendingReview, 'use-1');
  assert.equal(state.reviewOverdue, true);
  assert.equal(state.reviewDueAt, '2026-10-04T13:00:00.000Z');
  assert.equal(emergency.exerciseEmergency(permission, REQUEST({ useId: 'use-2' }), { ledger, now: later }).state, 'blocked');
});

// ─── Pause and revocation (decision 16: the agreement says who may pause) ─────────────────────

test('a declared pauser can pause and resume; a stranger cannot do either', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  assert.throws(() => emergency.pauseEmergencyPermission(permission, { ledger, by: 'agent-1' }), /authorized|pausers/i);
  emergency.pauseEmergencyPermission(permission, { ledger, by: 'person-1' });
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).status, 'paused');
  const paused = emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  assert.equal(paused.state, 'blocked');
  assert.match(paused.reason, /paused/i);
  emergency.resumeEmergencyPermission(permission, { ledger, by: 'person-1' });
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).status, 'active');
});

test('a revocation landing between the signal and the exercise blocks it, and the verifier is never asked', async () => {
  let calls = 0;
  const permission = await granted({}, { resolveVerifier: async (verifierId) => ({ id: verifierId, verify: () => { calls += 1; return { verified: true, reason: 'signed' }; } }) });
  const ledger = emergency.createEmergencyLedger();
  emergency.revokeEmergencyPermission(permission, { ledger, by: 'person-1', now: '2026-10-04T11:59:00Z' });
  const result = emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT });
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /revoked/i);
  assert.equal(calls, 0);
});

test('only the person who granted may revoke, and a revoked permission never comes back', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  assert.throws(() => emergency.revokeEmergencyPermission(permission, { ledger, by: 'agent-1' }), /owner|authorized|granted/i);
  emergency.pauseEmergencyPermission(permission, { ledger, by: 'person-1' });
  emergency.revokeEmergencyPermission(permission, { ledger, by: 'person-1' });
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).status, 'revoked');
  assert.throws(() => emergency.resumeEmergencyPermission(permission, { ledger, by: 'person-1' }), /revoked/i);
  assert.equal(emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT }).state, 'blocked');
});

// ─── Renewal: the clock may move, the grant may not grow ─────────────────────────────────────

test('renewal refuses to widen actions, scope, destination, triggers, reviewers, cap or purpose', async () => {
  const permission = await granted();
  const widenings = [
    { actions: ['open-record', 'export-record'] },
    { scope: ['allergy-summary', 'full-record'] },
    { destination: 'other-clinic' },
    { triggers: [{ id: 'triage-red', verifierId: 'agent-1' }] },
    { reviewers: ['agent-1'] },
    { maxUses: 99 },
    { purpose: 'anything else' },
    { owner: 'agent-1' },
  ];
  for (const changes of widenings) {
    assert.throws(() => emergency.renewEmergencyPermission(permission, changes), /renew|widen|expand|cannot/i, JSON.stringify(changes));
  }
});

test('renewal only extends the clock, and the renewed permission keeps its bound verifier', async () => {
  const permission = await granted();
  assert.throws(() => emergency.renewEmergencyPermission(permission, { expiresAt: '2026-10-04T00:00:00Z' }), /renew|extend|clock/i);
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: '2026-10-06T00:00:00Z' });
  assert.equal(renewed.expiresAt, '2026-10-06T00:00:00Z');
  assert.equal(use(renewed, REQUEST(), '2026-10-05T12:00:00Z').state, 'review_pending');
});

// ─── Objects that never went through the grant, and hostile ones ─────────────────────────────

test('a permission that was not granted through the kernel exercises nothing', async () => {
  const forged = {
    ...GRANT(),
    grantVerification: { verified: true, reason: 'the patient signed this grant in advance' },
  };
  const result = use(forged, REQUEST(), AT);
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /grant|verifier|bound|independent/i);
  assert.equal(result.receipt.status, 'blocked');
});

test('hostile getters on the permission or the request fail closed with a receipt, not a crash', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  const hostilePermission = new Proxy(permission, { get(target, key) { if (key === 'scope') throw new Error('no'); return target[key]; } });
  const permissionResult = emergency.exerciseEmergency(hostilePermission, REQUEST(), { ledger, now: AT });
  assert.equal(permissionResult.state, 'blocked');
  assert.equal(verifyReceipt(permissionResult.receipt).ok, true);
  const hostileRequest = new Proxy(REQUEST(), { get(target, key) { if (key === 'subject') throw new Error('no'); return target[key]; } });
  const requestResult = emergency.exerciseEmergency(permission, hostileRequest, { ledger, now: AT });
  assert.equal(requestResult.state, 'blocked');
  assert.equal(verifyReceipt(requestResult.receipt).ok, true);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 0);
});

test('a missing or hostile ledger blocks the exercise instead of throwing', async () => {
  const permission = await granted();
  const result = emergency.exerciseEmergency(permission, REQUEST(), { now: AT });
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /ledger/i);
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('an injected clock the kernel cannot read blocks the exercise', async () => {
  const permission = await granted();
  const bad = use(permission, REQUEST(), 'not-a-time');
  assert.equal(bad.state, 'blocked');
  const promise = use(permission, REQUEST({ useId: 'use-2' }), Promise.resolve(AT));
  assert.equal(promise.state, 'blocked');
});

// ─── Continuity and compatibility with what already exists ───────────────────────────────────

test('an emergency receipt returns the operation to the person while the effect stays unresolved', async () => {
  const permission = await granted();
  const { receipt } = use(permission, REQUEST(), AT);
  const resumed = resumeFromReceipts([receipt], { approved: [{ action: 'open-record' }] });
  assert.equal(resumed.needsPerson, true);
  assert.equal(resumed.reason, 'reconciliation_required');
  assert.equal(resumed.nextAction, null);
});

test('a receipt built without emergency access keeps the exports and the digest it always had', async () => {
  for (const name of ['buildReceipt', 'verifyReceipt', 'anchorReceipt', 'anchorReceiptAsync']) {
    assert.equal(typeof receiptKernel[name], 'function', name);
  }
  const spec = {
    operation: { id: 'op-1', goal: 'pay' },
    capabilityId: 'x402',
    authority: { spend: [{ asset: 'USDC:test', maxAmount: '10', to: 'RECEIVER' }] },
    outcome: { status: 'verified', exercised: [{ asset: 'USDC:test', amount: '10', to: 'RECEIVER' }] },
    evidence: { txHash: 'abc' },
    verification: { verified: true, checks: { memo: true }, reason: 'confirmed on testnet' },
    at: '2026-10-04T12:00:00.000Z',
  };
  const receipt = receiptKernel.buildReceipt(spec);
  assert.equal(receipt.digest, receiptKernel.computeDigest(receipt));
  assert.equal(receipt.digest, receiptKernel.buildReceipt(spec).digest);
  assert.equal(verifyReceipt(receipt).ok, true);
});