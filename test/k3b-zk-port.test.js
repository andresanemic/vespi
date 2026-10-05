'use strict';
// K3b phase 1 RED: the injected verification port. Compatibility control first (design 5.1), then
// key pinning (5.2), public input binding (5.3), the adversarial parser (5.4) and the backend
// contract (5.5). The backend here is a test double and says so; it is not a proof system.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildReceipt } = require('../src/receipt.js');
const fx = require('./helpers/zk-fixture.js');
const { createZkVerifier, digestZkVerificationKey } = require('../src/zk.js');

const LEGACY_DIGEST = 'a01bca12b310d97e3d3657e7f234e8eaf7615a070c2ac48ebb97e6968ad9ca69';
const CONFIG_ERROR = 'zk verifier configuration is invalid';

const CHECK_KEYS = [
  'zk.verification-key-pinned',
  'zk.public-inputs-bound',
  'zk.proof-valid',
  'zk.presenter-authentication',
  'zk.institutional-attestation',
  'zk.replay-prevention',
  'zk.transport-privacy',
];
const COVERED_CHECKS = CHECK_KEYS.slice(0, 3);
const LIMIT_CHECKS = CHECK_KEYS.slice(3);

const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);
const FIXTURE_VK_DIGEST = 'ac15a1619729637dcc406bfa3ac34557a31e622eef0471aceb6564aedb789fee';

// A stand-in for a proof system. It answers `true` for the fixture's exact proof and inputs and
// nothing else. Every phase 1 verdict below is about the port, not about Groth16.
function simulatedBackend() {
  const accepted = { proof: fx.proof(), publicInputs: fx.publicInputs() };
  const calls = [];
  const backend = (input) => {
    calls.push(input);
    const same = JSON.stringify(input.proof) === JSON.stringify(accepted.proof)
      && JSON.stringify(input.publicInputs) === JSON.stringify(accepted.publicInputs);
    return same;
  };
  backend.calls = calls;
  backend.label = 'simulated';
  return backend;
}

// `in` rather than `||`, so a test can deliberately pass null, [] or undefined and mean it.
function config(over = {}) {
  const verificationKey = 'verificationKey' in over ? over.verificationKey : fx.verificationKey();
  let expectedVkDigest = over.expectedVkDigest;
  if (expectedVkDigest === undefined) {
    // A key the strict reader refuses has no digest to pin; the fixture's own digest stands in, so
    // the test still reaches createZkVerifier and reads the refusal there.
    try { expectedVkDigest = digestZkVerificationKey(verificationKey); } catch { expectedVkDigest = FIXTURE_VK_DIGEST; }
  }
  return {
    verificationKey,
    expectedVkDigest,
    circuitDigest: 'circuitDigest' in over ? over.circuitDigest : CIRCUIT_DIGEST,
    expectedPublicInputs: 'expectedPublicInputs' in over ? over.expectedPublicInputs : fx.publicInputs(),
    backend: 'backend' in over ? over.backend : simulatedBackend(),
    backendDigest: 'backendDigest' in over ? over.backendDigest : BACKEND_DIGEST,
    ...('maxPublicInputs' in over ? { maxPublicInputs: over.maxPublicInputs } : {}),
  };
}

const request = () => ({ proof: fx.proof(), publicInputs: fx.publicInputs() });

function assertRejectedConfig(candidate, why) {
  assert.throws(() => createZkVerifier(candidate), (err) => err instanceof TypeError
    && err.message === CONFIG_ERROR, why);
}

// --- 1. compatibility, measured before anything was edited ---

test('K3B.1 a legacy receipt keeps its literal digest, with no zk property and no new check', () => {
  const receipt = buildReceipt({
    operation: { id: 'zk-legacy', goal: 'legacy compatibility', action: 'local-check' },
    capabilityId: 'test-cap',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'test' },
    at: '2040-01-01T00:00:00.000Z',
  });
  assert.equal(receipt.digest, LEGACY_DIGEST);
  assert.ok(!('zk' in receipt), 'no zk key appears on a receipt built without zk');
  assert.ok(!('zk' in receipt.verification), 'no zk key appears inside verification');
  assert.deepEqual(Object.keys(receipt.verification), ['verified', 'checks', 'reason']);
  assert.deepEqual(receipt.coverage, ['local']);
  assert.deepEqual(receipt.notCovered, ['external anchor']);
});

