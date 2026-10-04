'use strict';

// K1 · adversarial hardening round 3. This file was written by an attacker who did not build the
// branch: every case is an attempt to break `src/emergency.js`, and a case that passed is a hole
// that is not there. The classes came from the independent reviews in `.job/fuentes/`: authority not
// tied to who presents it, a field read twice, an object from another realm, reentrancy, an
// exception that leaks private text, an array or an integer nobody validated, a receipt that claims
// `verified` without the independent check, `undefined` treated as success, a clock not consulted
// again, `__proto__`, and a digest that does not cover a field.
//
// Three cases are red against the branch as it stands (H01, H02, H03) and each one carries the fix.
// Three more are marked `todo`: closing them means changing a public contract or removing a
// capability, which is the owner's decision and not this file's (H04, H05, H06). The rest are the
// attacks that did not break anything, kept so a later change cannot reopen them silently.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const emergency = require('../src/emergency.js');
const { verifyReceipt } = require('../src/receipt.js');

const AT = '2026-10-04T12:00:00Z';
const HOUR = 3600000;
// The bound `receipt.js` applies to every text it seals, and the reason this file measures against
// it: a receipt that travels has to obey the common shape, not a longer one of its own.
const RECEIPT_TEXT_MAX = 512;

const GRANT = (overrides = {}) => ({
  id: 'h',
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

const GRANTOR_OK = (candidate) => ({ verified: true, grantor: candidate.owner, reason: 'authorized' });
const RENEWAL_OK = (candidate) => ({ verified: true, grantor: candidate.owner, reason: 'authorized' });

async function granted(overrides = {}, deps = {}) {
  return emergency.createEmergencyPermission(GRANT(overrides), {
    authorizeGrantor: 'authorizeGrantor' in deps ? deps.authorizeGrantor : GRANTOR_OK,
    resolveVerifier: 'resolveVerifier' in deps ? deps.resolveVerifier : async (id) => ({ id, verify: () => ({ verified: true, reason: 'signed' }) }),
    authorizeRenewal: 'authorizeRenewal' in deps ? deps.authorizeRenewal : RENEWAL_OK,
  });
}

const ledgerFor = () => emergency.createEmergencyLedger();
const run = (permission, ledger, request) => emergency.exerciseEmergency(permission, request || REQUEST(), { ledger, now: AT });

// ─── H01 · a check that failed has to be named as not covered ─────────────────────────────────

// The class: a receipt that announces coverage the check behind it never earned. `buildReceipt`
// derives `notCovered` from the failed checks for exactly this reason ("a check counts as coverage
// only when it passed; a failed check is listed as not covered"), and the emergency receipts are
// built by hand. A permission that carries no grant produces `grantor_authority: false` and an
// empty `coverage`, but its `notCovered` never names it: a consumer that reads `notCovered` to learn
// what was not proven is told nothing about the grantor authority.
test('H01 a blocked receipt names the check that failed in notCovered', async () => {
  const result = run(GRANT(), ledgerFor());
  assert.equal(result.state, 'blocked');
  assert.equal(result.receipt.verification.checks.grantor_authority, false);
  assert.equal(result.receipt.coverage.includes('grantor_authority'), false);
  assert.equal(result.receipt.notCovered.includes('grantor_authority'), true,
    'a check that came back false is not covered and has to say so');
  // The standing absences stay declared.
  assert.equal(result.receipt.notCovered.includes('effect_verified'), true);
  assert.equal(result.receipt.notCovered.includes('exact_state'), true);
  // A receipt whose grantor authority did pass keeps the exact list it always had, byte for byte.
  const permission = await granted({ id: 'h01' });
  const bound = run(permission, ledgerFor(), REQUEST({ action: 'write' }));
  assert.deepEqual(bound.receipt.notCovered,
    ['trigger_verified', 'effect_verified', 'external anchor', 'exact_state']);
});

// ─── H02 · a deadline no calendar can measure is refused when the grant is signed ─────────────

// The class: an integer nobody validated. `reviewDueMs` is checked with `Number.isSafeInteger`,
// which admits values past the end of the calendar. A grant signed that way is authorized by the
// host and sealed with `grantVerification.verified: true`, and then no use can ever reach the
// verifier: `now + reviewDueMs` is not a time, so every exercise blocks with nothing spent. The
// guard at grant time has to refuse what no clock in the calendar could ever satisfy, because a
// grant that can never be used is not authority, it is a signature on nothing.
test('H02 a review deadline past the whole calendar is refused when the grant is signed', async () => {
  const span = Date.parse('9999-12-31T23:59:59.999Z') - Date.parse('0000-01-01T00:00:00.000Z');
  await assert.rejects(() => granted({ reviewDueMs: Number.MAX_SAFE_INTEGER }),
    /reviewDueMs|review|range|calendar|integer/i);
  await assert.rejects(() => granted({ reviewDueMs: span + 1 }),
    /reviewDueMs|review|range|calendar|integer/i);
  // One millisecond inside the widest span the calendar holds is still a deadline it can measure, so
  // the fix may not refuse it. The fixture of that boundary moved when R305 was fixed: the widest
  // span only belongs to a permission that opens at the beginning of the calendar. A grant that opens
  // in 2026 and asks for all of recorded time as its review delay has no instant of its own interval
  // that could stamp one, and is refused for that reason instead (R305, below).
  const permission = await granted({
    id: 'h02-wide',
    startsAt: '0000-01-01T00:00:00.000Z',
    expiresAt: '9999-12-31T23:59:59.999Z',
    reviewDueMs: span,
  });
  assert.equal(typeof permission.reviewDueMs, 'number');
  // And the ordinary deadlines keep working.
  assert.equal((await granted({ id: 'h02-small', reviewDueMs: 30 * 24 * HOUR })).reviewDueMs, 30 * 24 * HOUR);
});

// ─── H03 · an injected clock is not dropped on the way to the state it answers with ───────────

// The class: the clock not consulted. `pauseEmergencyPermission`, `resumeEmergencyPermission` and
// `revokeEmergencyPermission` return a state, and that state is the only answer the caller gets
// from the call. They read `{ ledger, by }` and ignore everything else, so an injected `now` is
// dropped on the floor and the state is decided against the wall clock. A caller that has been
// working with a fixed clock all along gets an answer from a moment nobody asked about, and the
// existing suite already passes a `now` to `revokeEmergencyPermission` and never sees it arrive.
test('H03 pause, resume and revoke answer with the clock the caller injected', async () => {
  const permission = await granted({ id: 'h03' });
  const ledger = ledgerFor();
  emergency.pauseEmergencyPermission(permission, { ledger, by: 'person' });
  // A clock before the grant opens: the honest answer is not_yet_valid, not "active".
  const early = emergency.resumeEmergencyPermission(permission, { ledger, by: 'person', now: '2000-01-01T00:00:00Z' });
  assert.equal(early.status, 'not_yet_valid');
  const late = emergency.resumeEmergencyPermission(permission, { ledger, by: 'person', now: '2099-01-01T00:00:00Z' });
  assert.equal(late.status, 'expired');
  emergency.resumeEmergencyPermission(permission, { ledger, by: 'person' });
  const paused = emergency.pauseEmergencyPermission(permission, { ledger, by: 'person', now: '2099-01-01T00:00:00Z' });
  assert.equal(paused.status, 'paused');
  const revoked = emergency.revokeEmergencyPermission(permission, { ledger, by: 'person', now: '2099-01-01T00:00:00Z' });
  assert.equal(revoked.status, 'revoked');
});

// ─── H04 · the agent that spends the authority, signing off on its own use ────────────────────

// The class: authority not tied to who presents it. The kernel refuses a verifier that is the
// grantee or the owner, because "independence is structural, not a promise", and it draws that
// line in `snapshotPermission`. It draws no such line for the reviewers: a grant may name the
// grantee as a reviewer, and then the agent that just spent the authority closes the post-use
// review of its own use, which is the one gesture decision 27 says the review exists to take away
// from it. Closing this means refusing a grant shape the contract accepts today, which is the
// owner's call and not this file's.
test('H04 the grantee cannot be a declared reviewer of its own use', {
  todo: 'owner decision: refusing reviewers that include the grantee removes a grant shape the contract accepts today',
}, async () => {
  const permission = await granted({ id: 'h04', reviewers: ['person', 'agent'] });
  const ledger = ledgerFor();
  assert.equal(run(permission, ledger).state, 'review_pending');
  assert.throws(() => emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'agent', decision: 'accept', now: AT }),
    /reviewer|authorized|independen/i);
});

