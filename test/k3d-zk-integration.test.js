'use strict';
// K3d: the BN254 reference wired as the optional backend of the phase 1 port.
//
// This is the only test that joins the two halves: a real pairing, behind the port, answering with
// a strict boolean. The port still owns the key pinning, the public input binding and the receipt;
// the backend only knows the equation. What the four limit checks say here is the point: three
// checks are true and the four limits stay false after a genuinely valid proof.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ref = require('../src/zk-bn254-reference.js');
const fx = require('./helpers/zk-fixture.js');
const { createZkVerifier, digestZkVerificationKey } = require('../src/zk.js');

const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);

function verifier(over = {}) {
  const verificationKey = over.verificationKey || fx.verificationKey();
  const backend = ref.createReferenceBackend(verificationKey);
  return createZkVerifier({
    verificationKey,
    expectedVkDigest: digestZkVerificationKey(verificationKey),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: ['35'],
    backend: backend.verify,
    backendDigest: BACKEND_DIGEST,
  });
}

test('K3d the port reports verified for the real proof behind the reference backend', async () => {
  const answer = await verifier()({ proof: fx.proof(), publicInputs: ['35'] });
  assert.equal(answer.verified, true);
  assert.equal(answer.reason, 'groth16 proof verified against the pinned verification key');
  assert.equal(answer.checks['zk.verification-key-pinned'], true);
  assert.equal(answer.checks['zk.public-inputs-bound'], true);
  assert.equal(answer.checks['zk.proof-valid'], true);
  // A valid proof buys nothing else. These four stay false and this test is the reason to believe it.
  assert.equal(answer.checks['zk.presenter-authentication'], false);
  assert.equal(answer.checks['zk.institutional-attestation'], false);
  assert.equal(answer.checks['zk.replay-prevention'], false);
  assert.equal(answer.checks['zk.transport-privacy'], false);
  assert.equal(answer.zk.result, 'verified');
  assert.equal(answer.zk.code, 'ok');
  assert.equal(answer.zk.curve, 'bn254');
});

test('K3d the port refuses public inputs the agreement did not fix, without reaching the pairing', async () => {
  const answer = await verifier()({ proof: fx.proof(), publicInputs: ['22'] });
  assert.equal(answer.verified, false);
  assert.equal(answer.checks['zk.public-inputs-bound'], false);
  assert.equal(answer.checks['zk.proof-valid'], false);
  assert.equal(answer.zk.result, 'invalid');
  assert.equal(answer.zk.code, 'public_inputs_mismatch');
});

test('K3d a tampered proof reaches the pairing and comes back not verified', async () => {
  const proof = fx.proof();
  const tampered = { ...proof, c: [proof.c[0], (BigInt(proof.c[1]) + 1n).toString()] };
  const answer = await createZkVerifier({
    verificationKey: fx.verificationKey(),
    expectedVkDigest: digestZkVerificationKey(fx.verificationKey()),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: ['35'],
    backend: ref.createReferenceBackend(fx.verificationKey()).verify,
    backendDigest: BACKEND_DIGEST,
  })({ proof: tampered, publicInputs: ['35'] });
  assert.equal(answer.verified, false);
  assert.equal(answer.checks['zk.proof-valid'], false);
  assert.equal(answer.zk.code, 'invalid_proof');
  assert.equal(answer.reason, 'zk backend did not verify the proof');
});

test('K3d a verification key the reference refuses is a configuration error, not a verdict', () => {
  const swapped = fx.swapG2(fx.verificationKey());
  assert.throws(() => ref.createReferenceBackend(swapped), TypeError);
  assert.throws(() => ref.createReferenceBackend({ ...fx.verificationKey(), ic: [] }), TypeError);
  assert.throws(() => ref.createReferenceBackend({ ...fx.verificationKey(), nPublic: 1, alpha: null }), TypeError);
});