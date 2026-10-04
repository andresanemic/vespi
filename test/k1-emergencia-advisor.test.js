'use strict';

// K1 · the independent reviewer's adversarial corpus, brought into this branch (fix round).
//
// Each case was written red by the reviewer against this branch; every title keeps the reviewer's
// A## number so a failure can be traced back to it. The fixtures are this file's own, in the
// style of `emergency.test.js`; the assertions are the reviewer's, kept as they were written.
//
// Two of these cases cannot hold together with what the reviewer's own report requires, and both
// deviations are stated where they happen and in the report:
//   · ADV04 requires renewal to be refused when the host bound no renewal approver, and ADV18
//     requires a renewal to succeed on a permission bound the same way. The permission in ADV18 is
//     therefore granted with an approver, which is the only shape in which a renewal is legitimate.
//     The assertion ADV18 is really about (one read, one stored value) is unchanged.
//   · ADV17 asks a request carrying an own accessor on `action` to come back blocked. A single read
//     of that field already removes the hazard, so the kernel refuses caller objects that carry own
//     accessors: it reads each field exactly once and could not see a later change.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const { createHost } = require('./emergency-host.js');

// One SIMULATED authentication port for this file: it answers with a frozen object per declared
// name and hands back the same object for the same person. See `emergency-host.js`.
const host = createHost();
const { verifyReceipt } = require('../src/receipt.js');

const GRANT = (overrides = {}) => ({
  id: 'emergency-adv',
  owner: 'person-1',
  grantee: 'agent-1',
  destination: 'clinic-1',
  purpose: 'the patient cannot answer and continuity of care needs the allergy summary',
  actions: ['open-record'],
  scope: ['allergy-summary', 'full-record'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
  maxUses: 2,
  triggers: [{ id: 'triage-red', verifierId: 'triage-service' }],
  reviewers: ['person-1'],
  reviewDueMs: 3600000,
  pausers: ['person-1'],
  ...overrides,
});

// The host decides who may grant and who may extend the clock. Neither answer is the kernel's.
const GRANTOR_OK = async (grant) => ({
  verified: true,
  grantor: grant.owner,
  reason: 'the patient signed this grant in advance',
});
const RENEWAL_OK = (candidate) => ({
  verified: true,
  grantor: candidate.owner,
  reason: 'the patient signed the extension',
});
const VERIFIED = (trigger, signal) => ({
  verified: signal && signal.critical === true,
  reason: 'the triage service signed this signal',
});

const REQUEST = (overrides = {}) => {
  const useId = overrides.useId || 'use-adv';
  return {
    useId,
    actor: 'agent-1',
    action: 'open-record',
    subject: 'allergy-summary',
    destination: 'clinic-1',
    triggerId: 'triage-red',
    triggerSignal: { id: `signal-${useId}`, source: 'triage-service', critical: true },
    ...overrides,
  };
};

const AT = '2026-10-04T12:00:00Z';

async function granted(overrides = {}, deps = {}) {
  const verify = deps.verify || VERIFIED;
  return emergency.createEmergencyPermission(GRANT(overrides), {
    authenticate: host.authenticate,
    authorizeGrantor: 'authorizeGrantor' in deps ? deps.authorizeGrantor : GRANTOR_OK,
    resolveVerifier: 'resolveVerifier' in deps ? deps.resolveVerifier : async (id) => ({ id, verify }),
    authorizeRenewal: 'authorizeRenewal' in deps ? deps.authorizeRenewal : RENEWAL_OK,
  });
}

const ledgerFor = () => emergency.createEmergencyLedger();
const run = (permission, request, now, ledger) => emergency.exerciseEmergency(permission, request, {
  ledger: ledger || ledgerFor(), now: now || AT,
});
const state = (permission, ledger, now) => emergency.getEmergencyState(permission, {
  ledger, now: now || AT,
});

// ─── A01 · A03: the authority has to be bound, not merely shaped ─────────────────────────────

test('ADV01 forged reviewers cannot close a genuine pending review', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  run(permission, REQUEST(), AT, ledger);
  assert.throws(() => emergency.reviewEmergencyUse({ ...permission, reviewers: ['agent-1'] }, 'use-adv', {
    ledger, by: host.principal('agent-1'), decision: 'accept', now: AT,
  }), /permission|grant|bound|authorized/i);
  assert.equal(state(permission, ledger).pendingReview, 'use-adv', 'the review stays open');
});