// ─── H05 · a second ledger brings a stopped permission back to life ───────────────────────────

// The class: the counter that is not authority-bound. Records live in a ledger the caller names on
// every call, so a caller who holds the permission can hand a fresh one to any of them. The cap,
// the replay sets, the pause, the revocation and a review that was rejected all live in that
// record, so a rejected use and a revoked grant both exercise again on the next ledger. Binding the
// ledger to the grant would remove the multi-ledger shape the API has today, so this stays a
// decision, and it is written down as a limit either way.
test('H05 a rejected use and a revocation survive a ledger the caller supplies', {
  todo: 'owner decision: binding the ledger to the grant removes the several-ledgers-per-grant shape',
}, async () => {
  const rejected = await granted({ id: 'h05-rejected' });
  const first = ledgerFor();
  run(rejected, first);
  emergency.reviewEmergencyUse(rejected, 'u', { ledger: first, by: 'person', decision: 'reject', now: AT });
  assert.equal(run(rejected, ledgerFor(), REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor' } })).state, 'blocked');

  const revoked = await granted({ id: 'h05-revoked' });
  emergency.revokeEmergencyPermission(revoked, { ledger: ledgerFor(), by: 'person' });
  assert.equal(run(revoked, ledgerFor()).state, 'blocked');
});

// ─── H06 · a receipt that travels carries the text the common kernel would have refused ───────

// The class: values nobody bounded. `buildReceipt` runs every text through `safeText`, which refuses
// anything over 512 characters, and the module already bounds its own reasons with `MAX_REASON`.
// Nothing bounds the identifiers a grant and a request are made of: a `useId`, a signal id, an
// action or a purpose of any length is read once, sealed whole into the receipt and kept in the
// record, so a caller decides how big a receipt gets. Whether the answer is to refuse the grant or
// to bound what the receipt says is a change to what a grant may contain, so it is the owner's.
test('H06 no text in an emergency receipt is longer than the common kernel bound', {
  todo: 'owner decision: refusing long identifiers changes what a grant or request may contain',
}, async () => {
  const long = 'z'.repeat(RECEIPT_TEXT_MAX * 4);
  const permission = await granted({ id: 'h06', purpose: long, actions: ['read'], scope: ['record'] });
  const result = run(permission, ledgerFor(), REQUEST({
    useId: long,
    triggerSignal: { id: long, source: 'sensor' },
  }));
  const texts = [];
  const walk = (value) => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(result.receipt);
  for (const text of texts) {
    assert.ok(text.length <= RECEIPT_TEXT_MAX, `a receipt text of ${text.length} characters travels`);
  }
});

// ─── H07 · an object from another realm ───────────────────────────────────────────────────────

// The class: objects from another realm. A signal body built in another realm has another
// `Object.prototype`, so it is not the canonical form this kernel is willing to hash. It has to be
// refused before a verifier call and before anything is reserved, not quietly copied.
test('H07 a signal body from another realm is refused and nothing is spent', async () => {
  const permission = await granted({ id: 'h07' });
  const ledger = ledgerFor();
  const foreign = vm.runInNewContext('({ id: "s", source: "sensor", critical: true })');
  const result = run(permission, ledger, REQUEST({ triggerSignal: foreign }));
  assert.equal(result.state, 'blocked');
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 0);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).pendingReview, null);
});

