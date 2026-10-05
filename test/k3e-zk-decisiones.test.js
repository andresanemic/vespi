'use strict';
// K3e: the three default decisions the owner delegated on the ZK port, written as real tests.
//
// Each one replaces a `todo` test in zk-hardening that said "this is the owner's call":
//   1. coverage comes only from the frozen catalog the module defines; a control with another name
//      is not coverage, fails the verification closed with a public fixed reason, and is not copied
//      into the receipt;
//   2. a verification key with `nPublic: 0` is refused while the port is built;
//   3. a verifier that returns the object it was given fails closed: the answer has to be the
//      verifier's own object.
//
// Every case below is an attempt to abuse the mechanism, not the happy path: an attacker editing the
// exported catalog, a host smuggling a check name of its own into a zk claim, an executor handing
// itself a verdict, and a key that binds the proof to nothing.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fx = require('./helpers/zk-fixture.js');
const zk = require('../src/zk.js');
const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { createOperation, runOperation } = require('../src/operation.js');

const { createZkVerifier, digestZkVerificationKey } = zk;

const CONFIG_ERROR = 'zk verifier configuration is invalid';
const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);
const OTHER_DIGEST = 'a'.repeat(64);
const PRIVATE = 'PRIVATE-KEY-AT-0xdeadbeef';
const COVERED = [
  'zk.verification-key-pinned',
  'zk.public-inputs-bound',
  'zk.proof-valid',
];
const LIMITS = [
  'zk.presenter-authentication',
  'zk.institutional-attestation',
  'zk.replay-prevention',
  'zk.transport-privacy',
];

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
  for (const key of [...COVERED, ...LIMITS]) out[key] = COVERED.includes(key);
  return { ...out, ...over };
}

function receiptSpec(verification, outcome = {}) {
  return {
    operation: { id: 'zk-decisions', goal: 'check a proof', action: 'local-check' },
    capabilityId: 'zk:check',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [], ...outcome },
    evidence: {},
    verification,
    at: '2040-01-01T00:00:00.000Z',
  };
}

function assertNoPrivateMarker(value, why) {
  assert.ok(!JSON.stringify(value).includes(PRIVATE), `${why}: the private marker does not travel`);
}

// A key that binds the proof to nothing: no public input, and an `ic` that agrees with it, so the
// structural reader has nothing to complain about. Only the decision can refuse it.
function unboundKey() {
  const key = fx.verificationKey();
  key.nPublic = 0;
  key.ic = [key.ic[0]];
  return key;
}

// One operation with a `zk:check` capability, so every case below measures the same boundary.
function zkOperation(evidenceValue, verify) {
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  return runOperation(op, checkCapability(evidenceValue), { ask: async () => ({ approved: true }), verify });
}

const checkCapability = (evidenceValue) => ({
  id: 'zk:check',
  required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
  perform: async () => ({ ok: true, evidence: evidenceValue }),
});

// ===========================================================================
// 1. Coverage comes only from the frozen catalog
// ===========================================================================

// D1. The `todo` this decision replaces (K3H.13b). A claim that was refused cannot leave its check
// names in coverage, and the four limits are never coverage whatever anybody reports.
test('K3E.1 a refused zk claim leaves no control of its own in coverage', () => {
  const forgedChecks = checks({ 'zk.presenter-authentication': true });
  const receipt = buildReceipt(receiptSpec({ verified: true, checks: forgedChecks, reason: 'forged', zk: evidence() }));
  assert.equal(receipt.status, 'not_verified');
  assert.equal(receipt.verification.verified, false);
  assert.ok(!receipt.coverage.includes('zk.presenter-authentication'),
    'no receipt lists a limit the claim that produced it did not support');
  assert.deepEqual(receipt.coverage, [], 'and a refused claim supports nothing at all');
  assert.ok(!('zk' in receipt.verification), 'the claim is removed, not repaired');
});