test('ADV02 forged pausers cannot resume a genuine paused permission', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  emergency.pauseEmergencyPermission(permission, { ledger, by: host.principal('person-1') });
  assert.throws(() => emergency.resumeEmergencyPermission({ ...permission, pausers: ['person-1', 'agent-1'] }, {
    ledger, by: host.principal('agent-1'),
  }), /permission|grant|bound|authorized/i);
  assert.equal(state(permission, ledger).paused, true);
});

test('ADV03 forged owner cannot revoke another persons permission', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  assert.throws(() => emergency.revokeEmergencyPermission({ ...permission, owner: 'agent-1', pausers: ['agent-1'] }, {
    ledger, by: host.principal('agent-1'),
  }), /permission|grant|bound|authorized/i);
  assert.equal(state(permission, ledger).revoked, false);
});

// ─── A04: extending the clock is new authority and needs a new answer ────────────────────────

test('ADV04 caller cannot renew time authority without a new owner authorization', async () => {
  const permission = await granted({}, { authorizeRenewal: undefined });
  assert.throws(() => emergency.renewEmergencyPermission(permission, { expiresAt: '2027-10-05T00:00:00Z' }),
    /authority|authoriz|grantor|owner|renew/i);
});

// ─── A05: what the authorizer saw is what the kernel binds ──────────────────────────────────

test('ADV05 authorization checks the same scope that the kernel binds', async () => {
  let reads = 0;
  const draft = GRANT();
  Object.defineProperty(draft, 'scope', {
    enumerable: true,
    get() { return ++reads === 1 ? ['full-record'] : ['allergy-summary']; },
  });
  const deps = {
    authenticate: host.authenticate,
    authorizeGrantor: async (observed) => ({
      verified: observed.scope.length === 1 && observed.scope[0] === 'allergy-summary',
      grantor: 'person-1',
      reason: 'only the allergy summary was signed',
    }),
  };
  try {
    const permission = await emergency.createEmergencyPermission(draft, {
      ...deps, resolveVerifier: async (id) => ({ id, verify: VERIFIED }),
    });
    assert.deepEqual(permission.scope, ['allergy-summary'], 'the bound scope is exactly what was authorized');
  } catch (err) {
    if (err && err.code === 'ERR_ASSERTION') throw err;
    assert.match(err.message, /malformed|grantor|authority|safely/i);
  }
});

// ─── A06 · A07: a synchronous run is still a reentrant one ───────────────────────────────────

test('ADV06 reentrant verifier cannot spend two slots from maxUses one', async () => {
  const ledger = ledgerFor();
  let permission;
  let nested;
  let entered = false;
  permission = await granted({ maxUses: 1 }, {
    verify: () => {
      if (!entered) {
        entered = true;
        nested = run(permission, REQUEST({ useId: 'use-adv-2' }), AT, ledger);
      }
      return { verified: true, reason: 'checked' };
    },
  });
  const outer = run(permission, REQUEST(), AT, ledger);
  assert.equal(state(permission, ledger).uses, 1, `outer=${outer.state}; nested=${nested && nested.state}`);
  assert.equal([outer, nested].filter((result) => result.state === 'review_pending').length, 1);
});

