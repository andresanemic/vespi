'use strict';
// K3h: adversarial hardening of the zk branch, written in the attacker role. Every case below is an
// attempt to make the port or the receipt say something it did not establish. The classes come from
// the independent reviews of the sibling branches (k1 and k2): authority not tied to the presenter,
// a field read twice or read through a hostile descriptor, a getter that throws between the check
// and the use, a foreign realm, reentrancy, an exception that leaks private data or leaves state
// half written, sizes and integers nobody validated, a receipt that announces `verified` without an
// independent verification, `null` treated as evidence, and a digest that does not cover a field.
//
// The first half of the file is the corpus. Cases that already exist in k3b-zk-port or
// k3b-zk-receipt are not repeated here; where a defence is observed instead of broken, the test
// says so in its name and still runs, because "nothing found" is evidence only if it was looked for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const fx = require('./helpers/zk-fixture.js');
const zk = require('../src/zk.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { createOperation, runOperation } = require('../src/operation.js');

const { createZkVerifier, digestZkVerificationKey, reconcileZk, readZkEvidence, claimsZk } = zk;

const CONFIG_ERROR = 'zk verifier configuration is invalid';
const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);
const OTHER_DIGEST = 'a'.repeat(64);
const PRIVATE = 'PRIVATE-KEY-AT-0xdeadbeef';
const CHECK_KEYS = [
  'zk.verification-key-pinned',
  'zk.public-inputs-bound',
  'zk.proof-valid',
  'zk.presenter-authentication',
  'zk.institutional-attestation',
  'zk.replay-prevention',
  'zk.transport-privacy',
];
const COVERED = CHECK_KEYS.slice(0, 3);
const LIMITS = CHECK_KEYS.slice(3);

function config(over = {}) {
  return {
    verificationKey: fx.verificationKey(),
    expectedVkDigest: fx.manifest.digests.vkDigest,
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: () => true,
    backendDigest: BACKEND_DIGEST,
    ...over,
  };
}

const goodRequest = () => ({ proof: fx.proof(), publicInputs: fx.publicInputs() });

function evidence(over = {}) {
  return {
    schema: 'vespi-zk-evidence-v1',
    system: 'groth16',
    curve: 'bn254',
    circuitDigest: CIRCUIT_DIGEST,
    vkDigest: fx.manifest.digests.vkDigest,
    backendDigest: BACKEND_DIGEST,
    proofDigest: fx.manifest.digests.proofDigest,
    publicInputs: ['35'],
    result: 'verified',
    code: 'ok',
    ...over,
  };
}

function checks(over = {}) {
  const out = {};
  for (const key of CHECK_KEYS) out[key] = COVERED.includes(key);
  return { ...out, ...over };
}

function receiptSpec(verification, outcome = {}) {
  return {
    operation: { id: 'zk-hard', goal: 'check a proof', action: 'local-check' },
    capabilityId: 'zk:check',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [], ...outcome },
    evidence: {},
    verification,
    at: '2040-01-01T00:00:00.000Z',
  };
}

// A verification whose `zk` claim is consistent, so the cases that follow measure one thing each.
const successVerification = () => ({ verified: true, checks: checks(), reason: 'forged or real, same shape', zk: evidence() });

function assertNoPrivateMarker(value, why) {
  assert.ok(!JSON.stringify(value).includes(PRIVATE), `${why}: the private marker does not travel`);
}

// ===========================================================================
// A. The strict reader of the configuration and of the request
// ===========================================================================

// A1. Every other field of the configuration is read through a descriptor that refuses accessors.
// `maxPublicInputs` is the one field read with a plain property access, so a getter on it is
// invoked where every other accessor is refused. The design says accessors are rejected.
test('K3H.1 a configuration accessor on maxPublicInputs is refused like every other accessor', () => {
  const candidate = config();
  Object.defineProperty(candidate, 'maxPublicInputs', { get: () => 8, enumerable: true });
  assert.throws(() => createZkVerifier(candidate), (err) => err instanceof TypeError
    && err.message === CONFIG_ERROR, 'a getter on maxPublicInputs is not a number this port reads');
});