// D2. The same rule on the honest path: a claim that survived credits the covered three and nothing
// else, and the limits are declared as not covered.
test('K3E.2 a surviving claim credits the covered names of the catalog and no other', () => {
  const receipt = buildReceipt(receiptSpec({ verified: true, checks: checks(), reason: 'x', zk: evidence() }));
  assert.deepEqual([...receipt.coverage].sort(), [...COVERED].sort());
  for (const limit of LIMITS) assert.ok(receipt.notCovered.includes(limit), `${limit} is declared`);
  assert.equal(verifyReceipt(receipt).ok, true);
  const invalid = buildReceipt(receiptSpec({
    verified: false, checks: checks({ 'zk.proof-valid': false }), reason: 'x',
    zk: { ...evidence(), result: 'invalid', code: 'invalid_proof' },
  }, { status: 'not_verified' }));
  assert.deepEqual([...invalid.coverage].sort(), ['zk.public-inputs-bound', 'zk.verification-key-pinned'],
    'a claim that says the proof failed does not credit the proof check');
});

// D3. Adversarial: a host smuggles a name of its own into a zk claim. It is not coverage, it fails the
// verification closed with the public fixed reason, and the name does not reach the receipt at all.
test('K3E.3 a check name outside the catalog is not coverage and is not copied to the receipt', () => {
  for (const [why, smuggled] of Object.entries({
    'a host name inside a claim': 'signature',
    'a reserved name the catalog does not enumerate': 'zk.owner-approval',
    'an empty name': '',
  })) {
    const hostile = checks({ [smuggled]: true });
    const receipt = buildReceipt(receiptSpec({ verified: true, checks: hostile, reason: 'forged', zk: evidence() }));
    assert.equal(receipt.verification.verified, false, `${why}: fails closed`);
    assert.equal(receipt.status, 'not_verified', why);
    assert.equal(receipt.verification.reason, zk.ZK_FOREIGN_CHECK_REASON, `${why}: a public fixed reason`);
    assert.ok(!(smuggled in receipt.verification.checks), `${why}: the name is not copied`);
    assert.ok(!receipt.coverage.includes(smuggled), `${why}: and it is not coverage`);
    assert.ok(!receipt.notCovered.includes(smuggled), `${why}: not even as a declared limit`);
    assertNoPrivateMarker(receipt, why);
    assert.equal(verifyReceipt(receipt).ok, true, `${why}: the receipt it did write is intact`);
  }
});

// D4. Adversarial: the reserved `zk.` namespace is closed even without a claim. A name that looks
// like a zk control but is not in the catalog cannot become coverage by skipping the claim.
test('K3E.4 a reserved zk name outside the catalog is refused with or without a claim', () => {
  for (const withClaim of [true, false]) {
    const verification = {
      verified: true,
      checks: { local: true, 'zk.something-new': true },
      reason: 'hostile',
      ...(withClaim ? { zk: evidence() } : {}),
    };
    const receipt = buildReceipt(receiptSpec(verification));
    assert.equal(receipt.verification.verified, false, `claim ${withClaim}: fails closed`);
    assert.equal(receipt.verification.reason, zk.ZK_FOREIGN_CHECK_REASON, `claim ${withClaim}`);
    assert.ok(!('zk.something-new' in receipt.verification.checks), `claim ${withClaim}: not copied`);
    assert.ok(!receipt.coverage.includes('zk.something-new'), `claim ${withClaim}: not coverage`);
    // A host name travels untouched when no claim was made, and is dropped when one was: a zk claim
    // reports the closed catalog and nothing else.
    assert.equal(receipt.coverage.includes('local'), !withClaim, `claim ${withClaim}: the host name`);
  }
});

// D5. Adversarial: the catalog is frozen, so editing the exported array or set cannot widen what a
// receipt credits. This is the same class as K3H.13, now on the coverage side.
test('K3E.5 an edited catalog cannot widen coverage', () => {
  const saved = [...zk.ZK_CHECK_KEYS];
  let receipt = null;
  try {
    try { zk.ZK_CHECK_KEYS.push('zk.attacker-control'); } catch { /* a frozen array is the fixed state */ }
    try { zk.COVERED_CHECKS.add('zk.presenter-authentication'); } catch { /* ditto */ }
    receipt = buildReceipt(receiptSpec({
      verified: true, reason: 'forged', zk: evidence(),
      checks: checks({ 'zk.attacker-control': true, 'zk.presenter-authentication': true }),
    }));
  } finally {
    try { zk.ZK_CHECK_KEYS.length = 0; zk.ZK_CHECK_KEYS.push(...saved); } catch { /* already fixed */ }
  }
  assert.equal(receipt.verification.verified, false);
  assert.deepEqual(receipt.coverage, [], 'nothing from the edited catalog is coverage');
  assert.ok(!('zk.attacker-control' in receipt.verification.checks), 'and the invented name is not copied');
});