test('K3B.2 the existing public exports keep their names and their arity', () => {
  const operation = require('../src/operation.js');
  const receipt = require('../src/receipt.js');
  const authority = require('../src/authority.js');
  const continuity = require('../src/continuity.js');
  const delegation = require('../src/delegation.js');
  assert.deepEqual(Object.keys(operation).sort(), ['DEFAULT_EXIT', 'STATES', 'createOperation', 'pauseOperation', 'resumeOperation', 'runOperation']);
  // The four original names must stay; `computeDigest` was added later (skill provenance and emergency access seal extra
  // fields with the same digest). An addition is compatible, a removal or rename is not.
  const receiptNames = Object.keys(receipt).sort();
  for (const name of ['anchorReceipt', 'anchorReceiptAsync', 'buildReceipt', 'verifyReceipt']) assert.ok(receiptNames.includes(name), `receipt export ${name} must stay`);
  assert.deepEqual(receiptNames.filter((n) => !['anchorReceipt', 'anchorReceiptAsync', 'buildReceipt', 'verifyReceipt'].includes(n)), ['computeDigest']);
  assert.deepEqual(Object.keys(authority).sort(), ['grantSpend', 'sufficient']);
  assert.deepEqual(Object.keys(continuity).sort(), ['resumeFromReceipts']);
  assert.ok(Object.keys(delegation).length > 0);
});

// --- 2. the verification key is pinned by digest, at build time ---

test('K3B.3 a configuration whose vk digest is not the pinned one is refused before any request', () => {
  assertRejectedConfig(config({ expectedVkDigest: 'd'.repeat(64) }), 'a digest that is not the pinned one');
});

test('K3B.4 an altered verification key is refused while the pin still names the original one', () => {
  const altered = fx.verificationKey();
  altered.ic[1][0] = '7';
  assertRejectedConfig(config({ verificationKey: altered, expectedVkDigest: FIXTURE_VK_DIGEST }), 'an altered key under the original pin');
  assert.notEqual(digestZkVerificationKey(altered), FIXTURE_VK_DIGEST,
    'and the alteration really does change the digest');
});

test('K3B.5 a key whose nPublic and ic disagree never becomes a verifier', () => {
  // The structural gate and the pin both refuse here, and that is the honest shape of it: a key the
  // strict reader will not read has no digest anyone could pin. K3B.3 isolates the pin on its own.
  for (const nPublic of [2, 0, -1, 1.5, '1', null]) {
    const broken = fx.verificationKey();
    broken.nPublic = nPublic;
    assertRejectedConfig(config({ verificationKey: broken }), `nPublic ${String(nPublic)}`);
  }
  for (const icLength of [1, 3, 4]) {
    const broken = fx.verificationKey();
    broken.ic = Array.from({ length: icLength }, () => fx.verificationKey().ic[0]);
    assertRejectedConfig(config({ verificationKey: broken }), `ic length ${icLength}`);
  }
});

test('K3B.6 incomplete metadata is refused: every digest and both input lists are required', () => {
  const complete = config();
  for (const key of ['expectedVkDigest', 'circuitDigest', 'backendDigest', 'expectedPublicInputs', 'verificationKey']) {
    const partial = { ...complete };
    delete partial[key];
    assertRejectedConfig(partial, `missing ${key}`);
  }
});

test('K3B.7 the expected public inputs come from the agreement, so their count must be nPublic', () => {
  for (const list of [[], ['35', '1'], '35', [35], null, ['']]) {
    assertRejectedConfig(config({ expectedPublicInputs: list }), `expectedPublicInputs ${JSON.stringify(list)}`);
  }
});