test('ADV07 revocation during signal verification blocks the outer use', async () => {
  const ledger = ledgerFor();
  let permission;
  permission = await granted({}, {
    verify: () => {
      emergency.revokeEmergencyPermission(permission, { ledger, by: host.principal('person-1') });
      return { verified: true, reason: 'checked' };
    },
  });
  const result = run(permission, REQUEST(), AT, ledger);
  assert.equal(result.state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
});

// ─── A08 · A09 · A25: an unreadable verdict spends nothing and leaks nothing ─────────────────

test('ADV08 throwing verified getter returns blocked receipt without leaking an exception', async () => {
  const permission = await granted({}, {
    verify: () => ({ get verified() { throw new Error('synthetic-private-marker'); } }),
  });
  const ledger = ledgerFor();
  let result;
  assert.doesNotThrow(() => { result = run(permission, REQUEST(), AT, ledger); });
  assert.equal(result.state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
  assert.equal(verifyReceipt(result.receipt).ok, true);
  assert.equal(JSON.stringify(result).includes('synthetic-private-marker'), false);
});

test('ADV09 throwing reason getter cannot spend a slot without a receipt', async () => {
  const permission = await granted({}, {
    verify: () => ({ verified: true, get reason() { throw new Error('synthetic-private-marker'); } }),
  });
  const ledger = ledgerFor();
  let result;
  assert.doesNotThrow(() => { result = run(permission, REQUEST(), AT, ledger); });
  assert.equal(result.state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
});

test('ADV10 oversized review deadline is rejected at grant creation', async () => {
  await assert.rejects(() => granted({ reviewDueMs: 1e20 }), /review|range|integer|clock/i);
});

test('ADV25 verifier reason failure leaves neither uses nor pending review behind', async () => {
  const permission = await granted({}, {
    verify: () => ({ verified: true, get reason() { throw new Error('synthetic-private-marker'); } }),
  });
  const ledger = ledgerFor();
  try { run(permission, REQUEST(), AT, ledger); } catch { /* the ledger is inspected on its own. */ }
  assert.equal(state(permission, ledger).uses, 0);
  assert.equal(state(permission, ledger).pendingReview, null);
});

// ─── A11 · A14: state and coverage may only say what was checked ─────────────────────────────

test('ADV11 structurally valid forged permission does not claim verified grantor coverage', () => {
  const result = run(GRANT(), REQUEST(), AT);
  assert.equal(result.state, 'blocked');
  assert.equal(result.receipt.verification.checks.grantor_authority, false);
  assert.equal(result.receipt.coverage.includes('grantor_authority'), false);
});

test('ADV12 state before startsAt cannot claim next use allowed', async () => {
  const permission = await granted();
  const stateEarly = state(permission, ledgerFor(), '2026-09-30T12:00:00Z');
  assert.notEqual(stateEarly.nextUse, 'allowed');
});

test('ADV13 state with invalid clock cannot claim next use allowed', async () => {
  const permission = await granted();
  assert.notEqual(state(permission, ledgerFor(), 'not-a-time').nextUse, 'allowed');
});

test('ADV14 state for an unbound permission cannot claim next use allowed', () => {
  assert.notEqual(emergency.getEmergencyState(GRANT(), { ledger: ledgerFor(), now: AT }).nextUse, 'allowed');
});

// ─── A15 · A16 · A17 · A18 · A27: the receipt binds what was actually used ───────────────────

test('ADV15 receipts distinguish which subject was authorized and exercised', async () => {
  const permission = await granted();
  const first = run(permission, REQUEST({ subject: 'allergy-summary' }), AT).receipt;
  const second = run(permission, REQUEST({ subject: 'full-record' }), AT).receipt;
  assert.notEqual(first.digest, second.digest, 'different accessed subjects leave different sealed evidence');
});

test('ADV16 signal id recorded is the id the verifier actually checked', async () => {
  let seen;
  const permission = await granted({}, {
    verify: (trigger, signal) => {
      seen = signal.id;
      return { verified: seen === 'signed-signal', reason: 'signed-signal was authenticated' };
    },
  });
  let reads = 0;
  const signal = { source: 'triage-service', critical: true };
  Object.defineProperty(signal, 'id', {
    enumerable: true,
    get() { return ++reads <= 2 ? 'unverified-signal' : 'signed-signal'; },
  });
  const result = run(permission, REQUEST({ triggerSignal: signal }), AT);
  if (result.state !== 'blocked') assert.equal(result.receipt.trigger.signalId, seen);
});

test('ADV17 changing request getter cannot put an invalid action in a blocked receipt', async () => {
  const permission = await granted();
  let reads = 0;
  const request = REQUEST();
  Object.defineProperty(request, 'action', {
    enumerable: true,
    get() { return ++reads === 1 ? 'open-record' : { unchecked: true }; },
  });
  const result = run(permission, request, AT);
  assert.equal(result.state, 'blocked');
  assert.equal(verifyReceipt(result.receipt).ok, true);
  assert.ok(result.receipt.action === undefined || typeof result.receipt.action === 'string',
    'a receipt action never carries an unchecked object');
});

test('ADV18 renewal stores the exact expiresAt value that was validated', async () => {
  // A renewal is only legitimate with an approver bound, so this case grants one; what it checks
  // is the single read of `expiresAt`, which ADV04 cannot coexist with on a permission without one.
  const permission = await granted();
  let reads = 0;
  const changes = {};
  Object.defineProperty(changes, 'expiresAt', {
    enumerable: true,
    get() { return ++reads === 1 ? '2026-10-06T00:00:00Z' : '2099-10-06T00:00:00Z'; },
  });
  const renewed = emergency.renewEmergencyPermission(permission, changes);
  assert.equal(Date.parse(renewed.expiresAt), Date.parse('2026-10-06T00:00:00Z'));
});

test('ADV27 distinct verified signal bodies cannot leave identical sealed evidence', async () => {
  const permission = await granted();
  const first = run(permission, REQUEST({ triggerSignal: { id: 'signal-adv', source: 'triage-service', critical: true, severity: 1 } }), AT).receipt;
  const second = run(permission, REQUEST({ triggerSignal: { id: 'signal-adv', source: 'triage-service', critical: true, severity: 9 } }), AT).receipt;
  assert.notEqual(first.digest, second.digest, 'the receipt binds the exact signal, without copying its body');
});

// ─── A19 · A24: the clock of a review is not free to choose ─────────────────────────────────

test('ADV19 post-use review cannot be timestamped before the use', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  run(permission, REQUEST(), AT, ledger);
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'use-adv', {
    ledger, by: host.principal('person-1'), decision: 'accept', now: '2026-10-03T12:00:00Z',
  }), /clock|before|time|review/i);
  assert.equal(state(permission, ledger).pendingReview, 'use-adv', 'the review stays open');
});

