'use strict';

// K1 · the fourth independent reviewer's adversarial corpus, brought into this branch (fix round 4).
//
// Every title keeps the reviewer's R4## number so a failure can be traced back to it. The fixtures are
// this file's own, in the style of `emergency.test.js`; the assertions are the reviewer's, kept as they
// were written, plus the boundary cases the review asked to see proved at both edges (A02) and the
// positive controls a refusal needs beside it (A03).
//
// The one thing that is new in this round is the host's authentication port. The reviewer's conclusion
// was that the identity surface cannot be exhausted by enumerating aliases: it needs a door the host
// keeps. So `authenticate` is required at the grant, and every `by` is a principal that port issued,
// compared by reference. A declared name is no longer a caller, and these cases say so.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const emergency = require('../src/emergency.js');
const delegation = require('../src/delegation.js');
const { verifyReceipt } = require('../src/receipt.js');
const { createHost } = require('./emergency-host.js');

const AT = '2026-10-04T12:00:00Z';
// One simulated host for this file. Its aliases are set inside the cases that need one.
const host = createHost();

const GRANT = (overrides = {}) => ({
  id: 'r4',
  owner: 'person',
  grantee: 'agent',
  destination: 'clinic',
  purpose: 'emergency reservation',
  actions: ['read'],
  scope: ['record'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-05T00:00:00Z',
  maxUses: 3,
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

const APPROVE = (candidate) => ({ verified: true, grantor: candidate.owner, reason: 'authorized' });

async function granted(overrides = {}, verify = () => ({ verified: true }), deps = {}) {
  return emergency.createEmergencyPermission({ ...GRANT(), ...overrides }, {
    authenticate: 'authenticate' in deps ? deps.authenticate : host.authenticate,
    authorizeGrantor: 'authorizeGrantor' in deps ? deps.authorizeGrantor : APPROVE,
    resolveVerifier: (id) => ({ id, verify }),
    authorizeRenewal: 'authorizeRenewal' in deps ? deps.authorizeRenewal : APPROVE,
  });
}

const run = (permission, ledger, request) => emergency.exerciseEmergency(permission, request || REQUEST(), { ledger, now: AT });
const state = (permission, ledger) => emergency.getEmergencyState(permission, { ledger, now: AT });
const close = (permission, ledger, by, decision) => emergency.reviewEmergencyUse(permission, 'u', { ledger, by, decision: decision || 'accept', now: AT });

// ─── A01 · the host's door: every `by` is a principal, never a name ────────────────────────────

test('A01-R401 the exercising agent cannot close its review by claiming the declared reviewer name', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  assert.equal(run(permission, ledger).state, 'review_pending');
  // No host callback is called for this transition, and no reviewer capability was given to this
  // caller. What it holds is the permission and the ledger.
  assert.throws(() => close(permission, ledger, 'person'), /principal|authenticate|name/i);
  assert.equal(state(permission, ledger).pendingReview, 'u');
});

test('A01-R401 the principal the host issues for the grantee cannot close the review either', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  run(permission, ledger);
  // Even the genuine principal of the agent that spent the authority is refused: independence is a
  // property of the port's answer, not of a name that happens to sit in the reviewers list.
  assert.throws(() => close(permission, ledger, host.principal('agent')), /independent|grantee|review|principal/i);
  assert.equal(state(permission, ledger).pendingReview, 'u');
});

test('A01-R402 a known alias of the exercising principal cannot be its independent reviewer', async () => {
  // The alias is the host's statement, kept deliberately: two different declared names are one person.
  host.aliases.set('agent-review', 'agent');
  try {
    await assert.rejects(() => granted({ reviewers: ['agent-review'] }), /independent|grantee|reviewer|principal/i);
  } finally {
    host.aliases.delete('agent-review');
  }
});

test('A01-R403 delegating a self-review does not make the agent independent of its own use', async () => {
  const permission = await granted({ reviewers: ['agent-helper'] });
  const ledger = emergency.createEmergencyLedger();
  run(permission, ledger);
  const chain = delegation.createDelegation({
    task: 'accept my emergency use',
    medium: { cwd: 'C:/synthetic', material: [], forbidden: [] },
    delegate: 'agent-helper',
    orchestrator: 'agent',
    now: () => AT,
  });
  assert.equal(chain.orchestrator, permission.grantee);
  assert.throws(() => close(permission, ledger, chain.delegate), /principal|authenticate|name|delegat/i);
  assert.equal(state(permission, ledger).pendingReview, 'u');
  // And the boundary, stated as a test instead of a promise: when the host says the delegate IS a
  // different person, the review closes. This kernel cannot read a delegation, so the independence of
  // a delegated review is exactly as strong as the port that authenticated it, and not one step more.
  assert.equal(verifyReceipt(close(permission, ledger, host.principal('agent-helper'))).ok, true);
  assert.equal(state(permission, ledger).pendingReview, null);
});

test('A01-R414 the exercising agent cannot undo a real pause merely by claiming a pauser name', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  emergency.pauseEmergencyPermission(permission, { ledger, by: host.principal('person'), now: AT });
  assert.throws(
    () => emergency.resumeEmergencyPermission(permission, { ledger, by: 'person', now: AT }),
    /principal|authenticate|name|pause/i,
  );
  // And the port's own answer for the agent that spent the authority cannot lift a pause either.
  assert.throws(
    () => emergency.resumeEmergencyPermission(permission, { ledger, by: host.principal('agent'), now: AT }),
    /independent|grantee|principal|pause/i,
  );
  assert.equal(state(permission, ledger).paused, true);
  assert.equal(run(permission, ledger).state, 'blocked');
});