test('K3B.8 maxPublicInputs is an integer between 1 and 32 and defaults to 32', () => {
  for (const bad of [0, 33, -1, 2.5, '8', null, true]) {
    assertRejectedConfig(config({ maxPublicInputs: bad }), `maxPublicInputs ${String(bad)}`);
  }
  const wide = config({ maxPublicInputs: 8 });
  assert.doesNotThrow(() => createZkVerifier(wide));
  const narrow = fx.verificationKey();
  narrow.nPublic = 33;
  narrow.ic = Array.from({ length: 34 }, () => fx.verificationKey().ic[0]);
  assertRejectedConfig(config({ verificationKey: narrow, maxPublicInputs: 32 }), 'nPublic above the ceiling');
});

test('K3B.9 the configuration is copied and frozen: mutating it afterwards changes nothing', async () => {
  const mutable = config();
  const verify = createZkVerifier(mutable);
  const originalIc0 = mutable.verificationKey.ic[0][0];
  const originalInputsLength = mutable.expectedPublicInputs.length;
  mutable.verificationKey = { ...mutable.verificationKey, nPublic: 7 };
  mutable.verificationKey.ic[0][0] = '9';
  mutable.expectedPublicInputs.push('999');
  mutable.expectedVkDigest = 'e'.repeat(64);
  mutable.circuitDigest = 'f'.repeat(64);
  const out = await verify(request());
  assert.equal(out.verified, true);
  assert.equal(out.zk.vkDigest, FIXTURE_VK_DIGEST);
  assert.equal(out.zk.circuitDigest, CIRCUIT_DIGEST);
  assert.deepEqual(out.zk.publicInputs, ['35']);
  assert.equal(mutable.verificationKey.ic[0][0], '9', 'the caller did mutate its own copy');
  assert.equal(mutable.expectedPublicInputs.length, originalInputsLength + 1);
  assert.equal(digestZkVerificationKey(fx.verificationKey()), FIXTURE_VK_DIGEST,
    'and the verifier still holds the key as it was at build time');
});

test('K3B.10 the frozen snapshot the backend receives cannot be written to', async () => {
  let seen = null;
  const verify = createZkVerifier(config({ backend: (input) => { seen = input; return true; } }));
  await verify(request());
  assert.ok(seen, 'the backend was called');
  assert.ok(Object.isFrozen(seen), 'the snapshot is frozen');
  assert.ok(Object.isFrozen(seen.proof), 'the proof inside is frozen');
  assert.ok(Object.isFrozen(seen.proof.a), 'a coordinate pair inside is frozen');
  assert.ok(Object.isFrozen(seen.verificationKey), 'the key inside is frozen');
  assert.ok(Object.isFrozen(seen.publicInputs), 'the inputs inside are frozen');
  assert.throws(() => { seen.publicInputs[0] = '22'; }, TypeError);
  assert.deepEqual(seen.publicInputs, ['35']);
});

test('K3B.11 digestZkVerificationKey ignores key order and refuses anything that is not a valid key', () => {
  const vk = fx.verificationKey();
  const reordered = {
    ic: vk.ic, delta: vk.delta, gamma: vk.gamma, beta: vk.beta, alpha: vk.alpha,
    nPublic: vk.nPublic, schema: vk.schema,
  };
  assert.equal(digestZkVerificationKey(reordered), FIXTURE_VK_DIGEST);
  assert.match(digestZkVerificationKey(vk), /^[0-9a-f]{64}$/);
  for (const bad of [null, undefined, 'vk', 7, [], { ...vk, extra: 1 }, { ...vk, schema: 'other' }]) {
    assert.throws(() => digestZkVerificationKey(bad), (err) => err instanceof TypeError
      && err.message === CONFIG_ERROR, `digestZkVerificationKey ${JSON.stringify(bad)}`);
  }
});

// --- 3. the public inputs of the request are bound to the ones the agreement fixed ---