// D6. Compatibility: a receipt built without any zk keeps the coverage it had, digest included.
test('K3E.6 without a zk claim the coverage and the digest are exactly what they were', () => {
  const receipt = buildReceipt(receiptSpec({ verified: true, checks: { local: true }, reason: 'test' }));
  assert.deepEqual(receipt.coverage, ['local']);
  assert.deepEqual(receipt.notCovered, ['external anchor']);
  const legacy = buildReceipt({
    operation: { id: 'zk-legacy', goal: 'legacy compatibility', action: 'local-check' },
    capabilityId: 'test-cap',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'test' },
    at: '2040-01-01T00:00:00.000Z',
  });
  assert.equal(legacy.digest, 'a01bca12b310d97e3d3657e7f234e8eaf7615a070c2ac48ebb97e6968ad9ca69',
    'the legacy digest from the design is unchanged');
  // A host name that happens to be true keeps being coverage, whatever its shape.
  for (const name of ['signature', 'effect_present', 'mock']) {
    const other = buildReceipt(receiptSpec({ verified: true, checks: { [name]: true }, reason: 'test' }));
    assert.deepEqual(other.coverage, [name], `${name} is not part of the zk catalog and keeps working`);
  }
});

// ===========================================================================
// 2. A key with no public inputs is refused while the port is built
// ===========================================================================

// D7. The `todo` this decision replaces (K3H.18). A key that binds nothing cannot become a verifier,
// not even with the pin computed honestly over that very key.
test('K3E.8 a verification key with no public inputs never becomes a verifier', () => {
  const key = unboundKey();
  const digest = digestZkVerificationKey(key);
  assert.match(digest, /^[0-9a-f]{64}$/, 'the digest of such a key still exists: it is only an identity');
  assert.throws(() => createZkVerifier(config({
    verificationKey: key,
    expectedVkDigest: digest,
    expectedPublicInputs: [],
  })), (err) => err instanceof TypeError && err.message === CONFIG_ERROR,
  'the port is refused at build time, with the public configuration message');
});

// D8. The refusal happens before anything is asked: no verifier exists, so no request can be made.
test('K3E.9 the unbound key is refused before any backend or request exists', async () => {
  let asked = 0;
  const key = unboundKey();
  const build = () => createZkVerifier(config({
    verificationKey: key,
    expectedVkDigest: digestZkVerificationKey(key),
    expectedPublicInputs: [],
    backend: () => { asked += 1; return true; },
  }));
  assert.throws(build, (err) => err instanceof TypeError && err.message === CONFIG_ERROR);
  assert.equal(asked, 0, 'nothing was asked of a backend');
  // What the refusal did not change, said out loud: a request that does not carry as many public
  // inputs as the key declares is still answered as a malformed request, not as an exception. The
  // decision was about the key, and a caller that never built a verifier with one cannot ask.
  let askedMore = 0;
  const bound = createZkVerifier(config({ backend: () => { askedMore += 1; return true; } }));
  const answer = await bound({ proof: fx.proof(), publicInputs: [] });
  assert.equal(answer.zk.code, 'malformed_input');
  assert.equal(answer.verified, false);
  assert.equal(answer.checks['zk.proof-valid'], false);
  assert.equal(askedMore, 0, 'and the backend was never asked');
});

// D9. A key with at least one public input is untouched by the decision.
test('K3E.10 a key that binds at least one public input still verifies', async () => {
  const verify = createZkVerifier(config({ backend: () => true }));
  const out = await verify(goodRequest());
  assert.equal(out.verified, true);
  assert.equal(out.checks['zk.public-inputs-bound'], true);
  assert.equal(out.zk.code, 'ok');
  // The widest key the ceiling allows is still buildable, so the decision is about nPublic 0 alone.
  const wide = fx.verificationKey();
  const wideInputs = ['1', '1', '1', '1'];
  while (wide.ic.length < wideInputs.length + 1) wide.ic.push(fx.verificationKey().ic[1]);
  wide.nPublic = wideInputs.length;
  assert.equal(wide.nPublic, 4, 'four public inputs in this case');
  const wideVerify = createZkVerifier(config({
    verificationKey: wide,
    expectedVkDigest: digestZkVerificationKey(wide),
    expectedPublicInputs: wideInputs,
    backend: () => true,
  }));
  const wideOut = await wideVerify({ proof: fx.proof(), publicInputs: wideInputs });
  assert.equal(wideOut.verified, true, 'nPublic 4 is still a bound key');
});