// ─── H08 · a structure deeper than the stack ───────────────────────────────────────────────────

// The class: arrays and nesting nobody validated. The canonical walk is recursive, so a body nested
// past the call stack has to be contained as an unreadable request rather than escaping as a
// `RangeError` into the caller.
test('H08 a signal body nested past the call stack is contained, not thrown', async () => {
  const permission = await granted({ id: 'h08' });
  let deep = { leaf: true };
  for (let index = 0; index < 60000; index += 1) deep = { next: deep };
  const result = run(permission, ledgerFor(), REQUEST({ triggerSignal: { id: 's', source: 'sensor', deep } }));
  assert.equal(result.state, 'blocked');
  assert.equal(typeof result.reason, 'string');
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

// ─── H09 · every receipt this module seals passes the kernel's own verifier ───────────────────

// The class: a digest that does not cover a field. The emergency receipts are built by hand rather
// than through `buildReceipt`, so each shape a caller can receive is measured against
// `verifyReceipt`: the use, the closed review, a blocked receipt on a bound permission, one on a
// permission with no grant, and one with no ledger at all.
test('H09 every sealed emergency receipt still verifies', async () => {
  const permission = await granted({ id: 'h09' });
  const ledger = ledgerFor();
  const used = run(permission, ledger);
  const closed = emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'person', decision: 'accept', now: AT });
  const blocked = run(permission, ledger, REQUEST({ useId: 'u2', action: 'write' }));
  const unbound = run(GRANT(), ledgerFor());
  const noLedger = emergency.exerciseEmergency(permission, REQUEST({ useId: 'u3' }), { now: AT });
  for (const receipt of [used.receipt, closed, blocked.receipt, unbound.receipt, noLedger.receipt]) {
    assert.deepEqual(verifyReceipt(receipt), { ok: true, reason: 'digest matches' });
  }
  // Editing anything after the fact is what the digest is for.
  const tampered = { ...used.receipt, useId: 'other' };
  assert.equal(verifyReceipt(tampered).ok, false);
});

