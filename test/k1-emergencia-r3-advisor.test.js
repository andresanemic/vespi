'use strict';

// K1 · the third independent reviewer's adversarial corpus, brought into this branch (fix round 3).
//
// Each case was written red by the reviewer against this branch; every title keeps the reviewer's
// R3## number so a failure can be traced back to it. The fixtures are this file's own, in the style
// of `emergency.test.js` and `k1-emergencia-r2-advisor.test.js`; the assertions are the reviewer's,
// kept as they were written, except where the review itself said a fixture had to move (R305 and the
// H02 boundary it contradicts) and where this round decided to refuse long texts instead of
// shortening them (H06).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const emergency = require('../src/emergency.js');
const { createHost } = require('./emergency-host.js');

// One SIMULATED authentication port for this file: it answers with a frozen object per declared
// name and hands back the same object for the same person. See `emergency-host.js`.
const host = createHost();
const { verifyReceipt } = require('../src/receipt.js');

const AT = '2026-10-04T12:00:00Z';
// Synthetic. It stands for whatever text a hostile options object would put in an exception, and
// the point of the R301 cases is that none of it reaches the caller.
const MARKER = 'synthetic-r3-private-exception';

const GRANT = (overrides = {}) => ({
  id: 'r3',
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

async function granted(overrides = {}, verify = () => ({ verified: true })) {
  return emergency.createEmergencyPermission({ ...GRANT(), ...overrides }, {
    authenticate: host.authenticate,
    authorizeGrantor: APPROVE,
    resolveVerifier: (id) => ({ id, verify }),
    authorizeRenewal: APPROVE,
  });
}

const run = (permission, ledger, request) => emergency.exerciseEmergency(permission, request || REQUEST(), { ledger, now: AT });
const state = (permission, ledger) => emergency.getEmergencyState(permission, { ledger, now: AT });
const close = (permission, ledger, useId) => emergency.reviewEmergencyUse(permission, useId || 'u', { ledger, by: host.principal('person'), decision: 'accept', now: AT });
// An options object whose only field throws the marker. Used by the R301 cases.
const hostileOptions = () => Object.defineProperty({}, 'ledger', { get() { throw new Error(MARKER); } });

// Each public option reader is tested separately: these are seven sites of one root cause.
for (const method of ['createEmergencyPermission', 'exerciseEmergency', 'reviewEmergencyUse', 'pauseEmergencyPermission', 'resumeEmergencyPermission', 'revokeEmergencyPermission', 'getEmergencyState']) {
  test(`R301-${method} option getter errors never publish their private exception`, async () => {
    const permission = await granted();
    let error;
    try {
      if (method === 'createEmergencyPermission') {
        await emergency[method](GRANT(), Object.defineProperty({}, 'authorizeGrantor', { get() { throw new Error(MARKER); } }));
      } else if (method === 'exerciseEmergency') {
        emergency[method](permission, REQUEST(), hostileOptions());
      } else if (method === 'reviewEmergencyUse') {
        emergency[method](permission, 'u', hostileOptions());
      } else {
        emergency[method](permission, hostileOptions());
      }
    } catch (err) {
      error = err;
    }
    if (error) assert.equal(String(error.message).includes(MARKER), false, 'private exception escaped the options boundary');
  });
}

test('R302 the subject reference rejects a final newline', async () => {
  const permission = await granted({ scope: ['record\n'] });
  const ledger = emergency.createEmergencyLedger();
  assert.equal(run(permission, ledger, REQUEST({ subject: 'record\n' })).state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
});

test('R303 a sparse signal array cannot fill its hole from a custom prototype and hide an extra key', async () => {
  let calls = 0;
  const permission = await granted({}, () => { calls += 1; return { verified: true }; });
  const ledger = emergency.createEmergencyLedger();
  const samples = new Array(1);
  const proto = Object.create(Array.prototype);
  proto[0] = 'inherited';
  Object.setPrototypeOf(samples, proto);
  samples.extra = 'lost';
  const result = run(permission, ledger, REQUEST({ triggerSignal: { id: 's', source: 'sensor', samples } }));
  assert.equal(result.state, 'blocked');
  assert.equal(calls, 0);
  assert.equal(state(permission, ledger).uses, 0);
});

test('R304 a signal with an enumerable symbol key is refused instead of silently losing data', async () => {
  let calls = 0;
  const permission = await granted({}, () => { calls += 1; return { verified: true }; });
  const ledger = emergency.createEmergencyLedger();
  const signal = { id: 's', source: 'sensor' };
  signal[Symbol('hidden-evidence')] = 'not JSON';
  assert.equal(run(permission, ledger, REQUEST({ triggerSignal: signal })).state, 'blocked');
  assert.equal(calls, 0);
});

// R304 said "an object"; this round closed the array too, because an array is the other shape the
// canonical walk copies and a symbol key on one used to be dropped from it exactly the same way.
test('R304 a signal whose samples array carries a symbol key is refused as well', async () => {
  let calls = 0;
  const permission = await granted({}, () => { calls += 1; return { verified: true }; });
  const ledger = emergency.createEmergencyLedger();
  const samples = [1, 2];
  samples[Symbol('hidden-evidence')] = 'not JSON';
  assert.equal(run(permission, ledger, REQUEST({ triggerSignal: { id: 's', source: 'sensor', samples } })).state, 'blocked');
  assert.equal(calls, 0);
  assert.equal(state(permission, ledger).uses, 0);
});

test('R305 a grant with no representable review deadline anywhere in its own interval is refused before authorization', async () => {
  let approvals = 0;
  const span = Date.parse('9999-12-31T23:59:59.999Z') - Date.parse('0000-01-01T00:00:00.000Z');
  await assert.rejects(
    () => emergency.createEmergencyPermission({ ...GRANT(), reviewDueMs: span }, {
      authenticate: host.authenticate,
      authorizeGrantor: (candidate) => { approvals += 1; return APPROVE(candidate); },
      resolveVerifier: (id) => ({ id, verify: () => ({ verified: true }) }),
      authorizeRenewal: APPROVE,
    }),
    /review|calendar|deadline/i,
  );
  assert.equal(approvals, 0);
});

test('R306 a verdict then getter that pauses the family leaves the cap untouched', async () => {
  let permission;
  const ledger = emergency.createEmergencyLedger();
  permission = await granted({}, () => Object.defineProperty({ verified: true }, 'then', {
    get() { emergency.pauseEmergencyPermission(permission, { ledger, by: host.principal('person'), now: AT }); return undefined; },
  }));
  assert.equal(run(permission, ledger).state, 'blocked');
  assert.equal(state(permission, ledger).uses, 0);
  assert.equal(state(permission, ledger).status, 'paused');
});

test('R307 a nested signal getter can revoke a renewed handle before verification without spending', async () => {
  let calls = 0;
  const permission = await granted({}, () => { calls += 1; return { verified: true }; });
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: '2026-10-06T00:00:00Z' });
  const ledger = emergency.createEmergencyLedger();
  const nested = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() { emergency.revokeEmergencyPermission(renewed, { ledger, by: host.principal('person'), now: AT }); return true; },
  });
  assert.equal(run(permission, ledger, REQUEST({ triggerSignal: { id: 's', source: 'sensor', nested } })).state, 'blocked');
  assert.equal(calls, 0);
  assert.equal(state(permission, ledger).uses, 0);
});