test('ADV24 unsafe deadline cannot leave a spent slot and an orphan pending review', async () => {
  let permission;
  try {
    permission = await granted({ reviewDueMs: 1e20 });
  } catch (err) {
    assert.match(err.message, /review|clock|range|integer/i);
    return;
  }
  const ledger = ledgerFor();
  let result;
  assert.doesNotThrow(() => { result = run(permission, REQUEST(), AT, ledger); });
  assert.equal(result.state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
});

// ─── A20 · A23: what already held still holds ───────────────────────────────────────────────

test('ADV20 frozen request and signal are not mutated by exercise', async () => {
  const permission = await granted({}, {
    verify: (trigger, signal) => { signal.critical = false; return { verified: true, reason: 'checked' }; },
  });
  const signal = Object.freeze({ id: 'signal-adv', source: 'triage-service', critical: true });
  const request = Object.freeze(REQUEST({ triggerSignal: signal }));
  const result = run(permission, request, AT);
  assert.equal(result.state, 'review_pending');
  assert.equal(signal.critical, true);
  assert.equal(request.subject, 'allergy-summary');
});

test('ADV21 strict verified true rejects truthy values without consuming authority', async () => {
  for (const verified of [1, 'true', {}, new Boolean(true)]) {
    const permission = await granted({}, { verify: () => ({ verified, reason: 'checked' }) });
    const ledger = ledgerFor();
    assert.equal(run(permission, REQUEST(), AT, ledger).state, 'blocked');
    assert.equal(state(permission, ledger).uses, 0);
  }
});

test('ADV22 use and review never claim an independently verified effect', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  const result = run(permission, REQUEST(), AT, ledger);
  const closed = emergency.reviewEmergencyUse(permission, 'use-adv', {
    ledger, by: host.principal('person-1'), decision: 'accept', now: AT,
  });
  for (const receipt of [result.receipt, closed]) {
    assert.equal(receipt.status, 'not_verified');
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.verification.checks.effect_verified, false);
    assert.equal(verifyReceipt(receipt).ok, true);
  }
});