// A2. The length ceiling is checked after the whole array has been walked. A caller can make the
// port enumerate a list far longer than anything a proof has before the refusal arrives.
test('K3H.2 an oversized public input list is refused without being enumerated', async () => {
  const huge = new Array(200000).fill('35');
  let enumerations = 0;
  const spy = new Proxy(huge, { ownKeys(target) { enumerations += 1; return Reflect.ownKeys(target); } });
  const verify = createZkVerifier(config({ backend: () => true }));
  const out = await verify({ proof: fx.proof(), publicInputs: spy });
  assert.equal(out.zk.code, 'malformed_input');
  assert.equal(enumerations, 0, 'the ceiling is checked before the array is walked');
});

// A3. `canonical` builds objects with `{}`, so a key named `__proto__` would reach an inherited
// setter and change the prototype of the copy (the class behind R209/R210 in k1). Nothing the
// strict reader accepts can carry such a key, and this is the test that keeps it true.
test('K3H.3 no accepted structure can carry a __proto__ key into the digest', () => {
  const withProto = { ...fx.verificationKey(), ['__proto__']: { polluted: true } };
  assert.throws(() => digestZkVerificationKey(withProto), (err) => err instanceof TypeError
    && err.message === CONFIG_ERROR, 'a vk with an own __proto__ key is not a vk');
  assert.equal({}.polluted, undefined, 'and the prototype of Object.prototype is untouched');
  const arrayWithProto = fx.publicInputs();
  Object.defineProperty(arrayWithProto, '__proto__', { value: { polluted: true }, enumerable: true });
  assert.equal(readZkEvidence({ ...evidence(), publicInputs: arrayWithProto }), null,
    'an array carrying an own __proto__ key is refused as a public input list');
  assert.equal({}.polluted, undefined);
  assert.equal(readZkEvidence({ ...evidence(), ['__proto__']: 'x' }), null,
    'evidence with an own __proto__ key is refused');
  assert.equal({}.polluted, undefined);
  assert.equal({}.x, undefined, 'the key never became an own property of anything');
});

// A4. Another realm: a foreign object prototype is not this realm's Object.prototype, and a
// revoked proxy throws from every trap. Neither may reach the backend or crash the port.
test('K3H.4 objects from another realm and revoked proxies are refused, never crash', async () => {
  const verify = createZkVerifier(config({ backend: () => true }));
  const foreignObject = vm.runInNewContext('({ a: ["1","2"] })');
  const foreignRequest = vm.runInNewContext('({ proof: {a:["1","2"],b:[["1","2"],["3","4"]],c:["1","2"]}, publicInputs:["35"] })');
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const [why, bad] of Object.entries({
    'a foreign realm object': { proof: foreignObject, publicInputs: ['35'] },
    'a foreign realm request': foreignRequest,
    'a revoked proxy as the request': revoked.proxy,
    'a revoked proxy as the proof': { proof: revoked.proxy, publicInputs: ['35'] },
  })) {
    const out = await verify(bad);
    assert.equal(out.verified, false, why);
    assert.equal(out.zk.code, 'malformed_input', why);
  }
});

// A5. A proxy array whose descriptors and whose `get` disagree cannot smuggle an unvalidated value
// past the reader: whatever `get` finally returns is the value that gets range checked.
test('K3H.5 a proxy that lies in its descriptors still cannot pass an unchecked value', async () => {
  let reads = 0;
  const liar = new Proxy(['35'], {
    getOwnPropertyDescriptor: (target, key) => (key === '0'
      ? { value: '35', writable: true, enumerable: true, configurable: true }
      : Reflect.getOwnPropertyDescriptor(target, key)),
    get(target, key) {
      if (key === '0') { reads += 1; return 'not a scalar'; }
      return Reflect.get(target, key);
    },
  });
  const verify = createZkVerifier(config({ backend: () => true }));
  const out = await verify({ proof: fx.proof(), publicInputs: liar });
  assert.equal(out.zk.code, 'malformed_input', 'the value the port actually read is the one it judged');
  assert.ok(reads >= 1);
});