test('R308 a verifier mutating its copies changes neither caller data nor the sealed input fingerprint', async () => {
  const permission = await granted({}, (trigger, signal) => {
    trigger.id = 'other';
    signal.critical = false;
    signal.nested.value = 9;
    return { verified: true };
  });
  const ledger = emergency.createEmergencyLedger();
  const signal = { critical: true, id: 's', nested: { value: 1 }, source: 'sensor' };
  const result = run(permission, ledger, REQUEST({ triggerSignal: signal }));
  assert.equal(result.state, 'review_pending');
  assert.equal(signal.critical, true);
  assert.equal(signal.nested.value, 1);
  const expected = createHash('sha256').update(JSON.stringify(signal)).digest('hex');
  assert.equal(result.receipt.trigger.signalDigest, expected);
  assert.equal(verifyReceipt(result.receipt).ok, true);
});

test('R309 symbols on renewal changes cannot widen scope or replace reviewers', async () => {
  const permission = await granted();
  const changes = { expiresAt: '2026-10-06T00:00:00Z' };
  changes[Symbol('scope')] = ['private'];
  changes[Symbol('reviewers')] = ['agent'];
  const renewed = emergency.renewEmergencyPermission(permission, changes);
  assert.deepEqual([...renewed.scope], ['record']);
  assert.deepEqual([...renewed.reviewers], ['person']);
});

test('R310 the entire grant is snapshotted before an asynchronous authorization yields', async () => {
  const draft = GRANT();
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let seen;
  const pending = emergency.createEmergencyPermission(draft, {
    authenticate: host.authenticate,
    authorizeGrantor: async (candidate) => { seen = candidate; await wait; return APPROVE(candidate); },
    resolveVerifier: (id) => ({ id, verify: () => ({ verified: true }) }),
    authorizeRenewal: APPROVE,
  });
  draft.scope[0] = 'private';
  draft.triggers[0].verifierId = 'agent';
  draft.reviewers[0] = 'agent';
  release();
  const permission = await pending;
  assert.deepEqual([...permission.scope], ['record']);
  assert.equal(permission.triggers[0].verifierId, 'sensor');
  assert.deepEqual([...permission.reviewers], ['person']);
  assert.ok(Object.isFrozen(seen.triggers[0]));
});

test('R311 pending review cannot be closed through a proxy around the real handle', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  run(permission, ledger);
  const proxy = new Proxy(permission, {});
  assert.throws(() => close(proxy, ledger), /bound|grant|authority/);
  assert.equal(state(permission, ledger).pendingReview, 'u');
});

test('R312 original and renewed handles share signal replay protection after a real review', async () => {
  const permission = await granted();
  const ledger = emergency.createEmergencyLedger();
  run(permission, ledger);
  close(permission, ledger);
  const renewed = emergency.renewEmergencyPermission(permission, { expiresAt: '2026-10-06T00:00:00Z' });
  assert.equal(run(renewed, ledger, REQUEST({ useId: 'u2' })).state, 'blocked');
  assert.equal(state(permission, ledger).uses, 1);
});