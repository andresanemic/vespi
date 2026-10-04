'use strict';

// K1 · the second independent reviewer's adversarial corpus, brought into this branch (fix round 2).
//
// Each case was written red by the reviewer against this branch; every title keeps the reviewer's
// R2## number so a failure can be traced back to it. The fixtures are this file's own, in the style
// of `emergency.test.js` and `k1-emergencia-advisor.test.js`; the assertions are the reviewer's,
// kept as they were written.
//
// The reviewer's `ADV18R` is kept here next to its case: it is the same objection as ADV18 from the
// first round (one read of `expiresAt`, the value that was validated is the value that gets
// stored), spelled on a permission that carries the renewal approver the first round now demands.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const { verifyReceipt } = require('../src/receipt.js');

const AT = '2026-10-04T12:00:00Z';
const NEXT = '2026-10-06T00:00:00Z';
// Synthetic. It stands for whatever text a hostile or careless host callback might put in an
// exception, and the point of these cases is that none of it reaches a receipt or a caller.
const SECRET = 'SYNTHETIC_PRIVATE_MARKER_R2';

const GRANT = (overrides = {}) => ({
  id: 'r2',
  owner: 'person',
  grantee: 'agent',
  destination: 'clinic',
  purpose: 'prior emergency access',
  actions: ['read'],
  scope: ['record'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
  maxUses: 2,
  reviewDueMs: 60000,
  triggers: [{ id: 't', verifierId: 'sensor' }],
  reviewers: ['person'],
  pausers: ['person'],
  ...overrides,
});

const REQUEST = (overrides = {}) => ({
  useId: 'u',
  actor: 'agent',
  action: 'read',
  subject: 'record',
  destination: 'clinic',
  triggerId: 't',
  triggerSignal: { id: 's', source: 'sensor', critical: true },
  ...overrides,
});

// The host decides who may grant and who may extend the clock. Neither answer is the kernel's.
const GRANTOR_OK = (candidate) => ({ verified: true, grantor: candidate.owner, reason: 'authorized' });
const RENEWAL_OK = (candidate) => ({ verified: true, grantor: candidate.owner, reason: 'authorized' });
const CRITICAL_ONLY = (trigger, signal) => ({ verified: signal && signal.critical === true });

async function granted(overrides = {}, deps = {}) {
  return emergency.createEmergencyPermission(GRANT(overrides), {
    authorizeGrantor: 'authorizeGrantor' in deps ? deps.authorizeGrantor : GRANTOR_OK,
    resolveVerifier: 'resolveVerifier' in deps ? deps.resolveVerifier : async (id) => ({ id, verify: CRITICAL_ONLY }),
    authorizeRenewal: 'authorizeRenewal' in deps ? deps.authorizeRenewal : RENEWAL_OK,
  });
}

const ledgerFor = () => emergency.createEmergencyLedger();
const run = (permission, ledger, request) => emergency.exerciseEmergency(permission, request || REQUEST(), { ledger, now: AT });
const state = (permission, ledger) => emergency.getEmergencyState(permission, { ledger, now: AT });
const throwing = (key) => Object.defineProperty({}, key, { get() { throw new Error(SECRET); } });
const privateError = (err) => {
  assert.ok(!String(err.stack || err).includes(SECRET), 'private callback error escaped');
  return true;
};

// ─── R201, R202: two real grants, one public id, two different people ────────────────────────

test('R201 a second real grant with the same id cannot close the first grant review', async () => {
  const permission = await granted();
  const other = await granted({ owner: 'other', reviewers: ['other'], pausers: ['other'] });
  const ledger = ledgerFor();
  run(permission, ledger);
  assert.throws(() => emergency.reviewEmergencyUse(other, 'u', { ledger, by: 'other', decision: 'accept', now: AT }));
  assert.equal(state(permission, ledger).pendingReview, 'u');
});

test('R202 a second real grant with the same id cannot revoke the first grant', async () => {
  const permission = await granted();
  const other = await granted({ owner: 'other', reviewers: ['other'], pausers: ['other'] });
  const ledger = ledgerFor();
  run(permission, ledger);
  try { emergency.revokeEmergencyPermission(other, { ledger, by: 'other' }); } catch { /* it has to fail closed */ }
  assert.equal(state(permission, ledger).revoked, false, 'one grant owner revoked a different owner grant');
  assert.equal(state(permission, ledger).pendingReview, 'u');
});

// The reviewer asks for the collision to fail closed without consuming, altering or revealing the
// other family's record, and for the state to show a conflict instead of availability. Both are
// stated here: R201b on the read side, R202c on the spend side, which is the only path a mutation
// of `claimRecord` alone can still get through while a review happens to be pending.
test('R201b a grant from another family reads a conflict in the state, never availability', async () => {
  const permission = await granted();
  const other = await granted({ owner: 'other', reviewers: ['other'], pausers: ['other'] });
  const ledger = ledgerFor();
  run(permission, ledger);
  const foreign = state(other, ledger);
  assert.notEqual(foreign.nextUse, 'allowed');
  assert.notEqual(foreign.nextUse, 'blocked_until_review', 'it must not report the other review');
  assert.equal(foreign.pendingReview, null, 'the other families review stays unrevealed');
  assert.equal(foreign.uses, 0, 'the other families count stays unrevealed');
  assert.equal(run(other, ledger).state, 'blocked');
  assert.equal(state(permission, ledger).pendingReview, 'u', 'the first grant is untouched');
});

test('R202c a grant from another family spends nothing from an idle record', async () => {
  const permission = await granted();
  const other = await granted({ owner: 'other', reviewers: ['other'], pausers: ['other'] });
  const ledger = ledgerFor();
  run(permission, ledger);
  emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'person', decision: 'accept', now: AT });
  const idle = state(permission, ledger);
  assert.equal(idle.pendingReview, null, 'the record is idle and available to its own family');
  const stolen = run(other, ledger, REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor', critical: true } }));
  assert.equal(stolen.state, 'blocked');
  assert.equal(state(permission, ledger).uses, idle.uses, 'the other family spent nothing');
  assert.equal(state(permission, ledger).pendingReview, null, 'and left no review behind');
  assert.equal(run(permission, ledger, REQUEST({ useId: 'u3', triggerSignal: { id: 's3', source: 'sensor', critical: true } })).state, 'review_pending',
    'the record is still usable by the family that opened it');
});