// A6. The verification key the backend sees is frozen at every level, not only at the top: `ic` is
// the array a hostile backend would rewrite to move the accumulator.
test('K3H.6 every level of the backend snapshot is frozen, including the key ic array', async () => {
  let seen = null;
  const verify = createZkVerifier(config({ backend: (input) => { seen = input; return true; } }));
  await verify(goodRequest());
  assert.ok(seen, 'the backend was called');
  for (const [why, path] of [
    ['verificationKey', seen.verificationKey],
    ['verificationKey.ic', seen.verificationKey.ic],
    ['verificationKey.ic[0]', seen.verificationKey.ic[0]],
    ['verificationKey.ic[0][0]', seen.verificationKey.ic[0][0]],
    ['verificationKey.beta[0][1]', seen.verificationKey.beta[0][1]],
    ['proof.b[1][0][1]', seen.proof.b[1][0][1]],
  ]) {
    assert.ok(Object.isFrozen(path), `${why} is frozen`);
  }
  assert.throws(() => { seen.verificationKey.ic[0][0] = '1'; }, TypeError);
  assert.throws(() => { seen.proof.b[1][0][1] = '1'; }, TypeError);
  assert.notEqual(seen.verificationKey.ic[0][0], '1');
});

// A7. Reentrancy: a backend that calls the verifier again with a different request has no state to
// cross, and the inner answer cannot upgrade the outer one.
test('K3H.7 a reentrant backend cannot cross two verifications', async () => {
  let inner = null;
  let verify = null;
  verify = createZkVerifier(config({
    backend: async (input) => {
      if (inner === null) {
        inner = await verify({ proof: fx.proof(), publicInputs: ['22'] });
        return true;
      }
      return false;
    },
  }));
  const outer = await verify(goodRequest());
  assert.equal(outer.verified, true);
  assert.equal(outer.zk.result, 'verified');
  assert.equal(inner.verified, false, 'the inner verification failed on its own inputs');
  assert.equal(inner.zk.code, 'public_inputs_mismatch');
  assert.deepEqual(outer.zk.publicInputs, ['35'], 'the outer answer carries its own inputs');
  assert.equal(outer.zk.proofDigest, fx.manifest.digests.proofDigest);
});

// A8. Replay is not prevented by design: the same proof and the same inputs verify twice. The port
// declares `zk.replay-prevention` false forever, so this is the honest shape of the limit.
test('K3H.8 the same proof verifies again: the port consumes no nonce and says so', async () => {
  const verify = createZkVerifier(config({ backend: () => true }));
  const first = await verify(goodRequest());
  const second = await verify(goodRequest());
  assert.equal(first.verified, true);
  assert.equal(second.verified, true);
  assert.equal(second.checks['zk.replay-prevention'], false);
  assert.deepEqual(first.zk.proofDigest, second.zk.proofDigest);
});

// ===========================================================================
// B. The backend contract at the boundary
// ===========================================================================

// B1. A backend that never settles cannot be interrupted by this port. The kernel's operation layer
// has a timeout and does convert it; the port alone does not, and it must not pretend to.
test('K3H.9 a backend that never settles is contained by runOperation, not by the port', async () => {
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: goodRequest() }),
  };
  const { receipt } = await runOperation(op, cap, {
    ask: async () => ({ approved: true }),
    verify: () => new Promise(() => {}),
    verifyTimeoutMs: 20,
  });
  assert.notEqual(receipt.status, 'verified');
  assert.equal(receipt.verification.verified, false);
});

// B2. A backend that answers with an object that lies about being a boolean is an error, and the
// answer object it returns never reaches the receipt.
test('K3H.10 a backend cannot return a verdict by returning an object with a valueOf', async () => {
  const verify = createZkVerifier(config({
    backend: () => ({ valueOf: () => true, toString: () => 'true', [Symbol.toPrimitive]: () => true }),
  }));
  const out = await verify(goodRequest());
  assert.equal(out.verified, false);
  assert.equal(out.zk.result, 'error');
  assert.equal(out.zk.code, 'backend_error');
});

