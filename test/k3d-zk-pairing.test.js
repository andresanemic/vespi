'use strict';
// K3d phase 3 RED, part 1: the BN254 field tower, the Frobenius, the untwist, the optimal ate
// pairing with its full final exponentiation, and the pairing products, all against the independent
// py_ecc 8.0.0 vectors in test/fixtures/zk/independent-vectors.json.
//
// Every comparison is exact: canonical decimal integers, twelve Fp12 coefficients, no tolerance.
// The oracle reports Fp12 in the polynomial basis sum(cj*w^j) with w^12-18w^6+82=0 and i=w^6-9;
// the reference works in the standard tower Fp2/Fp6/Fp12. `toOracleBasis` is the documented,
// exact conversion between the two, and part of this suite is that it round trips.
//
// Two previous attempts at this reference failed the same way: e(P,Q)*e(-P,Q) was 1 while
// e(P,Q)^2 was not e(2P,Q). The bilinearity probes below are here to catch exactly that.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ref = require('../src/zk-bn254-reference.js');

const VECTORS = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zk', 'independent-vectors.json'), 'utf8'));
const C = VECTORS.constants;
const P = BigInt(C.p);
const R = BigInt(C.r);

const dec = (value) => BigInt(value);
const mod = (value) => { const b = value % P; return b < 0n ? b + P : b; };
const g1Of = (point) => (point === null ? null : { x: dec(point.x), y: dec(point.y) });
const g2Of = (point) => (point === null ? null : { x: point.x.map(dec), y: point.y.map(dec) });
const basisOf = (coefficients) => coefficients.map(dec);
const oracle12 = (coefficients) => basisOf(coefficients).map(String).join(',');

// The one element every oracle vector is compared through: twelve tower coefficients as decimal.
function asOracle(element) {
  assert.equal(ref.toOracleBasis(element).length, 12);
  return ref.toOracleBasis(element).map(String).join(',');
}

// --- 1. The BN parameters are the ones the curve is built from ---------------------------

test('K3d the BN parameter u reproduces both p and r from their polynomials', () => {
  const u = ref.constants.BN_U;
  assert.equal(typeof u, 'bigint');
  assert.equal(36n * u ** 4n + 36n * u ** 3n + 24n * u ** 2n + 6n * u + 1n, P);
  assert.equal(36n * u ** 4n + 36n * u ** 3n + 18n * u ** 2n + 6n * u + 1n, R);
});

test('K3d the ate loop count is 6u+2 and the twist coefficient is 3/XI', () => {
  assert.equal(ref.constants.ATE_LOOP_COUNT, 6n * ref.constants.BN_U + 2n);
  assert.equal(ref.constants.ATE_LOOP_COUNT, dec(C.ate_loop_count));
  const b2 = ref.fields.fp2.div([3n, 0n], ref.constants.XI);
  assert.deepEqual(b2.map(String), C.b2);
  assert.equal(ref.constants.P, P);
  assert.equal(ref.constants.R, R);
});

// --- 2. Basis conversion, exact and reversible ---------------------------------------------

