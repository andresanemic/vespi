'use strict';
// K3d phase 3 RED, part 2: the Groth16 equation on top of the pairing.
//
//   e(-A,B) * e(alpha,beta) * e(vk_x,gamma) * e(C,delta) == 1
//   with vk_x = IC[0] + sum(publicInputs[i] * IC[i+1])
//
// Two sources, both required to pass: the real Stellar/gnark fixture for the circuit x^3+x+5=y, and
// the synthetic equations of the independent oracle. The synthetic ones carry their own disclosed
// vk_x and their own four terms, so this suite also checks that the linear combination and the
// negation of A are the ones the oracle used, not merely that both sides return true.
//
// Points arrive in the kernel's own shape, the one the phase 1 port hands a backend: G1 is [x, y]
// and G2 is [[c0, c1], [c0, c1]], with decimal strings or BigInts, coordinates below p and public
// inputs below r. Nothing here reduces a public input modulo r and nothing folds a coordinate
// modulo p: an out of range value is refused. A valid proof says the equation held. It does not say
// who presented it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ref = require('../src/zk-bn254-reference.js');
const fx = require('./helpers/zk-fixture.js');

const VECTORS = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zk', 'independent-vectors.json'), 'utf8'));
const R = BigInt(VECTORS.constants.r);
const P = BigInt(VECTORS.constants.p);
const asOracle = (element) => ref.toOracleBasis(element).join(',');
const toG1 = (point) => (point === null ? null : { x: BigInt(point[0]), y: BigInt(point[1]) });
const toG2 = (point) => (point === null ? null : { x: point[0].map(BigInt), y: point[1].map(BigInt) });
// Points are compared as canonical decimals, field elements through the documented basis conversion.
const kernelG1 = (point) => (point === null ? 'null' : `${BigInt(point.x)},${BigInt(point.y)}`);
const kernelG2 = (point) => (point === null ? 'null'
  : [point.x[0], point.x[1], point.y[0], point.y[1]].map(BigInt).join(','));

// --- 1. The real vector ---------------------------------------------------------------------

test('K3d the Stellar fixture verifies with signal 35 and refuses 22', () => {
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), ['35']), true);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), ['22']), false);
});

test('K3d the Stellar fixture refuses a wrong number of public inputs', () => {
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), []), false);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), ['35', '36']), false);
});

test('K3d a public input equal to r, or r plus a value, is refused rather than reduced', () => {
  // 35 + r and 35 are the same field element, so reducing the input would let one pass as the other.
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), ['22']), false);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), ['35']), true);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), [(35n + R).toString()]), false);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), [R.toString()]), false);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), [(R - 13n).toString()]), false);
});

test('K3d the exchanged Fp2 components of the fixture do not verify', () => {
  assert.equal(ref.verifyGroth16(fx.swapG2(fx.verificationKey()), fx.proof(), ['35']), false);
});

test('K3d a verification key with two slots exchanged does not verify this proof', () => {
  const vk = fx.verificationKey();
  assert.equal(ref.verifyGroth16({ ...vk, delta: vk.gamma, gamma: vk.delta }, fx.proof(), ['35']), false);
});

// --- 2. The synthetic equations of the independent oracle ------------------------------------

// The oracle writes points as objects; the kernel writes them as arrays. Only the spelling differs.
const asKernel = (point) => (point === null ? null : [point.x, point.y]);

function syntheticKey(id) {
  const raw = VECTORS.synthetic_groth16.verification_keys[id];
  return {
    nPublic: raw.ic.length - 1,
    alpha: asKernel(raw.alpha),
    beta: asKernel(raw.beta),
    gamma: asKernel(raw.gamma),
    delta: asKernel(raw.delta),
    ic: raw.ic.map(asKernel),
  };
}

for (const testCase of VECTORS.synthetic_groth16.cases) {
  test(`K3d ${testCase.id} matches the independent synthetic equation`, () => {
    const key = syntheticKey(testCase.vk_id);
    const proof = { a: asKernel(testCase.proof.a), b: asKernel(testCase.proof.b), c: asKernel(testCase.proof.c) };
    assert.equal(ref.verifyGroth16(key, proof, testCase.public_signals), testCase.expected_is_one === '1');
  });
}

test('K3d the other disclosed proof verifies against the other key and not against the first', () => {
  const other = VECTORS.synthetic_groth16.other_valid_reference;
  const proof = { a: asKernel(other.proof.a), b: asKernel(other.proof.b), c: asKernel(other.proof.c) };
  assert.equal(ref.verifyGroth16(syntheticKey(other.vk_id), proof, other.public_signals), true);
  assert.equal(ref.verifyGroth16(syntheticKey('main'), proof, other.public_signals), false);
});

test('K3d the vk_x linear combination is the one the oracle disclosed', () => {
  for (const testCase of VECTORS.synthetic_groth16.cases) {
    const key = syntheticKey(testCase.vk_id);
    const mine = ref.accumulateIc(key.ic, testCase.public_signals);
    assert.equal(kernelG1(toG1(mine)), kernelG1(testCase.vk_x), testCase.id);
  }
});