// ===========================================================================
// C. The claim: readZkEvidence, reconcileZk and the exported vocabulary
// ===========================================================================

// C1. `reconcileZk` contains everything it reads from the zk object, but the `checks` object is a
// parameter of a public export and its fields are read with a plain property access. A throwing
// getter or proxy there escapes the function and takes the private message with it.
test('K3H.11 reconcileZk never throws on a hostile checks object', () => {
  // Read through descriptors, so a container that only misbehaves on `get` is never consulted at
  // all: the descriptor values decide, and the private message in the `get` trap cannot travel.
  const liar = new Proxy(checks(), { get() { throw new Error(PRIVATE); } });
  const fromDescriptors = reconcileZk({ verified: true, checks: liar, claimed: true, zk: evidence() });
  assert.equal(fromDescriptors.consistent, true, 'the descriptors decide, not a lying get');
  assertNoPrivateMarker(fromDescriptors, 'a lying get trap');

  for (const [why, hostile] of Object.entries({
    'a throwing getter': (() => {
      const c = checks();
      Object.defineProperty(c, 'zk.proof-valid', { get() { throw new Error(PRIVATE); }, enumerable: true });
      return c;
    })(),
    'a revoked proxy': (() => { const r = Proxy.revocable(checks(), {}); r.revoke(); return r.proxy; })(),
    'a proxy with a throwing descriptor': new Proxy(checks(), {
      getOwnPropertyDescriptor() { throw new Error(PRIVATE); },
    }),
    'a proxy that hides a covered check': new Proxy(checks(), {
      getOwnPropertyDescriptor: (target, key) => (key === 'zk.proof-valid'
        ? undefined
        : Reflect.getOwnPropertyDescriptor(target, key)),
    }),
    'a null checks': null,
    'an array as checks': [],
    'a string as checks': 'zk.proof-valid',
  })) {
    let out = null;
    assert.doesNotThrow(() => {
      out = reconcileZk({ verified: true, checks: hostile, claimed: true, zk: evidence() });
    }, `${why} does not escape`);
    assert.equal(out.consistent, false, why);
    assert.equal(out.verified, false, why);
    assert.equal(out.zk, null, why);
    assertNoPrivateMarker(out, why);
  }
});

// C2. Check values are read with `checks[key]`, so a value inherited from a prototype counts as a
// check that ran. The kernel's own call sites always build a plain object, but the port's rule is
// that a check counts only when the object itself carries it.
test('K3H.12 an inherited check value does not count as a check that ran', () => {
  const inherited = Object.create(checks());
  const out = reconcileZk({ verified: true, checks: inherited, claimed: true, zk: evidence() });
  assert.equal(out.consistent, false, 'coverage is only ever read off own properties');
  assert.equal(out.verified, false);
  const ownOnly = { ...checks() };
  const good = reconcileZk({ verified: true, checks: ownOnly, claimed: true, zk: evidence() });
  assert.equal(good.consistent, true, 'and the own-property case still works');
});

