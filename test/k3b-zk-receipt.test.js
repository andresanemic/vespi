'use strict';
// K3b phase 2 RED: the receipt carries `verification.zk` and nothing looser than that. Design
// section 3: the property is optional and closed, a zk that is malformed or inconsistent forces
// verified:false and is removed with a fixed reason, the four limits always stay in notCovered, and
// nothing in SAFE_EVIDENCE_KEYS widens to let an executor hand itself a zk result.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildReceipt, verifyReceipt } = require('../src/receipt.js');
const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const fx = require('./helpers/zk-fixture.js');
const { createZkVerifier } = require('../src/zk.js');

const LEGACY_DIGEST = 'a01bca12b310d97e3d3657e7f234e8eaf7615a070c2ac48ebb97e6968ad9ca69';
const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);
const EVIDENCE_KEYS = [
  'backendDigest', 'circuitDigest', 'code', 'curve', 'proofDigest', 'publicInputs',
  'result', 'schema', 'system', 'vkDigest',
];
const LIMIT_CHECKS = [
  'zk.presenter-authentication',
  'zk.institutional-attestation',
  'zk.replay-prevention',
  'zk.transport-privacy',
];
const COVERED_CHECKS = ['zk.verification-key-pinned', 'zk.public-inputs-bound', 'zk.proof-valid'];

function zkEvidence(over = {}) {
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

function verifiedChecks(over = {}) {
  return {
    'zk.verification-key-pinned': true,
    'zk.public-inputs-bound': true,
    'zk.proof-valid': true,
    'zk.presenter-authentication': false,
    'zk.institutional-attestation': false,
    'zk.replay-prevention': false,
    'zk.transport-privacy': false,
    ...over,
  };
}

function spec(verification, over = {}) {
  return {
    operation: { id: 'zk-receipt', goal: 'check a proof', action: 'local-check' },
    capabilityId: 'zk:check',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [], ...(over.outcome || {}) },
    evidence: over.evidence || {},
    verification,
    at: '2040-01-01T00:00:00.000Z',
  };
}

const successVerification = () => ({ verified: true, checks: verifiedChecks(), reason: 'groth16 proof verified against the pinned verification key', zk: zkEvidence() });

// --- the property travels ---

test('K3B2.1 a valid zk evidence survives normalization with its closed schema intact', () => {
  const receipt = buildReceipt(spec(successVerification()));
  assert.deepEqual(Object.keys(receipt.verification).sort(), ['checks', 'reason', 'verified', 'zk']);
  assert.deepEqual(Object.keys(receipt.verification.zk).sort(), EVIDENCE_KEYS);
  assert.equal(receipt.verification.zk.result, 'verified');
  assert.equal(receipt.verification.verified, true);
  assert.equal(receipt.status, 'verified');
  assert.deepEqual([...receipt.coverage].sort(), [...COVERED_CHECKS].sort());
  assert.equal(verifyReceipt(receipt).ok, true);
});

test('K3B2.2 the four limits are never coverage, not even on a full success', () => {
  const receipt = buildReceipt(spec(successVerification()));
  for (const limit of LIMIT_CHECKS) {
    assert.ok(receipt.notCovered.includes(limit), `${limit} is in notCovered`);
    assert.ok(!receipt.coverage.includes(limit), `${limit} is not coverage`);
  }
  assert.ok(receipt.notCovered.includes('external anchor'), 'the external anchor limit is still declared');
});

test('K3B2.3 editing any part of the zk evidence breaks the receipt integrity', () => {
  const base = buildReceipt(spec(successVerification()));
  const edits = {
    vkDigest: (zk) => { zk.vkDigest = 'd'.repeat(64); },
    publicInputs: (zk) => { zk.publicInputs = ['22']; },
    proofDigest: (zk) => { zk.proofDigest = null; },
    result: (zk) => { zk.result = 'invalid'; },
    circuitDigest: (zk) => { zk.circuitDigest = 'e'.repeat(64); },
    anExtraKey: (zk) => { zk.witness = 'private'; },
  };
  for (const [why, edit] of Object.entries(edits)) {
    const tampered = JSON.parse(JSON.stringify(base));
    edit(tampered.verification.zk);
    const out = verifyReceipt(tampered);
    assert.equal(out.ok, false, why);
    assert.equal(out.reason, 'digest mismatch', why);
  }
});