// ===========================================================================
// 3. The answer has to be the verifier's own object
// ===========================================================================

// D10. The `todo` this decision replaces (K3H.19). A verifier that hands back the very object it was
// given is refused. The test is identity, not content: a verifier that returns a copy of the same
// fields is a legitimate answer and this kernel cannot tell the two apart, so nothing here says the
// executor cannot answer itself, only that its own object is not its answer.
test('K3E.11 a verifier that returns the evidence it was given fails closed', async () => {
  const forged = evidence();
  const { receipt } = await zkOperation({ verified: true, checks: checks(), zk: forged }, (given) => given);
  assert.notEqual(receipt.status, 'verified', 'the object it was handed is not its own answer');
  assert.equal(receipt.status, 'not_verified');
  assert.equal(receipt.verification.verified, false);
  assert.ok(!receipt.coverage.includes('zk.proof-valid'));
  assert.deepEqual(receipt.coverage, [], 'and no control of the echoed object is coverage');
  assert.ok(!('zk' in receipt.verification), 'the zk the executor carried never reaches the receipt');
  assert.equal(receipt.verification.reason, zk.ZK_ECHO_REASON, 'with the public fixed reason');
  assert.equal(receipt.operation.goal, 'check a proof');
});

// D11. Adversarial: editing the evidence before handing it back is still the same object, so the
// refusal does not depend on what the echo says.
test('K3E.12 an evidence object edited by the verifier and handed back is still refused', async () => {
  const tampered = await runOperation(createOperation({ goal: 'check a proof', authority: { spend: [] } }),
    checkCapability({ verified: true, checks: checks() }),
    {
      ask: async () => ({ approved: true }),
      verify: (given) => {
        given.verified = true;
        given.checks = { ...given.checks, 'zk.attacker-control': true };
        return given;
      },
    });
  assert.equal(tampered.receipt.status, 'not_verified', 'the echo is refused whatever it says after editing');
  assert.equal(tampered.receipt.verification.reason, zk.ZK_ECHO_REASON);
  assert.ok(!('zk.attacker-control' in tampered.receipt.verification.checks), 'and the name is not copied');
  assert.deepEqual(tampered.receipt.coverage, [], 'nothing of the echoed object is coverage');
  // An honest verifier over the same capability is untouched by the decision.
  const port = createZkVerifier(config({ backend: () => true }));
  const honest = await zkOperation(goodRequest(), (given) => port({ ...given }));
  assert.equal(honest.receipt.status, 'verified', 'an honest verifier still ends verified');
  assert.deepEqual([...honest.receipt.coverage].sort(), [...COVERED].sort());
  assert.equal(honest.receipt.verification.zk.result, 'verified');
});

// D12. Adversarial: only identity is a refusal. An answer the verifier built itself, even from the
// same fields, is a real answer. This is the limit of the decision and it is measured here.
test('K3E.13 an answer the verifier built itself is not an echo', async () => {
  const port = createZkVerifier(config({ backend: () => true }));
  const { receipt } = await zkOperation(goodRequest());
  assert.equal(receipt.status, 'not_verified', 'no verifier at all is still not verified');
  const honest = await runOperation(createOperation({ goal: 'check a proof', authority: { spend: [] } }),
    checkCapability(goodRequest()),
    { ask: async () => ({ approved: true }), verify: (given) => port({ ...given }) });
  assert.equal(honest.receipt.status, 'verified', 'a fresh object from the port is a real answer');
  assert.ok(honest.receipt.coverage.includes('zk.proof-valid'));
  assert.equal(honest.receipt.verification.zk.result, 'verified');
  const echoed = await runOperation(createOperation({ goal: 'check a proof', authority: { spend: [] } }),
    checkCapability({ ...goodRequest(), ...evidence() }),
    { ask: async () => ({ approved: true }), verify: (given) => given });
  assert.equal(echoed.receipt.status, 'not_verified', 'the port answer built from the same fields is refused as an echo');
});

