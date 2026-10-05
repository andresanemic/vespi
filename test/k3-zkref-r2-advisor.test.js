'use strict';
// K3-zkref-r2: the four cases the independent Advisor (round 2) reported as blocking on this branch,
// moved here so they stay traceable. Test titles carry the reviewer's own R2-## code.
//
// None of these four needs the reviewer's vectors: they run on the public Stellar fixture and on the
// second key his round 1 left in test/fixtures/zk/advisor-other-key.json.
//
// Fix 1 (R2-08) freezes three digests that `release/0.1.4-prep` produces for a receipt whose
// verification carries no usable `checks`. They were measured against that base with the receipt
// spec below, so a change in any other field of the receipt still shows up as a digest of its own.
// A patch release cannot move a digest an older receipt already has, and the closed zk catalog must
// not add a `checks` key where the base had none.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ref = require('../src/zk-bn254-reference.js');
const fx = require('./helpers/zk-fixture.js');
const zk = require('../src/zk.js');
const { buildReceipt } = require('../src/receipt.js');
const other = require('./fixtures/zk/advisor-other-key.json').other;

const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);

function verifier(vk, backendVerify, expectedPublicInputs = ['35']) {
  return zk.createZkVerifier({
    verificationKey: vk,
    expectedVkDigest: zk.digestZkVerificationKey(vk),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs,
    backend: backendVerify,
    backendDigest: BACKEND_DIGEST,
  });
}

// The reviewer's receipt spec, unchanged: the digests below are only comparable if the receipt is the
// same receipt.
const receiptSpec = (verification, status = 'verified') => ({
  operation: { id: 'r2', goal: 'g' },
  capabilityId: 'c',
  authority: { spend: [] },
  outcome: { status, exercised: [] },
  evidence: {},
  verification,
  at: '2040-01-01T00:00:00.000Z',
});

// The three digests `release/0.1.4-prep` gives this spec. Measured, not derived by reading code:
// .job/tmp/base-digests.js ran the base's own src/receipt.js.
const BASE_NO_CHECKS = 'd56face900bbb6a838011d79990e8fddee31c15c571ff5b06cabe933f309c25c';
const BASE_NO_CHECKS_REASON = '27a81c45dede7d1367561e0883baecd9caaa8f30c2c8e8f640539f0e6133e6aa';
const BASE_EMPTY_CHECKS = '6ccf1f4cf359127460fe8e28a3ce5eea95e2d3d3773b1a6c58d94c0e6917fc09';

// R2-08 / advisor fix 1: the closed catalog decides what a name inside a claim may be called, and it
// decides whether a name outside one is foreign. It has no business inventing the `checks` key itself,
// so a verification that carried none comes out with none, exactly as the base left it.
test('R2-08 an old receipt whose verification has no checks keeps its shape and its digest', () => {
  const cases = [
    [{ verified: true }, { verified: true }, BASE_NO_CHECKS],
    [{ verified: false, reason: 'x' }, { verified: false, reason: 'x' }, BASE_NO_CHECKS_REASON],
    // An array of checks is not a record of checks: the base dropped it, and dropping is the shape.
    [{ verified: true, checks: [true] }, { verified: true }, BASE_NO_CHECKS],
    // And a receipt that did have an empty record keeps it, so the fix is not "drop checks" either.
    [{ verified: true, checks: {} }, { verified: true, checks: {} }, BASE_EMPTY_CHECKS],
  ];
  for (const [given, expectedVerification, expectedDigest] of cases) {
    const receipt = buildReceipt(receiptSpec(given));
    assert.deepEqual(receipt.verification, expectedVerification, `verification ${JSON.stringify(given)}`);
    assert.equal(receipt.digest, expectedDigest, `digest for ${JSON.stringify(given)}`);
  }
});

// R2-08, second half: the regression is invisible to a test that only builds receipts with checks, so
// say it here as well. Nothing else about the base receipt may move either.
test('R2-08b a receipt without checks reads no coverage and no failed check', () => {
  const receipt = buildReceipt(receiptSpec({ verified: true }));
  assert.deepEqual(receipt.verification, { verified: true });
  assert.deepEqual(receipt.coverage, []);
  assert.deepEqual(receipt.notCovered, ['external anchor'], 'an absent record is not an empty one');
});

// R2-09 / advisor fix 2: the catalog refusal lowers the verdict inside the verification, and a direct
// caller may hand `buildReceipt` any status it likes. A receipt may not read `verified` while its own
// verification says false, whichever of the two made it false.
test('R2-09 a direct receipt never reads verified while its own verification says false (foreign zk. name, no claim)', () => {
  const receipt = buildReceipt(receiptSpec({ verified: true, reason: 'ok', checks: { 'zk.mine': true } }));
  assert.equal(receipt.verification.verified, false, 'the foreign name failed the verification');
  assert.equal(receipt.verification.checks['zk.mine'], undefined, 'the invented name was not copied');
  assert.notEqual(receipt.status, 'verified', `status ${receipt.status} with verification.verified false`);
});

// R2-10 / advisor fix 3: `nPublic = 0` binds nothing, so the port refuses such a key while it is
// built. The receipt is the second barrier for everything the port asks for, and a verifier that is
// not the port (or an edited answer) must not get past it with a claim that carries no public input.
test('R2-10 a zk claim that binds no public input (publicInputs: []) is not a verified receipt (decision: nPublic 0)', async () => {
  const vk = fx.verificationKey();
  const answer = await verifier(vk, () => true, fx.publicInputs())({
    proof: fx.proof(),
    publicInputs: fx.publicInputs(),
  });
  assert.equal(answer.verified, true, 'the honest answer the host then edits');
  const unbound = { ...answer, zk: { ...answer.zk, publicInputs: [] } };
  const receipt = buildReceipt(receiptSpec(unbound));
  assert.equal(receipt.verification.zk, undefined, 'a claim binding nothing is not a claim');
  assert.notEqual(receipt.status, 'verified', 'a claim binding nothing reached a verified receipt');
});

// R2-06 / advisor fix 4: one key has to be read once. A Proxy that shows K1 to the descriptor walk and
// K2 to a plain read used to leave the backend digesting K1 and pairing K2, so the receipt named a key
// the maths never used, under the port's own pinned digest.
test('R2-06 a Proxy key cannot make createReferenceBackend digest one key and verify against another', async () => {
  const pinned = fx.verificationKey();
  const hidden = other.vk;
  // Descriptors (what the port's reader uses) show the Stellar key; [[Get]] (what JSON.stringify uses)
  // shows the other one.
  const twoFaced = new Proxy(fx.verificationKey(), {
    get: (target, prop) => (typeof prop === 'string' && prop in hidden ? hidden[prop] : Reflect.get(target, prop)),
  });
  let backend;
  try {
    backend = ref.createReferenceBackend(twoFaced);
  } catch {
    return; // refusing the key at construction is a correct answer too
  }
  const answer = await verifier(pinned, (snapshot) => backend.verify(snapshot))({
    proof: other.proof,
    publicInputs: ['35'],
  });
  assert.equal(answer.verified, false,
    `port reported verified under vkDigest ${answer.zk.vkDigest.slice(0, 12)} with a proof only the other key accepts`);
});