// ─── R203-R208: everything the host answers is read once and contained ───────────────────────

test('R203 resolver verify accessor cannot substitute a different function after validation', async () => {
  let reads = 0;
  const permission = await granted({}, {
    resolveVerifier: async (id) => ({
      id,
      get verify() {
        reads += 1;
        return reads === 1 ? () => ({ verified: false }) : () => ({ verified: true });
      },
    }),
  });
  const ledger = ledgerFor();
  assert.equal(run(permission, ledger, REQUEST({ triggerSignal: { id: 's', source: 'sensor', critical: false } })).state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
});

test('R204 grantor verified getter failure is sanitized', async () => {
  await assert.rejects(granted({}, { authorizeGrantor: () => throwing('verified') }), privateError);
});

test('R205 grantor grantor getter failure is sanitized', async () => {
  const answer = throwing('grantor');
  answer.verified = true;
  await assert.rejects(granted({}, { authorizeGrantor: () => answer }), privateError);
});

test('R206 renewal verified getter failure is sanitized and leaves original usable', async () => {
  const permission = await granted({}, { authorizeRenewal: () => throwing('verified') });
  assert.throws(() => emergency.renewEmergencyPermission(permission, { expiresAt: NEXT }), privateError);
  const ledger = ledgerFor();
  assert.equal(run(permission, ledger).state, 'review_pending');
});

test('R207 renewal then getter cannot echo a private exception containing asynchronously', async () => {
  const answer = { verified: true, grantor: 'person', get then() { throw new Error(`asynchronously ${SECRET}`); } };
  const permission = await granted({}, { authorizeRenewal: () => answer });
  assert.throws(() => emergency.renewEmergencyPermission(permission, { expiresAt: NEXT }), privateError);
});

test('R208 renewal approval reason is read once for public permission and private binding', async () => {
  let reads = 0;
  const permission = await granted({}, {
    authorizeRenewal: () => ({
      verified: true,
      grantor: 'person',
      get reason() { return ++reads === 1 ? 'approved reason' : 'different reason'; },
    }),
  });
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: NEXT });
  const ledger = ledgerFor();
  const receipt = run(renewed, ledger).receipt;
  assert.equal(receipt.authority.approval, renewed.grantVerification.reason);
  assert.equal(reads, 1);
});

// ─── R209, R210: the canonical copy has to survive a JSON __proto__ ───────────────────────────