test('K3B2.4 recomputing the digest after falsifying the result passes integrity, and that is the limit', () => {
  // Demonstrated, not endorsed: the receipt digest is an unkeyed hash over the body. Anyone who can
  // rewrite the file can recompute it, so `verifyReceipt` proves the body arrived unedited, never
  // who wrote it (principle 7: say the limit out loud instead of implying a guarantee).
  const tampered = buildReceipt(spec({
    verified: true,
    checks: verifiedChecks(),
    reason: 'forged',
    zk: zkEvidence({ result: 'verified', vkDigest: 'd'.repeat(64) }),
  }));
  assert.equal(verifyReceipt(tampered).ok, true);
  assert.equal(tampered.verification.zk.vkDigest, 'd'.repeat(64));
});

// --- a zk that does not hold up ---

test('K3B2.5 a malformed zk forces verified:false and is removed with a fixed reason', () => {
  const malforms = {
    'an extra key': zkEvidence({ witness: '1' }),
    'a missing key': (() => { const zk = zkEvidence(); delete zk.backendDigest; return zk; })(),
    'a wrong schema': zkEvidence({ schema: 'other-v1' }),
    'a wrong system': zkEvidence({ system: 'plonk' }),
    'a wrong curve': zkEvidence({ curve: 'bls12-381' }),
    'a short digest': zkEvidence({ vkDigest: 'abc' }),
    'an uppercase digest': zkEvidence({ vkDigest: 'A'.repeat(64) }),
    'a number digest': zkEvidence({ circuitDigest: 1 }),
    'a number public input': zkEvidence({ publicInputs: [35] }),
    'a public input out of range': zkEvidence({ publicInputs: ['21888242871839275222246405745257275088548364400416034343698204186575808495617'] }),
    'a public input list that is not an array': zkEvidence({ publicInputs: '35' }),
    'a sparse public input list': (() => { const list = ['35']; list[2] = '1'; return zkEvidence({ publicInputs: list }); })(),
    'an unknown result': zkEvidence({ result: 'accepted' }),
    'an unknown code': zkEvidence({ code: 'looks-good' }),
    'a result and code that disagree': zkEvidence({ result: 'verified', code: 'backend_error' }),
    'a proof digest that is neither null nor a digest': zkEvidence({ proofDigest: 'pending' }),
    'a getter for the digest': (() => { const zk = zkEvidence(); Object.defineProperty(zk, 'vkDigest', { get: () => 'a'.repeat(64), enumerable: true }); return zk; })(),
    'a nested object': zkEvidence({ publicInputs: [{ value: '35' }] }),
    'an array': [],
    'a string': 'zk',
    'a number': 7,
  };
  for (const [why, zk] of Object.entries(malforms)) {
    const receipt = buildReceipt(spec({ verified: true, checks: verifiedChecks(), reason: 'claimed', zk }));
    assert.equal(receipt.verification.verified, false, why);
    assert.ok(!('zk' in receipt.verification), `${why}: zk is removed`);
    assert.equal(receipt.status, 'not_verified', `${why}: no receipt claims verified`);
    assert.equal(typeof receipt.verification.reason, 'string');
    assert.ok(receipt.verification.reason.length > 0, why);
  }
});

test('K3B2.6 a zk inconsistent with the verdict or the checks forces verified:false and is removed', () => {
  const cases = {
    'result verified with a false verdict': { verification: { verified: false, checks: verifiedChecks(), reason: 'x', zk: zkEvidence() } },
    'result verified without the three covered checks': { verification: { verified: true, checks: { 'zk.proof-valid': true }, reason: 'x', zk: zkEvidence() } },
    'result verified with proof-valid false': { verification: { verified: true, checks: verifiedChecks({ 'zk.proof-valid': false }), reason: 'x', zk: zkEvidence() } },
    'a claimed limit': { verification: { verified: true, checks: verifiedChecks({ 'zk.presenter-authentication': true }), reason: 'x', zk: zkEvidence() } },
    'result invalid with a true verdict': { verification: { verified: true, checks: verifiedChecks(), reason: 'x', zk: zkEvidence({ result: 'invalid', code: 'invalid_proof' }) } },
    'result unavailable with a true verdict': { verification: { verified: true, checks: verifiedChecks(), reason: 'x', zk: zkEvidence({ result: 'unavailable', code: 'backend_unavailable' }) } },
    'result error with a true verdict': { verification: { verified: true, checks: verifiedChecks(), reason: 'x', zk: zkEvidence({ result: 'error', code: 'backend_error' }) } },
  };
  for (const [why, { verification }] of Object.entries(cases)) {
    const receipt = buildReceipt(spec(verification));
    assert.equal(receipt.verification.verified, false, why);
    assert.ok(!('zk' in receipt.verification), `${why}: zk is removed`);
    assert.equal(receipt.status, 'not_verified', why);
  }
});