test('K3d the tower basis converts to the oracle polynomial basis and back', () => {
  const { fp12 } = ref.fields;
  // One is one in both bases, and the oracle says so.
  assert.equal(asOracle(fp12.ONE), VECTORS.conventions.one_fp12.join(','));

  // i = w^6 - 9 is the embedding the oracle documents, so an Fp2 element lands on the w^0 and w^6
  // slots of the polynomial basis, shifted by the -9 that carries i.
  assert.equal(
    asOracle(ref.embedFp2([0n, 1n])),
    [mod(P - 9n), '0', '0', '0', '0', '0', '1', '0', '0', '0', '0', '0'].join(','),
  );
  assert.equal(
    asOracle(ref.embedFp2([7n, 0n])),
    ['7', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'].join(','),
  );

  // An element spread over every tower slot round trips through the twelve coefficients exactly.
  const spread = ref.fromOracleBasis(['3', '0', '5', '0', '7', '0', '11', '0', '13', '0', '17', '0']);
  const back = ref.fromOracleBasis(ref.toOracleBasis(spread));
  assert.equal(asOracle(back), asOracle(spread));
  assert.equal(asOracle(spread), ['3', '0', '5', '0', '7', '0', '11', '0', '13', '0', '17', '0'].join(','));

  // Interleaving the halves is not the same element: the conversion is not order blind.
  const twelve = ref.toOracleBasis(spread);
  const shifted = ref.fromOracleBasis([...twelve.slice(1), '0']);
  assert.notEqual(asOracle(shifted), asOracle(spread));
});

// --- 3. Frobenius --------------------------------------------------------------------------

test('K3d the Frobenius has the order the tower requires', () => {
  const sample = ref.fromOracleBasis(VECTORS.pairings[0].expected);
  // pi^12 is the identity on Fp12.
  let twelve = sample;
  for (let i = 0; i < 12; i += 1) twelve = ref.frobenius(twelve);
  assert.equal(asOracle(twelve), asOracle(sample));
  // pi(a) for a in Fp2 is the conjugate, because p = 3 mod 4.
  assert.equal(asOracle(ref.frobenius(ref.embedFp2([12345n, 6789n]))), asOracle(ref.embedFp2([12345n, P - 6789n])));
  // Six steps is the Q automorphism of the tower, not the identity.
  let six = sample;
  for (let i = 0; i < 6; i += 1) six = ref.frobenius(six);
  assert.equal(six.length, 2);
  assert.notEqual(asOracle(six), asOracle(sample));
});

// --- 4. Untwist ----------------------------------------------------------------------------

test('K3d the untwisted G2 generator lies on Y^2=X^3+3 over Fp12', () => {
  const { fp12 } = ref.fields;
  const q = g2Of(C.g2);
  const point = ref.untwistG2(q);
  const three = ref.embedFp2([3n, 0n]);
  const lhs = fp12.mul(point.y, point.y);
  const rhs = fp12.add(fp12.mul(fp12.mul(point.x, point.x), point.x), three);
  assert.equal(asOracle(lhs), asOracle(rhs));
  // Infinity stays infinity: the embedding is total.
  assert.equal(ref.untwistG2(null), null);
});

// --- 5. The pairing against six independent full pairings ----------------------------------

for (const vector of VECTORS.pairings) {
  test(`K3d ${vector.id} matches the independent pairing`, () => {
    const p = g1Of(vector.p_scalar === '0' ? null : vector.p);
    const q = g2Of(vector.q_scalar === '0' ? null : vector.q);
    const got = ref.pairing(p, q);
    assert.equal(asOracle(got), oracle12(vector.expected));
  });
}

// --- 6. What killed the two previous attempts ----------------------------------------------

test('K3d the pairing is bilinear in both arguments', () => {
  const p = g1Of({ x: '1368015179489954701390400359078579693043519447331113978918064868415326638035', y: '9918110051302171585080402603319702774565515993150576347155970296011118125764' });
  const q = g2Of(C.g2);
  const one = ref.pairing(p, q);
  const squared = ref.fields.fp12.mul(one, one);

  // e(P,Q)^2 == e(2P,Q): the identity the withdrawn attempts failed.
  assert.equal(asOracle(squared), asOracle(ref.pairing(ref.groups.g1.double(p), q)));
  // and the same identity in the second argument.
  assert.equal(asOracle(squared), asOracle(ref.pairing(p, ref.groups.g2.double(q))));
  // e(3P,Q) == e(P,3Q), crossed.
  const three = ref.fields.fp12.mul(squared, one);
  assert.equal(asOracle(three), asOracle(ref.pairing(ref.groups.g1.mul(p, 3n), q)));
  assert.equal(asOracle(three), asOracle(ref.pairing(p, ref.groups.g2.mul(q, 3n))));
  // Addition is multiplicative too.
  assert.equal(
    asOracle(ref.fields.fp12.mul(ref.pairing(p, q), ref.pairing(ref.groups.g1.add(p, p), q))),
    asOracle(ref.pairing(ref.groups.g1.mul(p, 4n), q)),
  );
});

test('K3d the pairing cancels, is not trivial, and lands in the order-r subgroup', () => {
  const p = g1Of({ x: '1', y: '2' });
  const q = g2Of(C.g2);
  const { fp12 } = ref.fields;
  const value = ref.pairing(p, q);
  assert.equal(asOracle(fp12.mul(value, ref.pairing(ref.groups.g1.neg(p), q))), asOracle(fp12.ONE));
  assert.notEqual(asOracle(value), asOracle(fp12.ONE));
  // A pairing value has order dividing r.
  assert.equal(asOracle(fp12.pow(value, R)), asOracle(fp12.ONE));
});

test('K3d infinity in either argument gives the neutral element', () => {
  const { fp12 } = ref.fields;
  const p = g1Of({ x: '1', y: '2' });
  const q = g2Of(C.g2);
  assert.equal(asOracle(ref.pairing(null, q)), asOracle(fp12.ONE));
  assert.equal(asOracle(ref.pairing(p, null)), asOracle(fp12.ONE));
});

// --- 7. Controls: the final exponentiation is not optional ---------------------------------

test('K3d the Miller loop alone does not equal the pairing, and its exponentiation does', () => {
  const { fp12 } = ref.fields;
  const p = g1Of({ x: '1', y: '2' });
  const q = g2Of(C.g2);
  const miller = ref.millerLoop(q, p);
  assert.notEqual(asOracle(miller), asOracle(ref.pairing(p, q)));
  assert.equal(asOracle(ref.finalExponentiate(miller)), asOracle(ref.pairing(p, q)));
  // And the oracle's own value is not the bare Miller loop either.
  assert.notEqual(asOracle(miller), oracle12(VECTORS.pairings[0].expected));
});

// --- 8. Pairing products, twelve of them, half of them one ---------------------------------

for (const vector of VECTORS.pairing_products) {
  test(`K3d ${vector.id} matches the independent product`, () => {
    const terms = vector.terms.map((term) => ({ p: g1Of(term.p), q: g2Of(term.q) }));
    const got = ref.pairingProduct(terms);
    if (vector.expected_is_one === '1') {
      assert.equal(asOracle(got), asOracle(ref.fields.fp12.ONE));
    } else {
      assert.notEqual(asOracle(got), asOracle(ref.fields.fp12.ONE));
      if (vector.expected) assert.equal(asOracle(got), oracle12(vector.expected));
    }
  });
}

test('K3d the product of separate pairings equals the product with one final exponentiation', () => {
  const terms = VECTORS.pairing_products[0].terms.map((term) => ({ p: g1Of(term.p), q: g2Of(term.q) }));
  const separately = terms.reduce(
    (acc, term) => ref.fields.fp12.mul(acc, ref.pairing(term.p, term.q)),
    ref.fields.fp12.ONE,
  );
  assert.equal(asOracle(separately), asOracle(ref.pairingProduct(terms)));
});

test('K3d dropping a single term of a product is detected', () => {
  const vector = VECTORS.pairing_products.find((item) => item.expected_is_one === '1');
  const terms = vector.terms.map((term) => ({ p: g1Of(term.p), q: g2Of(term.q) }));
  for (let i = 0; i < terms.length; i += 1) {
    const kept = terms.filter((_, index) => index !== i);
    assert.notEqual(asOracle(ref.pairingProduct(kept)), asOracle(ref.fields.fp12.ONE));
  }
});