test('K3B.12 a well formed proof for different public inputs is refused without calling the backend', async () => {
  const backend = simulatedBackend();
  const verify = createZkVerifier(config({ backend }));
  const out = await verify({ proof: fx.proof(), publicInputs: ['22'] });
  assert.equal(out.verified, false);
  assert.equal(out.zk.result, 'invalid');
  assert.equal(out.zk.code, 'public_inputs_mismatch');
  assert.equal(backend.calls.length, 0, 'the backend is not consulted when the inputs differ');
  assert.equal(out.checks['zk.public-inputs-bound'], false);
  assert.equal(out.checks['zk.proof-valid'], false);
});

test('K3B.13 varying any single expected value (root, document, epoch, context) invalidates its use', async () => {
  for (const signal of ['0', '1', '22', '34', '36', '350']) {
    const verify = createZkVerifier(config({ expectedPublicInputs: [signal] }));
    const out = await verify(request());
    assert.equal(out.verified, false, `expected ${signal}`);
    assert.equal(out.zk.code, 'public_inputs_mismatch', `expected ${signal}`);
  }
});

test('K3B.14 the request cannot smuggle its own idea of the expected inputs', async () => {
  const backend = simulatedBackend();
  const verify = createZkVerifier(config({ backend, expectedPublicInputs: ['35'] }));
  const sneaky = { proof: fx.proof(), publicInputs: ['22'] };
  Object.defineProperty(sneaky, 'expectedPublicInputs', { value: ['22'], enumerable: false });
  const out = await verify(sneaky);
  assert.equal(out.zk.code, 'public_inputs_mismatch');
  assert.deepEqual(out.zk.publicInputs, ['35'], 'the evidence carries the configured inputs');
  assert.equal(backend.calls.length, 0);
});

test('K3B.15 circuitDigest describes a public artifact and does not bind the key to the circuit', async () => {
  // Recorded limit, not a defect to fix here: two configurations that differ only in circuitDigest
  // both verify the same proof. Proving that a key belongs to a circuit is the circuit's and the
  // trusted setup's job (a prepared ceremony, a source hash), and this port cannot do it.
  const a = createZkVerifier(config({ circuitDigest: '1'.repeat(64) }));
  const b = createZkVerifier(config({ circuitDigest: '2'.repeat(64) }));
  const outA = await a(request());
  const outB = await b(request());
  assert.equal(outA.verified, true);
  assert.equal(outB.verified, true);
  assert.notEqual(outA.zk.circuitDigest, outB.zk.circuitDigest);
  assert.equal(outA.zk.vkDigest, outB.zk.vkDigest);
});

// --- 4. the adversarial parser ---

const GOOD = request();

function mutate(change) {
  const bad = JSON.parse(JSON.stringify(GOOD));
  change(bad);
  return bad;
}