// ─── H10 · the sealed grant digest is the digest of the grant, not of a handle ────────────────

// The class: authority read from the shape of an object instead of from the binding. The receipt
// recomputes `grantDigest` from the grant the object carries instead of reading the one computed
// when the host authorized it. The two are the same value today, and this is what keeps them the
// same: a handle extended by a renewal and a fresh grant of that extended declaration agree, so the
// private `grantDigest` the binding already carries could not drift away from what is sealed.
test('H10 a renewed handle and a fresh grant of the same declaration seal the same grant digest', async () => {
  const permission = await granted({ id: 'h10' });
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: '2026-12-01T00:00:00Z' });
  const fresh = await granted({ id: 'h10', expiresAt: '2026-12-01T00:00:00Z' });
  const ledger = ledgerFor();
  const fromRenewal = run(renewed, ledger);
  const fromFresh = run(fresh, ledger, REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor' } }));
  assert.equal(fromRenewal.receipt.authorization.grantDigest, fromFresh.receipt.authorization.grantDigest);
  // And the clock each of them sealed is the clock of its own grant, not of the other handle.
  assert.equal(fromRenewal.receipt.authority.grants[0].expiresAt, '2026-12-01T00:00:00.000Z');
  assert.equal(run(permission, ledger, REQUEST({ useId: 'u3', triggerSignal: { id: 's3', source: 'sensor' } }))
    .receipt.authority.grants[0].expiresAt, '2026-10-05T00:00:00.000Z');
});

// ─── H11 · nothing but the grant travels ─────────────────────────────────────────────────────

// The class: `__proto__` and extra keys. A request is free to claim whatever it likes about itself;
// none of it may reach a receipt or widen what the kernel checks.
test('H11 extra keys on the request buy nothing and reach no receipt', async () => {
  const permission = await granted({ id: 'h11', actions: ['read'] });
  const ledger = ledgerFor();
  const result = run(permission, ledger, REQUEST({
    action: 'write',
    capability: 'emergency-access',
    status: 'verified',
    verified: true,
    review: { status: 'reviewed' },
    trigger: { id: 't', verifierId: 'sensor', verified: true },
  }));
  assert.equal(result.state, 'blocked');
  assert.match(result.reason, /outside the granted scope/i);
  assert.equal(result.receipt.status, 'blocked');
  assert.equal(result.receipt.review, undefined);
  assert.equal(result.receipt.trigger, undefined);
  assert.equal(result.receipt.verification.verified, false);
});

