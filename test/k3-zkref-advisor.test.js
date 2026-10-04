'use strict';
// K3-zkref: the five cases of the independent Advisor that failed on this branch, moved verbatim so
// they stay traceable. Test titles carry the reviewer's own ADV-## code.
//
// The reviewer generated his vectors with py_ecc 8.0.0 (seed 0xADB15011) in a generator that imports
// nothing from the kernel; the subset his five cases need is kept in
// test/fixtures/zk/advisor-other-key.json, together with the sha256 of the full vector file, so this
// test can still be connected to its origin.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ref = require('../src/zk-bn254-reference.js');
const fx = require('./helpers/zk-fixture.js');
const zk = require('../src/zk.js');
const advisor = require('./fixtures/zk/advisor-other-key.json');

const { P } = ref.constants;
const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);
const B = BigInt;

test('the advisor subset of vectors is the one the reviewer hashed', () => {
  assert.equal(advisor.sourceVectorsSha256,
    'cfed5fad4aa02909b92253e64c7973c05fbdee7c59f7c5140e0e0a1487edd634');
  assert.equal(advisor.other.vk.nPublic, 1, 'the second key has the same nPublic as the Stellar one');
});

function verifier(verificationKey, backendVerify) {
  return zk.createZkVerifier({
    verificationKey,
    expectedVkDigest: zk.digestZkVerificationKey(verificationKey),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: ['35'],
    backend: backendVerify,
    backendDigest: BACKEND_DIGEST,
  });
}

// ADV-07 / fix 1: the port pins K1 and hands the backend a frozen copy of K1. A backend bound to K2
// must not be able to answer "verified" under the receipt that says K1.
test('ADV-07 the port must not report verified under key K1 when the backend verifies against key K2', async () => {
  const pinned = fx.verificationKey();
  const backend = ref.createReferenceBackend(advisor.other.vk);
  const answer = await verifier(pinned, backend.verify)({
    proof: advisor.other.proof,
    publicInputs: ['35'],
  });
  assert.equal(answer.zk.vkDigest, zk.digestZkVerificationKey(pinned));
  assert.equal(answer.verified, false, 'port reported verified with a backend bound to another key');
});

// ADV-08 / fix 1: the same race, reached the ordinary way. The host passes one object to the port and
// to the backend; the port freezes a copy and the backend must freeze one too.
test('ADV-08 mutating the caller key object after createReferenceBackend must not change what the backend verifies', async () => {
  const key = fx.verificationKey();
  const backend = ref.createReferenceBackend(key);
  const verifyZk = verifier(key, backend.verify);
  Object.assign(key, JSON.parse(JSON.stringify(advisor.other.vk)));
  const answer = await verifyZk({ proof: advisor.other.proof, publicInputs: ['35'] });
  assert.equal(answer.zk.vkDigest, zk.digestZkVerificationKey(fx.verificationKey()));
  assert.equal(answer.verified, false, 'backend followed the mutated key, not the pinned one');
});

// ADV-10 / fix 2: one read per key field. The second read skipped the subgroup check, so a key that
// changes between reads could reach the pairing with points nobody validated.
test('ADV-10 the reference reads each key field once: a key whose gamma changes between reads is not used unvalidated', () => {
  const vk = fx.verificationKey();
  const bad = advisor.nonSubgroupG2[0].q;
  let reads = 0;
  const proxy = new Proxy(vk, {
    get(target, prop, recv) {
      if (prop === 'gamma') { reads += 1; return reads === 1 ? target.gamma : bad; }
      return Reflect.get(target, prop, recv);
    },
  });
  ref.verifyGroth16(proxy, fx.proof(), ['35']);
  assert.equal(reads, 1, `gamma was read ${reads} times; the later read skipped the subgroup check`);
});

// ADV-09 / fix 3: no accessors anywhere in the key, including on the indices of IC.
test('ADV-09 the reference refuses an accessor on an IC index (design 4: no getters)', () => {
  const vk = fx.verificationKey();
  const real = vk.ic[1];
  const ic = [vk.ic[0]];
  Object.defineProperty(ic, '1', { get: () => real, enumerable: true, configurable: true });
  assert.equal(ic.length, 2);
  assert.equal(ref.verifyGroth16({ ...vk, ic }, fx.proof(), ['35']), false);
});

// ADV-11 / fix 4: a coordinate outside the field is invalid input, not the identity. Reading it as the
// identity lets a misconfigured key look like a key.
test('ADV-11 createReferenceBackend refuses an IC entry with a coordinate >= p instead of reading it as identity', () => {
  const vk = fx.verificationKey();
  const bad = { ...vk, ic: [vk.ic[0], [String(P), vk.ic[1][1]]] };
  assert.throws(() => ref.createReferenceBackend(bad), TypeError);
});

// The reading has to be strict in the whole of IC, not only at the index the reviewer happened to use.
test('ADV-11b an out of range coordinate at any IC index above zero is refused, and 0 is refused too', () => {
  const vk = fx.verificationKey();
  assert.throws(() => ref.createReferenceBackend({ ...vk, ic: [vk.ic[0], ['0', vk.ic[1][1]]] }), TypeError);
  assert.throws(() => ref.createReferenceBackend({ ...vk, ic: [vk.ic[0], [vk.ic[1][0], String(B(vk.ic[1][1]) + P)]] }), TypeError);
  assert.throws(() => ref.createReferenceBackend({ ...vk, ic: [[String(P), vk.ic[0][1]], vk.ic[1]] }), TypeError);
  assert.throws(() => ref.createReferenceBackend({ ...vk, ic: [vk.ic[0], [String(P), vk.ic[1][1], '0']] }), TypeError);
});