const MALFORMED_REQUESTS = {
  'a Number public input': mutate((r) => { r.publicInputs = [35]; }),
  'a Number coordinate': mutate((r) => { r.proof.a[0] = 19183589460475015520744452748804342323349556559415534963620622477877446395087; }),
  'a BigInt coordinate': mutate((r) => { r.proof.a = [19183589460475015520744452748804342323349556559415534963620622477877446395087n, '2']; }),
  'a BigInt public input': mutate((r) => { r.publicInputs = [35n]; }),
  'a negative coordinate': mutate((r) => { r.proof.a[1] = '-2'; }),
  'a plus sign': mutate((r) => { r.proof.a[1] = '+2'; }),
  'a padded decimal': mutate((r) => { r.proof.a[1] = ' 2'; }),
  'an exponent': mutate((r) => { r.proof.a[1] = '2e1'; }),
  'hex': mutate((r) => { r.proof.a[1] = '0x2'; }),
  'leading zeros': mutate((r) => { r.publicInputs = ['035']; }),
  'a trailing newline': mutate((r) => { r.publicInputs = ['35\n']; }),
  'a 79 digit scalar': mutate((r) => { r.publicInputs = ['9'.repeat(79)]; }),
  'the base field modulus p': mutate((r) => { r.proof.a[0] = '21888242871839275222246405745257275088696311157297823662689037894645226208583'; }),
  'the scalar field modulus r': mutate((r) => { r.publicInputs = ['21888242871839275222246405745257275088548364400416034343698204186575808495617']; }),
  'r plus the expected signal': mutate((r) => { r.publicInputs = ['21888242871839275222246405745257275088548364400416034343698204186575808495652']; }),
  'a short coordinate pair': mutate((r) => { r.proof.a = [r.proof.a[0]]; }),
  'a long coordinate pair': mutate((r) => { r.proof.a = [...r.proof.a, '1']; }),
  'a sparse array': mutate((r) => { r.proof.a = [r.proof.a[0]]; r.proof.a[3] = '1'; }),
  'too many public inputs': mutate((r) => { r.publicInputs = ['35', '1']; }),
  'no public inputs': mutate((r) => { r.publicInputs = []; }),
  'a non array input list': mutate((r) => { r.publicInputs = '35'; }),
  'a nested object': mutate((r) => { r.publicInputs = [{ value: '35' }]; }),
  'an extra key on the request': mutate((r) => { r.witness = { r: '1' }; }),
  'an extra key on the proof': mutate((r) => { r.proof.z = '1'; }),
  'an extra key on a point': mutate((r) => { r.proof.a.z = '1'; }),
  'a string proof': mutate((r) => { r.proof = 'proof'; }),
  'a missing proof': mutate((r) => { delete r.proof; }),
  'a missing input list': mutate((r) => { delete r.publicInputs; }),
  'an array as the request': [],
  'a string as the request': 'request',
  'null': null,
  'undefined': undefined,
  'a boolean': true,
};

test('K3B.16 every malformed request is refused as malformed_input and never succeeds', async () => {
  const backend = simulatedBackend();
  const verify = createZkVerifier(config({ backend }));
  for (const [why, bad] of Object.entries(MALFORMED_REQUESTS)) {
    const out = await verify(bad);
    assert.equal(out.verified, false, why);
    assert.equal(out.zk.code, 'malformed_input', why);
    assert.equal(out.zk.result, 'invalid', why);
    assert.equal(out.zk.proofDigest, null, why);
    assert.deepEqual(out.zk.publicInputs, ['35'], `${why}: the evidence keeps the configured inputs`);
    for (const key of CHECK_KEYS) assert.equal(out.checks[key], false, `${why}: ${key}`);
  }
  assert.equal(backend.calls.length, 0, 'no malformed request ever reaches the backend');
});

test('K3B.16b the range boundary is exactly: p minus one and r minus one are in range, p and r are not', async () => {
  const pMinusOne = '21888242871839275222246405745257275088696311157297823662689037894645226208582';
  const rMinusOne = '21888242871839275222246405745257275088548364400416034343698204186575808495616';
  const verify = createZkVerifier(config({ backend: () => false, expectedPublicInputs: [rMinusOne] }));
  const inside = await verify({ proof: fx.proof(), publicInputs: [rMinusOne] });
  assert.equal(inside.zk.code, 'invalid_proof', 'p-1 and r-1 pass the reader and reach the backend');
  assert.equal(inside.zk.publicInputs[0], rMinusOne);
  const outsideCoordinate = await verify({ proof: { ...fx.proof(), a: [pMinusOne, '2'] }, publicInputs: [rMinusOne] });
  assert.equal(outsideCoordinate.zk.code, 'invalid_proof', 'a coordinate equal to p minus one is still in the field');
  const atP = await verify({ proof: { ...fx.proof(), a: ['21888242871839275222246405745257275088696311157297823662689037894645226208583', '2'] }, publicInputs: [rMinusOne] });
  assert.equal(atP.zk.code, 'malformed_input', 'a coordinate equal to p is not in the field');
  const atR = await verify({ proof: fx.proof(), publicInputs: ['21888242871839275222246405745257275088548364400416034343698204186575808495617'] });
  assert.equal(atR.zk.code, 'malformed_input', 'a public input equal to r is not in the scalar field');
});