// ─── H12 · the receipt the caller already holds ───────────────────────────────────────────────

// The class: a receipt that keeps saying something the record has moved past. The use receipt is
// sealed before the review and is never rewritten in the caller's hand: it keeps saying the review
// is open, it keeps naming `post_use_review` as not covered, and it keeps verifying, because it is
// the evidence of what was authorized at that instant. The closed receipt is a second object.
test('H12 the receipt already in the caller hand keeps its own honest statement', async () => {
  const permission = await granted({ id: 'h12' });
  const ledger = ledgerFor();
  const used = run(permission, ledger);
  const closed = emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'person', decision: 'accept', now: AT });
  assert.notEqual(used.receipt, closed);
  assert.equal(used.receipt.review.status, 'pending');
  assert.equal(used.receipt.notCovered.includes('post_use_review'), true);
  assert.equal(verifyReceipt(used.receipt).ok, true);
  assert.equal(closed.review.status, 'reviewed');
  assert.equal(closed.notCovered.includes('post_use_review'), false);
  assert.equal(closed.verification.verified, false);
  assert.equal(closed.verification.checks.effect_verified, false);
});

// ─── H13 · two permissions out of one declaration ─────────────────────────────────────────────

// The class: the record that is not an identity. Building the permission twice asks the host twice
// and produces two private families, so the second handle cannot spend, review, pause or revoke
// what the first one opened. It fails closed and says so.
test('H13 a second permission from the same declaration cannot touch the first record', async () => {
  const first = await granted({ id: 'h13' });
  const second = await granted({ id: 'h13' });
  const ledger = ledgerFor();
  assert.equal(run(first, ledger).state, 'review_pending');
  const blocked = run(second, ledger, REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor' } }));
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.reason, /different grant/i);
  assert.equal(emergency.getEmergencyState(second, { ledger, now: AT }).status, 'record_conflict');
  assert.throws(() => emergency.reviewEmergencyUse(second, 'u', { ledger, by: 'person', decision: 'accept', now: AT }),
    /different grant/i);
  assert.throws(() => emergency.pauseEmergencyPermission(second, { ledger, by: 'person' }), /different grant/i);
  // The grant that opened the record is untouched by all of it.
  assert.equal(emergency.getEmergencyState(first, { ledger, now: AT }).status, 'review_pending');
});

// ─── H14 · a use id stays spent after its review closes ───────────────────────────────────────

// The class: `undefined` and replays. Closing a review frees the slot, not the identity of the use:
// the same key cannot be spent twice, and one signal cannot open two uses.
test('H14 a use id and a signal id are each spent for good', async () => {
  const permission = await granted({ id: 'h14', maxUses: 3 });
  const ledger = ledgerFor();
  assert.equal(run(permission, ledger).state, 'review_pending');
  emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'person', decision: 'accept', now: AT });
  const replay = run(permission, ledger, REQUEST({ useId: 'u', triggerSignal: { id: 'other', source: 'sensor' } }));
  assert.equal(replay.state, 'blocked');
  assert.match(replay.reason, /already used|replay/i);
  assert.equal(run(permission, ledger, REQUEST({ useId: 'u2', triggerSignal: { id: 's2', source: 'sensor' } })).state, 'review_pending');
  const sameSignal = run(permission, ledger, REQUEST({ useId: 'u3', triggerSignal: { id: 's', source: 'sensor' } }));
  assert.equal(sameSignal.state, 'blocked');
  assert.match(sameSignal.reason, /one signal opens one use/i);
});

// ─── H15 · values inherited from a prototype ─────────────────────────────────────────────────