test('ADV23 callback exception text is absent from returned receipts', async () => {
  const permission = await granted({}, {
    verify: () => { throw new Error('synthetic-private-marker'); },
  });
  const result = run(permission, REQUEST(), AT);
  assert.equal(result.state, 'blocked');
  assert.equal(JSON.stringify(result).includes('synthetic-private-marker'), false);
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

// ─── A26 · A28: what the receipt says about its own coverage ────────────────────────────────

test('ADV26 a closed review no longer claims that post-use review is open and uncovered', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  run(permission, REQUEST(), AT, ledger);
  const closed = emergency.reviewEmergencyUse(permission, 'use-adv', {
    ledger, by: host.principal('person-1'), decision: 'accept', now: AT,
  });
  assert.equal(closed.review.status, 'reviewed');
  assert.equal(closed.notCovered.includes('post_use_review'), false);
  assert.doesNotMatch(closed.verification.reason, /review is open/);
  assert.equal(closed.verification.checks.effect_verified, false);
});

test('ADV28 absent exact project state must be explicitly listed as not covered', async () => {
  const permission = await granted();
  const receipt = run(permission, REQUEST(), AT).receipt;
  assert.equal(receipt.notCovered.includes('exact_state'), true,
    'decision 22 needs exact state or an explicit coverage limit');
});

// ─── The renewal answer itself (A04 with an approver bound) ─────────────────────────────────

test('a renewal needs the approver bound at grant time, and never one the caller brings', async () => {
  for (const answer of [
    { verified: false, grantor: 'person-1', reason: 'not signed' },
    { verified: true, grantor: 'agent-1', reason: 'the agent says so' },
    Promise.resolve({ verified: true, grantor: 'person-1' }),
    { verified: 'yes', grantor: 'person-1' },
    null,
  ]) {
    const unapproved = await granted({}, { authorizeRenewal: () => answer });
    assert.throws(() => emergency.renewEmergencyPermission(unapproved, { expiresAt: '2026-10-06T00:00:00Z' }),
      /renew|authority|approv|owner|authoriz/i, JSON.stringify(String(answer)));
    assert.equal(emergency.getEmergencyState(unapproved, { ledger: ledgerFor(), now: AT }).expiresAt,
      '2026-10-05T00:00:00.000Z', 'a refused renewal leaves the clock the person signed');
  }
  const bare = await granted({}, { authorizeRenewal: undefined });
  assert.throws(() => emergency.renewEmergencyPermission(bare, { expiresAt: '2026-10-06T00:00:00Z' }, {
    authorizeRenewal: () => ({ verified: true, grantor: 'person-1' }),
  }), /renew|authority|approv|owner|authoriz/i, 'an authorizer chosen by the caller is not an approval');
  const approved = await granted({}, { authorizeRenewal: () => ({ verified: true, grantor: 'person-1' }) });
  assert.equal(emergency.renewEmergencyPermission(approved, { expiresAt: '2026-10-06T00:00:00Z' }).expiresAt,
    '2026-10-06T00:00:00.000Z', 'an approval that names the owner is enough, with or without a reason');
});