test('K3d the four assembled terms are the ones the oracle disclosed', () => {
  for (const testCase of VECTORS.synthetic_groth16.cases) {
    const key = syntheticKey(testCase.vk_id);
    const proof = { a: asKernel(testCase.proof.a), b: asKernel(testCase.proof.b), c: asKernel(testCase.proof.c) };
    const terms = ref.equationTerms(key, proof, testCase.public_signals);
    assert.equal(terms.length, 4, testCase.id);
    terms.forEach((term, i) => {
      assert.equal(kernelG1(term.p), kernelG1(testCase.terms[i].p), `${testCase.id} term ${i} G1`);
      assert.equal(kernelG2(term.q), kernelG2(testCase.terms[i].q), `${testCase.id} term ${i} G2`);
    });
    const isOne = ref.fields.fp12.eq(ref.pairingProduct(terms), ref.fields.fp12.ONE);
    assert.equal(isOne, testCase.expected_is_one === '1', testCase.id);
  }
});

// --- 3. Refusals: what an attacker would try -------------------------------------------------

test('K3d infinity where a real element is required is refused, in A, B, C and the key', () => {
  const vk = fx.verificationKey();
  const proof = fx.proof();
  assert.equal(ref.verifyGroth16(vk, { ...proof, a: null }, ['35']), false);
  assert.equal(ref.verifyGroth16(vk, { ...proof, b: null }, ['35']), false);
  assert.equal(ref.verifyGroth16(vk, { ...proof, c: null }, ['35']), false);
  for (const key of ['alpha', 'beta', 'gamma', 'delta']) {
    assert.equal(ref.verifyGroth16({ ...vk, [key]: null }, proof, ['35']), false, key);
  }
  // IC[0] is the constant term of vk_x; with the identity there the equation cannot hold, and the
  // proof above shows it does not.
  assert.equal(ref.verifyGroth16({ ...vk, ic: [null, ...vk.ic.slice(1)] }, proof, ['35']), false);
});

test('K3d the identity in IC is read as allowed and yields a verdict instead of a crash', () => {
  // No real fixture exercises an identity in IC, so the claim is narrow and stated as such: the
  // reader accepts an explicit identity and the verifier answers. It does not prove that some
  // legitimate circuit needs one.
  const vk = { ...fx.verificationKey(), ic: [null, fx.verificationKey().ic[1]] };
  assert.notEqual(ref.readVerificationKey(vk), null);
  assert.equal(ref.verifyGroth16(vk, fx.proof(), ['35']), false);
  assert.equal(ref.verifyGroth16({ ...vk, nPublic: 1 }, fx.proof(), ['35', '36']), false);
});

test('K3d points off the curve, outside the subgroup, or out of the field are refused', () => {
  const vk = fx.verificationKey();
  const proof = fx.proof();
  const bumped = (value) => (BigInt(value) + 1n).toString();
  assert.equal(ref.verifyGroth16(vk, { ...proof, a: [proof.a[0], bumped(proof.a[1])] }, ['35']), false);

  // The oracle's on-twist G2 points outside the order-r subgroup, used as B.
  const outsiders = VECTORS.invalid.g2.filter((item) => item.class === 'outside_subgroup');
  assert.ok(outsiders.length >= 4, 'the oracle must supply on-twist outsiders');
  for (const item of outsiders) {
    assert.equal(ref.verifyGroth16(vk, { ...proof, b: item.point }, ['35']), false, item.id);
  }

  // A coordinate at p, and one past it, are refused rather than folded into the field.
  assert.equal(ref.verifyGroth16(vk, { ...proof, a: [P.toString(), proof.a[1]] }, ['35']), false);
  assert.equal(ref.verifyGroth16(vk, { ...proof, a: [(P + 1n).toString(), proof.a[1]] }, ['35']), false);
  assert.equal(ref.verifyGroth16(vk, { ...proof, b: [[P.toString(), proof.b[0][0][1]], proof.b[0][1]] }, ['35']), false);
});

test('K3d malformed numbers are refused, not coerced', () => {
  const vk = fx.verificationKey();
  const proof = fx.proof();
  const bad = [35.5, -35, ' 35', '35 ', '+35', '0x23', '035', '3e1', '', '35.0', 35, true, null, [], {}];
  for (const value of bad) {
    let verdict = null;
    assert.doesNotThrow(() => { verdict = ref.verifyGroth16(vk, proof, [value]); });
    assert.equal(verdict, false, `signal ${JSON.stringify(String(value))}`);
  }
  // A Number is refused even when it holds the right value: the reader does not coerce.
  assert.equal(ref.verifyGroth16(vk, proof, [35n]), true, 'a BigInt signal is accepted');
});

test('K3d a getter in the proof never reaches the verifier as a value', () => {
  const proof = fx.proof();
  const booby = { ...proof };
  Object.defineProperty(booby, 'a', { get() { throw new Error('touched'); }, enumerable: true });
  assert.equal(ref.verifyGroth16(fx.verificationKey(), booby, ['35']), false);
});

test('K3d a signal list that is not dense is refused', () => {
  const sparse = ['35'];
  sparse[3] = '36';
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), sparse), false);
  assert.equal(ref.verifyGroth16(fx.verificationKey(), fx.proof(), { length: 1, 0: '35' }), false);
});