// C3. `ZK_CHECK_KEYS`, `COVERED_CHECKS` and `LIMIT_CHECKS` are exported by reference. Anything in the
// process that can require the module can therefore widen what `checksWith` credits and empty what
// `reconcileZk` refuses, and mint a receipt whose coverage claims a limit the proof never grants.
test('K3H.13 the exported check vocabulary cannot be edited into a forged coverage', () => {
  const savedKeys = [...zk.ZK_CHECK_KEYS];
  const savedCovered = [...zk.COVERED_CHECKS];
  const savedLimits = [...zk.LIMIT_CHECKS];
  const forgedChecks = checks({ 'zk.presenter-authentication': true });
  let out = null;
  let receipt = null;
  try {
    try { zk.LIMIT_CHECKS.length = 0; } catch { /* a frozen array is the fixed state */ }
    try { zk.COVERED_CHECKS.add('zk.presenter-authentication'); } catch { /* ditto */ }
    try { zk.ZK_CHECK_KEYS.push('zk.presenter-authentication'); } catch { /* ditto */ }
    out = reconcileZk({ verified: true, checks: forgedChecks, claimed: true, zk: evidence() });
    receipt = buildReceipt(receiptSpec({ verified: true, checks: forgedChecks, reason: 'forged', zk: evidence() }));
  } finally {
    // Put the module back the way it was found, so a failure here cannot explain another one.
    try { zk.ZK_CHECK_KEYS.length = 0; zk.ZK_CHECK_KEYS.push(...savedKeys); } catch { /* already fixed */ }
    try { zk.COVERED_CHECKS.clear(); for (const key of savedCovered) zk.COVERED_CHECKS.add(key); } catch { /* already fixed */ }
    try { zk.LIMIT_CHECKS.length = 0; zk.LIMIT_CHECKS.push(...savedLimits); } catch { /* already fixed */ }
  }
  assert.equal(out.consistent, false, 'a claim that counts a limit as covered is still refused');
  assert.equal(out.verified, false);
  assert.equal(receipt.status, 'not_verified');
  assert.ok(!receipt.coverage.includes('zk.presenter-authentication'),
    'no receipt claims a limit as coverage');
  assert.deepEqual(zk.ZK_CHECK_KEYS, CHECK_KEYS, 'the exported vocabulary still has the seven keys');
  assert.deepEqual([...zk.COVERED_CHECKS], COVERED);
  assert.deepEqual(zk.LIMIT_CHECKS, LIMITS);
});

// C4. `claimsZk` is careful to read the descriptor without invoking a getter, and then both call
// sites dereference `verification.zk` to hand it over. The getter therefore runs anyway, and a
// throwing one escapes `buildReceipt` with its private message as the error text.
test('K3H.14 a throwing accessor on verification.zk cannot escape buildReceipt', () => {
  assert.equal(claimsZk({ get zk() { throw new Error(PRIVATE); } }), true,
    'the claim is still noticed, without invoking the getter');
  let receipt = null;
  assert.doesNotThrow(() => {
    receipt = buildReceipt(receiptSpec({
      verified: true,
      checks: checks(),
      reason: 'claimed',
      get zk() { throw new Error(PRIVATE); },
    }));
  }, 'a getter on the zk claim is data this port refuses, not an exception it publishes');
  assert.equal(receipt.verification.verified, false);
  assert.equal(receipt.status, 'not_verified');
  assert.ok(!('zk' in receipt.verification), 'the unreadable claim is removed');
  assertNoPrivateMarker(receipt, 'buildReceipt');
  assert.equal(verifyReceipt(receipt).ok, true, 'and the receipt it did write is intact');
});

// C5. The same claim arriving through the operation layer, where the exception is caught by the
// generic verifier handler: the private message becomes the receipt's reason and travels from there.
test('K3H.15 a throwing accessor on the verifier zk answer does not become the receipt reason', async () => {
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: goodRequest() }),
  };
  const { receipt } = await runOperation(op, cap, {
    ask: async () => ({ approved: true }),
    verify: () => ({ verified: true, checks: checks(), reason: 'claimed', get zk() { throw new Error(PRIVATE); } }),
  });
  assert.equal(receipt.status, 'not_verified');
  assert.equal(receipt.verification.verified, false);
  assertNoPrivateMarker(receipt, 'runOperation');
  assert.ok(!receipt.verification.reason.startsWith('verifier error: '),
    `the reason is a fixed string, got ${JSON.stringify(receipt.verification.reason)}`);
});