test('K3B.17 accessors, symbols, foreign prototypes, cycles and throwing proxies are refused', async () => {
  const verify = createZkVerifier(config());
  const accessor = { publicInputs: ['35'] };
  Object.defineProperty(accessor, 'proof', { get: () => fx.proof(), enumerable: true });
  const symboled = { ...GOOD, [Symbol('extra')]: 'x' };
  const inherited = Object.create({ proof: fx.proof(), publicInputs: ['35'] });
  const cyclic = { proof: null, publicInputs: ['35'] };
  cyclic.proof = cyclic;
  const throwingKeys = new Proxy({}, {
    ownKeys() { throw new Error('secret path'); },
    getOwnPropertyDescriptor() { throw new Error('secret path'); },
    get() { throw new Error('secret path'); },
  });
  const throwingProof = new Proxy({ a: ['1', '2'], b: [], c: ['1', '2'] }, {
    ownKeys() { throw new Error('secret path'); },
    getOwnPropertyDescriptor() { throw new Error('secret path'); },
    get() { throw new Error('secret path'); },
  });
  const nested = { proof: { ...GOOD.proof, a: throwingProof }, publicInputs: ['35'] };
  for (const [why, bad] of Object.entries({
    'a getter for proof': accessor,
    'a symbol key': symboled,
    'a foreign prototype': inherited,
    'a cycle': cyclic,
    'a proxy that throws on keys': throwingKeys,
    'a nested proxy that throws': nested,
  })) {
    const out = await verify(bad);
    assert.equal(out.verified, false, why);
    assert.equal(out.zk.code, 'malformed_input', why);
    assert.ok(!/secret path/.test(out.reason), `${why}: the proxy message is not echoed`);
    assert.ok(!JSON.stringify(out).includes('secret path'), `${why}: no proxy message anywhere in the answer`);
  }
});

test('K3B.18 a rejected request is never echoed back', async () => {
  const verify = createZkVerifier(config());
  const secret = '9'.repeat(80);
  const out = await verify(mutate((r) => { r.publicInputs = [secret]; }));
  assert.equal(out.zk.code, 'malformed_input');
  const text = JSON.stringify(out);
  assert.ok(!text.includes(secret), 'the rejected scalar is not in the answer');
  assert.ok(!text.includes(GOOD.proof.a[0]), 'the accepted proof is not in the answer either');
});

// --- 5. the backend contract ---

test('K3B.19 a strict true from the backend is the only success', async () => {
  const verify = createZkVerifier(config({ backend: () => true }));
  const out = await verify(request());
  assert.equal(out.verified, true);
  assert.equal(out.zk.result, 'verified');
  assert.equal(out.zk.code, 'ok');
  assert.deepEqual(Object.keys(out).sort(), ['checks', 'reason', 'verified', 'zk']);
  assert.deepEqual(Object.keys(out.checks).sort(), [...CHECK_KEYS].sort());
  for (const key of COVERED_CHECKS) assert.equal(out.checks[key], true, key);
  for (const key of LIMIT_CHECKS) assert.equal(out.checks[key], false, `${key} is never covered`);
  assert.equal(typeof out.reason, 'string');
  assert.equal(out.reason.length > 0, true);
  assert.deepEqual(Object.keys(out.zk).sort(), [
    'backendDigest', 'circuitDigest', 'code', 'curve', 'proofDigest', 'publicInputs',
    'result', 'schema', 'system', 'vkDigest',
  ]);
  assert.equal(out.zk.schema, 'vespi-zk-evidence-v1');
  assert.equal(out.zk.system, 'groth16');
  assert.equal(out.zk.curve, 'bn254');
  assert.equal(out.zk.backendDigest, BACKEND_DIGEST);
  assert.equal(out.zk.proofDigest, fx.manifest.digests.proofDigest);
});

test('K3B.20 false is an invalid proof, not an error', async () => {
  const verify = createZkVerifier(config({ backend: () => false }));
  const out = await verify(request());
  assert.equal(out.verified, false);
  assert.equal(out.zk.result, 'invalid');
  assert.equal(out.zk.code, 'invalid_proof');
  assert.equal(out.checks['zk.verification-key-pinned'], true);
  assert.equal(out.checks['zk.public-inputs-bound'], true);
  assert.equal(out.checks['zk.proof-valid'], false);
});