test('K3B2.7 a consistent non-verified result is kept, with the verdict it carries', () => {
  for (const [result, code] of [['invalid', 'invalid_proof'], ['unavailable', 'backend_unavailable'], ['error', 'backend_error']]) {
    const receipt = buildReceipt(spec({
      verified: false,
      checks: verifiedChecks({ 'zk.proof-valid': false }),
      reason: 'zk backend did not verify the proof',
      zk: zkEvidence({ result, code }),
    }, { outcome: { status: 'not_verified' } }));
    assert.equal(receipt.verification.zk.result, result);
    assert.equal(receipt.verification.zk.code, code);
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.status, 'not_verified');
    assert.ok(receipt.coverage.includes('zk.verification-key-pinned'));
    assert.ok(receipt.notCovered.includes('zk.proof-valid'));
  }
});

test('K3B2.8 without a zk the receipt keeps exactly the behaviour it had', () => {
  const receipt = buildReceipt(spec({ verified: true, checks: { local: true }, reason: 'test' }));
  assert.deepEqual(Object.keys(receipt.verification), ['verified', 'checks', 'reason']);
  assert.ok(!('zk' in receipt));
  assert.deepEqual(receipt.coverage, ['local']);
  assert.deepEqual(receipt.notCovered, ['external anchor']);
  const explicitNull = buildReceipt(spec({ verified: true, checks: { local: true }, reason: 'test', zk: null }));
  assert.ok(!('zk' in explicitNull.verification), 'an explicit null is not a zk claim');
  assert.equal(explicitNull.verification.verified, true, 'and it does not change the verdict');
  const legacy = buildReceipt({
    operation: { id: 'zk-legacy', goal: 'legacy compatibility', action: 'local-check' },
    capabilityId: 'test-cap',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'test' },
    at: '2040-01-01T00:00:00.000Z',
  });
  assert.equal(legacy.digest, LEGACY_DIGEST, 'the legacy control digest is unchanged by phase 2');
});

test('K3B2.9 no new status was added to the ladder', () => {
  for (const [status, expected] of [['verified', 'verified'], ['not_verified', 'not_verified'], ['failed', 'failed'], ['zk-verified', 'failed'], ['unavailable', 'failed']]) {
    assert.equal(buildReceipt(spec(successVerification(), { outcome: { status } })).status, expected, status);
  }
});

// --- the executor cannot hand itself a zk result ---

test('K3B2.10 a zk smuggled through perform evidence never reaches the receipt verification', async () => {
  const forged = zkEvidence();
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: { zk: forged, verified: true, code: 'ok' } }),
  };
  const { receipt } = await runOperation(op, cap, {
    ask: async () => ({ approved: true }),
    // A verifier that says nothing about zk must not be able to inherit one from the executor.
    verify: () => ({ verified: false, checks: {}, reason: 'no zk verifier was configured' }),
  });
  assert.ok(!('zk' in receipt.verification), 'no zk reaches the receipt from the evidence');
  assert.ok(!('zk' in receipt.evidence), 'and the evidence keeps only the safe keys');
  assert.equal(receipt.verification.verified, false);
  assert.equal(receipt.status, 'not_verified');
});

test('K3B2.11 a proof never grants spend, signers or pausers, and never replaces a consent', async () => {
  const verify = createZkVerifier({
    verificationKey: fx.verificationKey(),
    expectedVkDigest: fx.manifest.digests.vkDigest,
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: () => true,
    backendDigest: BACKEND_DIGEST,
  });
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: { proof: fx.proof(), publicInputs: fx.publicInputs() } }),
  };
  const { receipt } = await runOperation(op, cap, { ask: async () => ({ approved: true }), verify });
  assert.equal(receipt.status, 'verified');
  assert.deepEqual(receipt.authority.grants, [{ asset: 'zk:check', maxAmount: '1', to: 'local:zk' }]);
  assert.deepEqual(receipt.authority.exercised, [{ asset: 'zk:check', maxAmount: '1', to: 'local:zk' }]);
  for (const forbidden of ['signers', 'pausers', 'approvedBy', 'consent']) {
    assert.ok(!(forbidden in receipt), `the proof grants no ${forbidden}`);
    assert.ok(!(forbidden in receipt.authority), `the proof grants no ${forbidden} in authority`);
  }
  const withoutConsent = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const { receipt: denied } = await runOperation(withoutConsent, cap, { ask: async () => ({ approved: false }), verify });
  assert.notEqual(denied.status, 'verified', 'a valid proof does not stand in for the human gate');
  assert.ok(['blocked', 'paused', 'needs_human_decision'].includes(denied.status), denied.status);
});