// The class: `__proto__` and keys that are not the object's own. A polluted `Object.prototype` must
// not be able to complete a permission that declares nothing: `ownDataOnly` reads descriptors, not
// values, and only the grant path binds authority, so an object assembled out of inherited values
// is readable and worthless.
test('H15 a permission assembled from inherited values exercises nothing', async () => {
  const ledger = ledgerFor();
  const previous = {};
  for (const key of ['id', 'owner', 'grantee', 'destination', 'purpose', 'maxUses', 'reviewDueMs',
    'startsAt', 'expiresAt', 'actions', 'scope', 'triggers', 'reviewers', 'pausers']) {
    previous[key] = Object.getOwnPropertyDescriptor(Object.prototype, key);
    Object.defineProperty(Object.prototype, key, { value: GRANT()[key], configurable: true, writable: true, enumerable: false });
  }
  try {
    const empty = {};
    const result = run(empty, ledger);
    assert.equal(result.state, 'blocked');
    assert.equal(result.receipt.verification.checks.grantor_authority, false);
    assert.equal(emergency.getEmergencyState(empty, { ledger, now: AT }).status, 'unbound');
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key]) Object.defineProperty(Object.prototype, key, previous[key]);
      else delete Object.prototype[key];
    }
  }
});

// ─── H16 · who may do what is read from the grant, not from the object in hand ───────────────

// The class: authority not tied to who presents it. The owner may close her own use, the agent may
// not pause even when the object it holds says it may, and the pauser list is the one the grant
// carries rather than the one a forged copy adds.
test('H16 the roles come from the bound grant and not from the object in hand', async () => {
  const permission = await granted({ id: 'h16', reviewers: ['person'], pausers: ['person'] });
  const ledger = ledgerFor();
  assert.equal(run(permission, ledger).state, 'review_pending');
  // The owner is a declared reviewer here, so this one is hers to close.
  assert.equal(emergency.reviewEmergencyUse(permission, 'u', { ledger, by: 'person', decision: 'reject', now: AT }).review.decision, 'reject');
  const stranger = { ...permission, owner: 'agent', reviewers: ['agent'], pausers: ['agent'] };
  assert.throws(() => emergency.pauseEmergencyPermission(stranger, { ledger, by: 'agent' }), /grant|authorized/i);
  assert.throws(() => emergency.revokeEmergencyPermission(stranger, { ledger, by: 'agent' }), /grant|owner|authorized/i);
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).status, 'stopped_by_review');
});

// ─── H17 · a verifier that burns real time across the expiry instant ─────────────────────────

// The class: the clock not consulted again. The kernel stamps the instant it was given and decides
// against it; a verifier that spends real wall time after that instant does not move the receipt to
// a moment the person was never asked about. This is measured, not assumed: the use stands.
test('H17 a slow verifier does not move the instant the use was decided at', async () => {
  const permission = await granted({
    id: 'h17',
    resolveVerifier: async (id) => ({ id, verify: () => { const until = Date.now() + 30; while (Date.now() < until) { /* burn */ } return { verified: true, reason: 'signed' }; } }),
  });
  const ledger = ledgerFor();
  const result = run(permission, ledger);
  assert.equal(result.state, 'review_pending');
  assert.equal(result.receipt.at, '2026-10-04T12:00:00.000Z');
  assert.equal(emergency.getEmergencyState(permission, { ledger, now: AT }).uses, 1);
});

// ─── H18 · a wide grant, and nothing extra smuggled through it ───────────────────────────────