// C6. `proofDigest` is the only thing in the evidence that names the proof the verdict is about, and
// the design says it is null for a malformed request and present for every other outcome. A
// `verified` claim with a null proof digest names no proof at all.
test('K3H.16 a verdict that names no proof cannot ride in a verified receipt', () => {
  for (const [why, zkClaim] of Object.entries({
    'verified with a null proof digest': { ...evidence(), proofDigest: null },
    'invalid_proof with a null proof digest': { ...evidence(), result: 'invalid', code: 'invalid_proof', proofDigest: null },
    'backend_error with a null proof digest': { ...evidence(), result: 'error', code: 'backend_error', proofDigest: null },
  })) {
    const verdict = zkClaim.result === 'verified';
    const receipt = buildReceipt(receiptSpec({
      verified: verdict,
      checks: checks({ 'zk.proof-valid': verdict }),
      reason: 'claimed',
      zk: zkClaim,
    }, { status: verdict ? 'verified' : 'not_verified' }));
    assert.equal(receipt.verification.verified, false, why);
    assert.ok(!('zk' in receipt.verification), `${why}: the claim is removed, not repaired`);
    assert.equal(receipt.status, 'not_verified', why);
  }
  // The one shape that does carry a null proof digest stays valid: the design fixes it for a
  // malformed request, where there is no proof to name.
  const malformed = buildReceipt(receiptSpec({
    verified: false, checks: checks(), reason: 'claimed',
    zk: { ...evidence(), result: 'invalid', code: 'malformed_input', proofDigest: null },
  }, { status: 'not_verified' }));
  assert.equal(malformed.verification.verified, false);
  assert.equal(malformed.verification.zk.code, 'malformed_input');
  assert.equal(malformed.verification.zk.proofDigest, null);
});

// C7. `readZkEvidence` is public and returns a fresh copy, so nothing the caller passed in can be
// held and moved afterwards. Two calls on the same object return equal but independent copies.
test('K3H.17 readZkEvidence returns an independent copy and claimsZk reads no getter', () => {
  const source = evidence();
  const first = readZkEvidence(source);
  const second = readZkEvidence(source);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.publicInputs, second.publicInputs);
  assert.notEqual(first.publicInputs, source.publicInputs);
  first.publicInputs.push('36');
  first.result = 'invalid';
  assert.deepEqual(source.publicInputs, ['35']);
  assert.equal(source.result, 'verified');
  assert.equal(claimsZk({ zk: null }), false, 'an explicit null is not a claim');
  assert.equal(claimsZk({}), false);
  assert.equal(claimsZk(Object.create({ zk: evidence() })), false, 'an inherited zk is not a claim');
});

// C8. A key with `nPublic: 0` binds the proof to nothing: every request with an empty input list
// reaches the backend and a `true` from it produces `verified`. The design allows nPublic 0, so
// refusing it is the owner's call, not a silent tightening.
test("K3H.18 a verification key with no public inputs is refused, or the port says it binds nothing", {
  todo: "decisión del dueño: el diseño admite nPublic 0..maxPublicInputs y una clave sin entradas públicas verifica cualquier prueba; rechazarla cambia un contrato público",
}, async () => {
  const unbound = fx.verificationKey();
  unbound.nPublic = 0;
  unbound.ic = [unbound.ic[0]];
  const digest = digestZkVerificationKey(unbound);
  const verify = createZkVerifier({
    verificationKey: unbound,
    expectedVkDigest: digest,
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: [],
    backend: () => true,
    backendDigest: BACKEND_DIGEST,
  });
  const out = await verify({ proof: fx.proof(), publicInputs: [] });
  assert.notEqual(out.verified, true, 'a key with no public input binds no context');
  assert.equal(out.checks['zk.public-inputs-bound'], false);
});

// ===========================================================================
// D. The executor and the host contract
// ===========================================================================