// --- the integration the design describes ---

test('K3B2.12 a local zk:check operation carries the reviewed evidence into its receipt', async () => {
  const verify = createZkVerifier({
    verificationKey: fx.verificationKey(),
    expectedVkDigest: fx.manifest.digests.vkDigest,
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: () => true,
    backendDigest: BACKEND_DIGEST,
  });
  const request = { proof: fx.proof(), publicInputs: fx.publicInputs() };
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    // No write and no external effect: the request is the evidence, and the verifier reads it before
    // the receipt is sanitized, which is why the raw proof does not travel in the receipt.
    perform: async () => ({ ok: true, evidence: request }),
  };
  const { receipt } = await runOperation(op, cap, { ask: async () => ({ approved: true }), verify });
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.verification.verified, true);
  assert.equal(receipt.verification.zk.result, 'verified');
  assert.equal(receipt.verification.zk.vkDigest, fx.manifest.digests.vkDigest);
  assert.equal(receipt.verification.zk.circuitDigest, CIRCUIT_DIGEST);
  assert.equal(receipt.verification.zk.backendDigest, BACKEND_DIGEST);
  assert.deepEqual(receipt.verification.zk.publicInputs, ['35']);
  assert.deepEqual(Object.keys(receipt.verification.zk).sort(), EVIDENCE_KEYS);
  for (const limit of LIMIT_CHECKS) assert.ok(receipt.notCovered.includes(limit), limit);
  assert.ok(!JSON.stringify(receipt).includes(fx.proof().a[0]), 'the raw proof does not travel in the receipt');
  assert.equal(verifyReceipt(receipt).ok, true);
  assert.equal(op.state, STATES.SUCCEEDED);
});

test('K3B2.13 the same local operation ends not_verified when the proof does not hold', async () => {
  const verify = createZkVerifier({
    verificationKey: fx.verificationKey(),
    expectedVkDigest: fx.manifest.digests.vkDigest,
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: () => false,
    backendDigest: BACKEND_DIGEST,
  });
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: { proof: fx.proof(), publicInputs: fx.publicInputs() } }),
  };
  const { receipt } = await runOperation(op, cap, { ask: async () => ({ approved: true }), verify });
  assert.equal(receipt.status, 'not_verified');
  assert.equal(receipt.verification.zk.code, 'invalid_proof');
  assert.equal(receipt.verification.zk.result, 'invalid');
  assert.equal(op.state, STATES.NOT_VERIFIED);
  assert.equal(verifyReceipt(receipt).ok, true);
  for (const limit of LIMIT_CHECKS) assert.ok(receipt.notCovered.includes(limit), limit);
});

// A verifier that says nothing about zk keeps its old behaviour and may still say verified: that is
// K3B2.8, and it is the whole point of the extension being optional.
test('K3B2.14 a verifier that answers a non-boolean or throws leaves no success', async () => {
  for (const [why, verify] of Object.entries({
    'a string answer': () => 'true',
    'no answer at all': () => undefined,
    'a throwing verifier': () => { throw new Error('private key leaked here'); },
  })) {
    const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
    const cap = {
      id: 'zk:check',
      required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
      perform: async () => ({ ok: true, evidence: { proof: fx.proof(), publicInputs: fx.publicInputs() } }),
    };
    const { receipt } = await runOperation(op, cap, { ask: async () => ({ approved: true }), verify });
    assert.notEqual(receipt.status, 'verified', why);
    assert.equal(receipt.verification.verified, false, why);
  }
});

test('K3B2.15 a malformed zk coming from a verifier leaves the operation not_verified, not succeeded', async () => {
  const op = createOperation({ goal: 'check a proof', authority: { spend: [] } });
  const cap = {
    id: 'zk:check',
    required: () => ({ spend: [{ asset: 'zk:check', amount: '1', to: 'local:zk' }] }),
    perform: async () => ({ ok: true, evidence: { proof: fx.proof(), publicInputs: fx.publicInputs() } }),
  };
  const { receipt } = await runOperation(op, cap, {
    ask: async () => ({ approved: true }),
    verify: () => ({ verified: true, checks: verifiedChecks(), reason: 'claimed', zk: zkEvidence({ schema: 'forged' }) }),
  });
  assert.equal(receipt.verification.verified, false);
  assert.ok(!('zk' in receipt.verification));
  assert.equal(receipt.status, 'not_verified');
  assert.equal(op.state, 'not_verified', 'the operation state agrees with the receipt');
});