test('A01 the module fails closed when the authentication port is missing or answers badly', async () => {
  await assert.rejects(() => granted({}, undefined, { authenticate: undefined }), /authenticate|principal|required/i);
  await assert.rejects(() => granted({}, undefined, { authenticate: () => 'person' }), /authenticate|principal|malformed|frozen/i);
  await assert.rejects(() => granted({}, undefined, { authenticate: () => Object.freeze({ name: 'person' }) && Promise.resolve(host.principal('person')) }), /asynchronous|authenticate|principal/i);
  await assert.rejects(() => granted({}, undefined, { authenticate: () => { throw new Error('simulated host failure'); } }), /authenticate|principal|simulated host failure|verified/i);
  // A port that answers the same principal for the owner and the grantee has declared that the person
  // who granted the authority is the agent it was granted to.
  await assert.rejects(
    () => granted({}, undefined, { authenticate: () => host.principal('person') }),
    /independent|owner|grantee|principal/i,
  );
  // And a grant is refused before anything was bound: the honest answer when the door is closed is no
  // permission at all, not a permission nobody authenticated.
  assert.equal(state(Object.freeze({ ...GRANT() }), emergency.createEmergencyLedger()).status, 'unbound');
});

test('A01 every administrative role takes the port’s principal and not a name', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  assert.throws(() => emergency.revokeEmergencyPermission(permission, { ledger, by: 'person', now: AT }), /principal|authenticate|name/i);
  assert.throws(() => emergency.pauseEmergencyPermission(permission, { ledger, by: 'person', now: AT }), /principal|authenticate|name/i);
  assert.throws(() => close(permission, ledger, 'person'), /principal|authenticate|name/i);
  // A principal no grant in this process ever saw is not one either: the brand is the port's.
  assert.throws(
    () => emergency.revokeEmergencyPermission(permission, { ledger, by: Object.freeze({ principal: 'forged' }), now: AT }),
    /principal|authenticate|issued|owner/i,
  );
  assert.equal(state(permission, ledger).revoked, false);
});

// ─── A02 · the value budget has to answer for bytes, not only for values ───────────────────────

test('A02-R412 the body value budget does not permit an arbitrarily large scalar string', async () => {
  let calls = 0;
  const permission = await granted({}, () => { calls += 1; return { verified: true }; });
  const ledger = emergency.createEmergencyLedger();
  const request = REQUEST({ triggerSignal: { id: 's', source: 'sensor', critical: true, payload: 'x'.repeat(1024 * 1024) } });
  assert.equal(run(permission, ledger, request).state, 'blocked');
  assert.equal(calls, 0);
  assert.equal(state(permission, ledger).uses, 0);
});

test('A02-R412 both edges of the byte budget are proved, not approximated', async () => {
  // The budget counts every key and every string of one body. For
  // `{ id, source, critical, payload }` that is the keys 'critical'(8) 'id'(2) 'payload'(7)
  // 'source'(6) plus the strings 's'(1) 'sensor'(6) and the payload, and a boolean costs nothing:
  // 30 bytes before the payload starts.
  const BOUND = 65536;
  const payload = (total) => {
    const n = total - 30;
    return REQUEST({ triggerSignal: { id: 's', source: 'sensor', critical: true, payload: 'x'.repeat(n) } });
  };
  const at = await granted({}, () => ({ verified: true }));
  const over = await granted({}, () => ({ verified: true }));
  assert.equal(run(at, emergency.createEmergencyLedger(), payload(BOUND)).state, 'review_pending');
  assert.equal(run(over, emergency.createEmergencyLedger(), payload(BOUND + 1)).state, 'blocked');
});

// ─── A03 · a grant too wide to fingerprint carries no authority at all ─────────────────────────

test('A03-R413 a grant too wide for its own canonical budget cannot be approved with a null grant digest', async () => {
  // 4096 actions is past the value budget of one canonical walk, so this grant has no fingerprint and
  // a permission built from it would spend authority under a receipt that carries no digest of what
  // was granted. The door refuses it instead, and nothing is authorized.
  await assert.rejects(
    () => granted({ actions: Array.from({ length: 4096 }, (unused, index) => `a${index}`) }),
    /fingerprint|too wide|representable|budget/i,
  );
  // The positive control beside it: a grant the kernel can fingerprint gets its 64 hex characters,
  // and the receipt that spends it names exactly those.
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  const receipt = run(permission, ledger).receipt;
  assert.equal(verifyReceipt(receipt).ok, true);
  assert.match(receipt.authorization.grantDigest, /^[a-f0-9]{64}$/);
});