// D1. `perform` returns the evidence and `io.verify` receives it. A host whose verifier hands the
// evidence straight back turns the executor's own `verified: true` into the verdict, and a `zk`
// inside the evidence becomes a zk claim. The kernel cannot tell an echo from a real answer, and
// refusing the echo would change what a host may write, so this is stated, not decided here.
test('K3H.19 a verifier that echoes the evidence does not let the executor hand itself a zk result', {
  todo: "decisión del dueño: si el verificador devuelve el mismo objeto que recibió, el recibo puede heredar verified y un zk de la evidencia; rechazarlo define una frontera nueva entre host y executor",
}, async () => {
  const forged = evidence();
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: { verified: true, checks: checks(), zk: forged } }),
  };
  const { receipt } = await runOperation(op, cap, { ask: async () => ({ approved: true }), verify: (e) => e });
  assert.notEqual(receipt.status, 'verified', 'the executor does not verify itself');
  assert.ok(!receipt.coverage.includes('zk.proof-valid'));
});

// D2. The zk evidence a receipt carries is self certification by the host's verifier: nothing in the
// receipt says the pairing ran here. `verifyReceipt` checks integrity, not the verdict.
test('K3H.20 a hand written zk claim passes integrity: integrity is not authenticity', () => {
  const receipt = buildReceipt(receiptSpec(successVerification()));
  assert.equal(verifyReceipt(receipt).ok, true);
  assert.equal(receipt.verification.verified, true);
  const rewritten = JSON.parse(JSON.stringify(receipt));
  rewritten.verification.zk.backendDigest = OTHER_DIGEST;
  rewritten.verification.zk.proofDigest = OTHER_DIGEST;
  rewritten.verification.reason = 'nothing ever ran';
  const rebuilt = buildReceipt(receiptSpec({
    verified: true, checks: checks(), reason: 'nothing ever ran',
    zk: { ...evidence(), backendDigest: OTHER_DIGEST, proofDigest: OTHER_DIGEST },
  }));
  assert.equal(verifyReceipt(rebuilt).ok, true, 'anyone who can rewrite the file can recompute the digest');
  assert.notEqual(rebuilt.digest, receipt.digest);
  assert.equal(verifyReceipt(rewritten).ok, false, 'editing without recomputing is still detected');
});

// D3. `circuitDigest` describes an artifact and does not bind the key to the circuit: two
// configurations that differ only in it verify the same proof. Recorded as a limit, not a defect.
test('K3H.21 circuitDigest does not bind the key to the circuit and never claims to', async () => {
  const a = createZkVerifier(config({ circuitDigest: '1'.repeat(64) }));
  const b = createZkVerifier(config({ circuitDigest: '2'.repeat(64) }));
  const outA = await a(goodRequest());
  const outB = await b(goodRequest());
  assert.equal(outA.verified, true);
  assert.equal(outB.verified, true);
  assert.notEqual(outA.zk.circuitDigest, outB.zk.circuitDigest);
  assert.equal(outA.zk.vkDigest, outB.zk.vkDigest);
  const receipt = buildReceipt(receiptSpec(successVerification()));
  assert.ok(!('circuit' in receipt), 'the receipt names the digest, never a certified circuit');
});

// D4. The evidence travels through the receipt untouched by the sanitizer, so a verifier answer with
// a frozen zk still yields a receipt, and one with a mutable zk cannot move the receipt afterwards.
test('K3H.22 the zk a receipt carries is the verifier own copy and not a handle on it', () => {
  const claim = evidence();
  const receipt = buildReceipt(receiptSpec({ verified: true, checks: checks(), reason: 'x', zk: claim }));
  claim.vkDigest = OTHER_DIGEST;
  claim.publicInputs.push('36');
  assert.equal(receipt.verification.zk.vkDigest, fx.manifest.digests.vkDigest);
  assert.deepEqual(receipt.verification.zk.publicInputs, ['35']);
  const frozenClaim = evidence();
  Object.freeze(frozenClaim);
  Object.freeze(frozenClaim.publicInputs);
  const fromFrozen = buildReceipt(receiptSpec({ verified: true, checks: checks(), reason: 'x', zk: frozenClaim }));
  assert.equal(fromFrozen.verification.verified, true, 'a frozen claim is still readable evidence');
  assert.equal(verifyReceipt(fromFrozen).ok, true);
});