test('R209 JSON __proto__ object must not produce a used receipt with null signal digest', async () => {
  const permission = await granted({}, { resolveVerifier: async (id) => ({ id, verify: () => ({ verified: true }) }) });
  const ledger = ledgerFor();
  const signal = JSON.parse('{"id":"s","source":"sensor","critical":true,"__proto__":{"private":7}}');
  const result = run(permission, ledger, REQUEST({ triggerSignal: signal }));
  if (result.state === 'blocked') {
    assert.equal(state(permission, ledger).uses, 0);
    return;
  }
  assert.match(result.receipt.trigger.signalDigest, /^[a-f0-9]{64}$/);
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('R210 JSON __proto__ primitive survives the signal snapshot or is refused', async () => {
  let body;
  const permission = await granted({}, {
    resolveVerifier: async (id) => ({ id, verify: (trigger, signal) => { body = signal; return { verified: true }; } }),
  });
  const ledger = ledgerFor();
  const signal = JSON.parse('{"id":"s","source":"sensor","critical":true,"__proto__":"declared-data"}');
  const result = run(permission, ledger, REQUEST({ triggerSignal: signal }));
  if (result.state === 'blocked') {
    assert.equal(state(permission, ledger).uses, 0);
    return;
  }
  assert.equal(Object.hasOwn(body, '__proto__'), true, 'a declared JSON field vanished');
  assert.equal(body.__proto__, 'declared-data');
});

// ─── R211: a nested field is read once, exactly like a top-level one ─────────────────────────

test('R211 nested trigger id accessor cannot bind an unchecked undefined id', async () => {
  let reads = 0;
  const trigger = { verifierId: 'sensor', get id() { return ++reads < 4 ? 't' : undefined; } };
  let permission;
  try {
    permission = await granted({ triggers: [trigger] });
  } catch {
    return; // refusing the shape is also honest, as long as nothing is granted from it
  }
  assert.equal(permission.triggers[0].id, 't', 'the granted trigger differs from the value validated');
});

// ─── R212-R214: the boundaries the reviewer confirmed, kept green ───────────────────────────

test('R212 verifier pausing authority mid-call spends nothing and the lock releases', async () => {
  const ledger = ledgerFor();
  let permission;
  let first = true;
  permission = await granted({}, {
    resolveVerifier: async (id) => ({
      id,
      verify: () => {
        if (first) {
          first = false;
          emergency.pauseEmergencyPermission(permission, { ledger, by: 'person' });
        }
        return { verified: true };
      },
    }),
  });
  assert.equal(run(permission, ledger).state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
  emergency.resumeEmergencyPermission(permission, { ledger, by: 'person' });
  assert.equal(run(permission, ledger).state, 'review_pending');
});

test('R213 renewed handles share revocation and pending review with their source grant', async () => {
  const permission = await granted();
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: NEXT });
  const ledger = ledgerFor();
  run(permission, ledger);
  assert.equal(run(renewed, ledger, REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor', critical: true } })).state, 'blocked');
  emergency.revokeEmergencyPermission(renewed, { ledger, by: 'person' });
  assert.equal(state(permission, ledger).revoked, true);
});

test('R214 throwing nested signal getter is contained without spending or caller mutation', async () => {
  const permission = await granted();
  const ledger = ledgerFor();
  const nested = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error(SECRET); } });
  const signal = { id: 's', source: 'sensor', nested };
  Object.freeze(signal);
  const result = run(permission, ledger, REQUEST({ triggerSignal: signal }));
  assert.equal(result.state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
  assert.ok(!JSON.stringify(result).includes(SECRET));
  assert.equal(signal.nested, nested);
});

test('ADV18R authorized renewal stores the single validated expiresAt read', async () => {
  const permission = await granted();
  let reads = 0;
  const renewed = emergency.renewEmergencyPermission(permission, {
    get expiresAt() { return ++reads === 1 ? NEXT : '2099-10-05T00:00:00Z'; },
  });
  assert.equal(Date.parse(renewed.expiresAt), Date.parse(NEXT));
  assert.equal(reads, 1);
});

// ─── R215: a held record is not an available one ─────────────────────────────────────────────

test('R215 state queried inside a verifier does not advertise an allowed concurrent use', async () => {
  const ledger = ledgerFor();
  let permission;
  let observed;
  permission = await granted({}, {
    resolveVerifier: async (id) => ({ id, verify: () => { observed = state(permission, ledger); return { verified: true }; } }),
  });
  assert.equal(run(permission, ledger).state, 'review_pending');
  assert.notEqual(observed.nextUse, 'allowed', 'exercise is held busy while state still advertises allowed');
});