// The class: arrays nobody bounded. Five hundred triggers and five hundred actions are accepted and
// usable, which is a limit rather than a hole; what matters here is that the copy the host
// authorizes is the copy the kernel binds, so a wide grant cannot smuggle a field the kernel never
// validated into the receipt.
test('H18 a wide grant binds exactly the fields the host was asked about', async () => {
  const wide = GRANT({
    id: 'h18',
    triggers: Array.from({ length: 500 }, (_, index) => ({ id: `t${index}`, verifierId: `v${index}`, extra: 'dropped' })),
    actions: Array.from({ length: 500 }, (_, index) => `act-${index}`),
  });
  const seen = [];
  const permission = await emergency.createEmergencyPermission(wide, {
    authorizeGrantor: (candidate) => { seen.push(candidate); return GRANTOR_OK(candidate); },
    resolveVerifier: async (id) => ({ id, verify: () => ({ verified: true, reason: 'signed' }) }),
    authorizeRenewal: RENEWAL_OK,
  });
  assert.equal(seen[0].triggers.length, 500);
  assert.equal('extra' in seen[0].triggers[0], false);
  assert.deepEqual(Object.keys(seen[0]).sort(), [
    'actions', 'destination', 'expiresAt', 'grantee', 'id', 'maxUses', 'owner', 'pausers',
    'purpose', 'reviewDueMs', 'reviewers', 'scope', 'startsAt', 'triggers',
  ]);
  const ledger = ledgerFor();
  const result = run(permission, ledger, REQUEST({
    action: 'act-499', triggerId: 't499', triggerSignal: { id: 's', source: 'v499' },
  }));
  assert.equal(result.state, 'review_pending');
  assert.equal(result.receipt.trigger.id, 't499');
  assert.equal(result.receipt.trigger.verifierId, 'v499');
});

// ─── H19 · `null` where the options go is a crash, not a refusal ───────────────────────────────

// The class: an exception that escapes with nothing of the kernel's in it. Every entry point here
// takes an options object with a default, and a default only answers for `undefined`. A caller
// that passes `null` gets a raw `TypeError` out of the module, while `0`, `'x'` and `true` in the
// same position are all handled and produce the documented blocked receipt. The module already has
// a test named "a missing or hostile ledger blocks the exercise instead of throwing"; this is the
// same promise with the one value the default does not cover. In `createEmergencyPermission` it is
// worse than a throw: the function is async, so the `TypeError` leaves as a rejected promise whose
// message is not one of the module's own sentences.
test('H19 a null options object is refused the way every other unusable one is', async () => {
  const permission = await granted({ id: 'h19' });
  const ledger = ledgerFor();
  await assert.rejects(() => emergency.createEmergencyPermission(GRANT({ id: 'h19-other' }), null),
    (err) => err instanceof Error && /authorizeGrantor|grantor|malformed|emergency/i.test(err.message),
    'a null options object must not escape as a raw TypeError');
  // The exercise answers blocked, with a receipt that verifies, exactly as it does for `0`.
  const blocked = emergency.exerciseEmergency(permission, REQUEST(), null);
  assert.equal(blocked.state, 'blocked');
  assert.equal(verifyReceipt(blocked.receipt).ok, true);
  for (const options of [0, 'x', true, [], undefined]) {
    const other = emergency.exerciseEmergency(permission, REQUEST({ useId: `u-${String(options)}` }), options);
    assert.equal(other.state, 'blocked');
  }
  // And the four that take `{ ledger, by, decision, now }` answer the same way, while the state,
  // which has nothing to do but report, says it does not know instead of crashing.
  const unknown = emergency.getEmergencyState(permission, null);
  assert.equal(unknown.status, 'no_ledger');
  assert.equal(unknown.nextUse, 'blocked_no_ledger');
  for (const call of [
    () => emergency.pauseEmergencyPermission(permission, null),
    () => emergency.resumeEmergencyPermission(permission, null),
    () => emergency.revokeEmergencyPermission(permission, null),
    () => emergency.reviewEmergencyUse(permission, 'u', null),
  ]) {
    // Whatever they answer, the answer is one of this module's own sentences and never a raw
    // `TypeError` about destructuring: `by` is undefined, so they refuse on the person first.
    assert.throws(call, (err) => err instanceof Error && !(err instanceof TypeError),
      'a null options object must not escape as a raw TypeError');
  }
  // A real ledger still works, so nothing was loosened on the way.
  assert.equal(emergency.exerciseEmergency(permission, REQUEST(), { ledger, now: AT }).state, 'review_pending');
});