test('K3B.21 only the boolean true counts: truthy values are a backend error', async () => {
  for (const [why, value] of Object.entries({
    'the string true': 'true',
    'the number 1': 1,
    'an empty object': {},
    'a truthy array': [true],
    'null': null,
    'undefined (no answer)': undefined,
    'the string ok': 'ok',
    'NaN': Number.NaN,
  })) {
    const verify = createZkVerifier(config({ backend: () => value }));
    const out = await verify(request());
    assert.equal(out.verified, false, why);
    assert.equal(out.zk.result, 'error', why);
    assert.equal(out.zk.code, 'backend_error', why);
    assert.equal(out.checks['zk.proof-valid'], false, why);
  }
});

test('K3B.22 an injected backend is optional; without one the port says unavailable', async () => {
  const verify = createZkVerifier(config({ backend: undefined }));
  const out = await verify(request());
  assert.equal(out.verified, false);
  assert.equal(out.zk.result, 'unavailable');
  assert.equal(out.zk.code, 'backend_unavailable');
  assert.equal(out.checks['zk.verification-key-pinned'], true);
  assert.equal(out.checks['zk.public-inputs-bound'], true);
  assert.equal(out.checks['zk.proof-valid'], false, 'a check that did not run is not credited');
});

test('K3B.23 a backend that throws or rejects is an error and its message never travels', async () => {
  const secret = 'private key of the institution at 0xdeadbeef';
  for (const [why, backend] of Object.entries({
    'a synchronous throw': () => { throw new Error(secret); },
    'a thrown string': () => { throw secret; },
    'a rejected promise': async () => { throw new Error(secret); },
    'a rejected promise with an object': () => Promise.reject({ message: secret }),
  })) {
    const verify = createZkVerifier(config({ backend }));
    const out = await verify(request());
    assert.equal(out.verified, false, why);
    assert.equal(out.zk.result, 'error', why);
    assert.equal(out.zk.code, 'backend_error', why);
    assert.ok(!out.reason.includes(secret), `${why}: not in the reason`);
    assert.ok(!JSON.stringify(out).includes(secret), `${why}: nowhere in the answer`);
  }
});

test('K3B.24 a backend that returns a promise of true still verifies', async () => {
  const verify = createZkVerifier(config({ backend: async () => true }));
  const out = await verify(request());
  assert.equal(out.verified, true);
  assert.equal(out.zk.code, 'ok');
});

test('K3B.25 the backend cannot change the proof or the inputs between the digest and the use', async () => {
  let mutated = null;
  const backend = (input) => {
    // Everything the backend can reach is frozen, so this attempt cannot land.
    try { input.proof.a[0] = '1'; } catch { /* frozen */ }
    try { input.publicInputs[0] = '22'; } catch { /* frozen */ }
    try { input.proof.b[0][0] = '1'; } catch { /* frozen */ }
    mutated = JSON.stringify({ proof: input.proof, publicInputs: input.publicInputs });
    return true;
  };
  const verify = createZkVerifier(config({ backend }));
  const out = await verify(request());
  assert.equal(out.verified, true);
  assert.equal(out.zk.proofDigest, fx.manifest.digests.proofDigest, 'the digest is of the proof that was checked');
  assert.deepEqual(out.zk.publicInputs, ['35']);
  assert.equal(mutated, JSON.stringify({ proof: GOOD.proof, publicInputs: GOOD.publicInputs }));
});

test('K3B.26 a config whose backend is not a function is refused', () => {
  for (const bad of [true, 'backend', 7, {}, []]) {
    assertRejectedConfig(config({ backend: bad }), `backend ${JSON.stringify(bad)}`);
  }
});

test('K3B.27 the same verifier answers the same request the same way twice', async () => {
  const verify = createZkVerifier(config());
  const first = await verify(request());
  const second = await verify(request());
  assert.deepEqual(first, second);
  assert.equal(first.verified, true);
  assert.equal(second.verified, true);
});