// D14. A verifier that throws, times out or answers nothing keeps its own fixed shapes: this decision
// adds one more refusal and does not move those.
test('K3E.14 the echo refusal does not disturb the other verifier failures', async () => {
  const cases = {
    'a thrown error': () => { throw new Error(PRIVATE); },
    'a timeout': () => new Promise(() => {}),
    'a non boolean': () => 'true',
  };
  for (const [why, verify] of Object.entries(cases)) {
    const io = { ask: async () => ({ approved: true }), verify };
    if (why === 'a timeout') io.verifyTimeoutMs = 10;
    const { receipt } = await runOperation(
      createOperation({ goal: 'check a proof', authority: { spend: [] } }),
      checkCapability(goodRequest()),
      io,
    );
    assert.equal(receipt.verification.verified, false, why);
    assert.notEqual(receipt.verification.reason, zk.ZK_ECHO_REASON, `${why}: not the echo reason`);
    assert.ok(!receipt.coverage.includes('zk.proof-valid'), `${why}: no control is credited`);
  }
});

// D15. The public surface: nothing was removed or renamed, and the new reasons are constants a host
// can compare.
test('K3E.15 the public exports keep every name they had, with two reasons added', () => {
  for (const name of ['createZkVerifier', 'digestZkVerificationKey', 'readZkEvidence', 'readZkClaim',
    'reconcileZk', 'claimsZk', 'VK_SCHEMA', 'EVIDENCE_SCHEMA', 'ZK_CHECK_KEYS', 'COVERED_CHECKS',
    'LIMIT_CHECKS', 'ZK_INCONSISTENT_REASON', 'FP_MODULUS', 'SCALAR_MODULUS']) {
    assert.ok(name in zk, `${name} is still exported`);
  }
  assert.equal(typeof zk.ZK_FOREIGN_CHECK_REASON, 'string');
  assert.equal(typeof zk.ZK_ECHO_REASON, 'string');
  assert.ok(!zk.ZK_FOREIGN_CHECK_REASON.includes(PRIVATE));
  assert.ok(!zk.ZK_ECHO_REASON.includes(PRIVATE));
  assert.ok(Object.isFrozen(zk.ZK_CHECK_KEYS), 'the catalog is frozen');
  assert.deepEqual(zk.ZK_CHECK_KEYS, [...COVERED, ...LIMITS]);
});

// D16. `reconcileZk` is public and is used by both call sites. It refuses a claim that reports a name
// outside the catalog on its own, so a caller that forgets the filter still fails closed.
test('K3E.16 reconcileZk refuses a claim that reports a name outside the catalog', () => {
  const out = zk.reconcileZk({
    verified: true,
    checks: checks({ 'zk.owner-approval': true }),
    claimed: true,
    zk: evidence(),
  });
  assert.equal(out.consistent, false, 'the claim did not hold up');
  assert.equal(out.verified, false);
  assert.equal(out.zk, null, 'and it is not carried');
  const honest = zk.reconcileZk({ verified: true, checks: checks(), claimed: true, zk: evidence() });
  assert.equal(honest.consistent, true, 'the honest claim still holds up');
  assert.deepEqual(honest.zk.publicInputs, ['35']);
  const untouched = zk.reconcileZk({ verified: true, checks: { local: true }, claimed: true, zk: evidence() });
  assert.equal(untouched.consistent, false, 'a claim with no catalog name at all is still refused');
  assert.equal(zk.reconcileZk({
    verified: true, checks: { local: true }, claimed: false, zk: null,
  }).consistent, true, 'and a receipt without a claim is not touched by any of this');
});

// D17. The evidence the port writes is not affected: the port's own answers carry exactly the seven
// names, so a verified answer is credited normally after the decision.
test('K3E.17 a real verified answer is credited normally after the decisions', async () => {
  const out = await createZkVerifier(config({ backend: () => true }))(goodRequest());
  assert.deepEqual(Object.keys(out.checks).sort(), [...zk.ZK_CHECK_KEYS].sort());
  assert.equal(out.verified, true);
  const spec = receiptSpec({
    verified: out.verified, checks: out.checks, reason: out.reason, zk: out.zk,
  });
  const receipt = buildReceipt(spec);
  assert.equal(receipt.status, 'verified');
  assert.deepEqual([...receipt.coverage].sort(), [...COVERED].sort());
  for (const limit of LIMITS) assert.ok(receipt.notCovered.includes(limit));
  assert.equal(receipt.verification.zk.vkDigest, fx.manifest.digests.vkDigest);
  assert.notEqual(receipt.verification.zk.backendDigest, OTHER_DIGEST);
  assert.equal(verifyReceipt(receipt).ok, true);
});