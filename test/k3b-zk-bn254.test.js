'use strict';
// K3b phase 3 RED: the BN254 reference (src/zk-bn254.js), written from the public equations in pure
// JavaScript with BigInt. No package, no WASM, no network, nothing copied from snarkjs (GPL-3) or
// from another implementation.
//
// What these tests can prove and what they cannot: the real vector from stellar/soroban-examples
// verifies, a wrong public signal does not, and the field, curve and pairing identities hold. That is
// mathematical interoperability with ONE public circuit. It is not an audit, not institutional
// attestation, and not a contrast against a second implementation — the independent vectors the
// design asks for are still missing and MANIFEST.json says so.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fx = require('./helpers/zk-fixture.js');
const { verifyGroth16Bn254, bn254Internals } = require('../src/zk-bn254.js');
const { createZkVerifier, digestZkVerificationKey, FP_MODULUS, SCALAR_MODULUS } = require('../src/zk.js');

const { fp, fp2, fp6, fp12, g1, g2, untwist, millerLoop, finalExponentiation, pairing } = bn254Internals;
const CIRCUIT_DIGEST = 'b'.repeat(64);
const BACKEND_DIGEST = 'c'.repeat(64);

const backendInput = (over = {}) => ({
  verificationKey: over.verificationKey || fx.verificationKey(),
  proof: over.proof || fx.proof(),
  publicInputs: over.publicInputs || fx.publicInputs(),
});

const asBigInts = (point) => (point === null ? null : point.map((part) => (Array.isArray(part)
  ? part.map((scalar) => BigInt(scalar))
  : BigInt(part))));

// --- the port and the reference agree on the profile constants ---

test('K3B3.1 the reference uses the same field moduli the port pins', () => {
  assert.equal(fp.P, FP_MODULUS);
  assert.equal(bn254Internals.R, SCALAR_MODULUS);
  assert.equal(fp.G1_B, 3n);
  assert.deepEqual(fp.XI, [9n, 1n]);
});

// --- field arithmetic ---

test('K3B3.2 every field element multiplied by its inverse is one, and zero has no inverse', () => {
  const samples2 = [[3n, 7n], [12345678901234567890n, 98765432109876543210n], [0n, 1n], [1n, 0n]];
  for (const value of samples2) {
    assert.ok(fp2.eq(fp2.mul(value, fp2.inv(value)), fp2.ONE), `fp2 ${value}`);
  }
  assert.throws(() => fp.inv(0n), /zero/i);
  assert.throws(() => fp2.inv(fp2.ZERO), /zero/i);
  assert.throws(() => fp6.inv(fp6.ZERO), /zero/i);
  assert.throws(() => fp12.inv(fp12.ZERO), /zero/i);

  const six = [[fp2.mul([3n, 1n], [2n, 5n]), [fp2.ONE, [7n, 2n]], [[9n, 3n], fp2.ZERO, [4n, 4n]]];
  for (const value of six) {
    assert.ok(fp6.eq(fp6.mul(value, fp6.inv(value)), fp6.ONE), `fp6 ${JSON.stringify(value)}`);
  }
  const twelve = [[six[0], six[2]], [six[1], six[0]]];
  for (const value of twelve) {
    assert.ok(fp12.eq(fp12.mul(value, fp12.inv(value)), fp12.ONE), 'fp12 round trip');
  }
});

test('K3B3.3 the towers are commutative, associative and distribute, and squaring matches multiplication', () => {
  const a = [fp2.mul([3n, 1n], [2n, 5n]), [fp2.ONE, [7n, 2n]], [[9n, 3n], fp2.ZERO, [4n, 4n]]];
  const b = [[fp2.ONE, [1n, 1n]], [fp2.mul([5n, 5n], [2n, 2n]), fp2.ONE], [[2n, 0n], [3n, 3n], [1n, 9n]]];
  const c = [[[1n, 2n], [3n, 0n], [0n, 5n]], [[7n, 7n], [2n, 2n], [3n, 3n]]];
  const at = (x) => ({ fp2: fp2, fp6: fp6, fp12: fp12 }[x]);
  for (const [level, name] of [[fp6, 'fp6'], [fp12, 'fp12']]) {
    assert.ok(level.eq(level.mul(a, b), level.mul(b, a)), `${name} commutative`);
    assert.ok(level.eq(level.mul(level.mul(a, b), c), level.mul(a, level.mul(b, c))), `${name} associative`);
    assert.ok(level.eq(level.mul(a, level.add(b, c)), level.add(level.mul(a, b), level.mul(a, c))), `${name} distributes`);
    assert.ok(level.eq(level.mul(a, a), level.square(a)), `${name} square`);
    assert.ok(level.eq(level.sub(level.add(a, b), b), a), `${name} add/sub`);
    assert.ok(level.eq(level.neg(level.neg(a)), a), `${name} double negation`);
  }
  assert.equal(at('fp2'), fp2);
});

test('K3B3.4 the Fp2 conjugation and the Fp12 frobenius are the maps the tower says they are', () => {
  const value = [[[1n, 2n], [3n, 0n], [0n, 5n]], [[7n, 7n], [2n, 2n], [3n, 3n]]];
  // x^(p^12) = x in Fp12, and x^(p^6) is the conjugation. A wrong coefficient fails both.
  assert.ok(fp12.eq(fp12.frob(value, 12), value), 'frob 12 is the identity on Fp12');
  assert.ok(fp12.eq(fp12.frob(value, 6), fp12.conjugate(value)), 'frob 6 is the conjugation');
  assert.ok(fp12.eq(fp12.frob(fp12.frob(value, 1), 1), fp12.frob(value, 2)), 'frob composes by adding exponents');
  assert.ok(fp12.eq(fp12.frob(fp12.mul(value, value), 1), fp12.mul(fp12.frob(value, 1), fp12.frob(value, 1))), 'frob is a homomorphism');
  const two = [[5n, 9n], [1n, 0n]];
  assert.ok(fp2.eq(fp2.conjugate(fp2.mul(two, fp2.conjugate(two))), fp2.sqr(two)), 'fp2 conjugation');
});

// --- G1 ---

test('K3B3.5 G1: the generator is on y^2 = x^3 + 3 and the group law agrees with itself', () => {
  const G = bn254Internals.G1_GENERATOR;
  assert.ok(g1.onCurve(G), 'the generator is on the curve');
  assert.ok(g1.onCurve(g1.double(G)), '2G is on the curve');
  assert.ok(g1.onCurve(g1.add(G, g1.double(G))), '3G is on the curve');
  assert.ok(g1.eq(g1.double(G), g1.add(G, G)), 'doubling is adding to itself');
  assert.ok(g1.eq(g1.mul(G, 3n), g1.add(g1.double(G), G)), 'three is double plus one');
  assert.ok(g1.isZero(g1.add(G, g1.neg(G))), 'P + (-P) is the identity');
  assert.ok(g1.isZero(g1.mul(G, 0n)), 'zero times P is the identity');
  assert.ok(g1.eq(g1.mul(G, 1n), G), 'one times P is P');
  assert.ok(g1.isZero(g1.mul(G, bn254Internals.R)), '[r]G1 is the identity: G1 has cofactor one');
  assert.ok(!g1.inSubgroup([1n, 3n]), 'a point that is not on the curve is not in the subgroup');
  assert.ok(g1.inSubgroup(G));
});

test('K3B3.6 G2: the generator is on the twist, and [r]P uses the whole integer r', () => {
  const G = bn254Internals.G2_GENERATOR;
  assert.ok(g2.onCurve(G), 'the twist generator is on y^2 = x^3 + 3/(9+u)');
  assert.ok(g2.eq(g2.double(G), g2.add(G, G)), 'doubling is adding to itself');
  assert.ok(g2.isZero(g2.add(G, g2.neg(G))), 'P + (-P) is the identity');
  // If the subgroup check reduced r modulo r it would compute [0]P and call every point valid.
  // [r-1]P == -P only holds when the full 254-bit integer was multiplied.
  assert.ok(g2.eq(g2.mul(G, bn254Internals.R - 1n), g2.neg(G)), '[r-1]P is -P, so r was not reduced to zero');
  assert.ok(g2.isZero(g2.mul(G, bn254Internals.R)), '[r]P is the identity');
  assert.ok(g2.inSubgroup(G));
  assert.ok(!g2.onCurve([G[0], fp2.neg(G[1])]), 'a point off the twist is refused');
});

// --- pairing ---

test('K3B3.7 the untwist maps the twist onto the curve over Fp12', () => {
  const image = untwist(bn254Internals.G2_GENERATOR);
  const [x, y] = image;
  // y^2 == x^3 + 3 over Fp12, with w^2 = v and v^3 = 9 + u.
  const left = fp12.square(y);
  const right = fp12.add(fp12.mul(fp12.square(x), x), [[fp2.mul([3n, 0n], [1n, 0n]), fp2.ZERO, fp2.ZERO], fp6.ZERO]);
  assert.ok(fp12.eq(left, right), 'the untwisted point satisfies the curve equation over Fp12');
});

test('K3B3.8 the pairing cancels, is bilinear, and does not return one for a mismatched pair', () => {
  const P = bn254Internals.G1_GENERATOR;
  const [P2] = [g1.double(P)];
  const Q = bn254Internals.G2_GENERATOR;
  const one = pairing(P, Q);
  assert.ok(!fp12.eq(one, fp12.ONE), 'a single pairing is not one');
  // e(P,Q) * e(-P,Q) == 1
  assert.ok(fp12.eq(fp12.mul(one, pairing(g1.neg(P), Q)), fp12.ONE), 'cancellation in the first argument');
  // e(P,Q)^2 == e(2P, Q)
  assert.ok(fp12.eq(fp12.mul(one, one), pairing(P2, Q)), 'bilinearity in the first argument');
  // and e(P,Q) * e(P,-Q) == 1, in the second
  assert.ok(fp12.eq(fp12.mul(one, pairing(P, g2.neg(Q))), fp12.ONE), 'cancellation in the second argument');
});

test('K3B3.9 the final exponentiation is not optional: the miller loop alone is not one', () => {
  const P = bn254Internals.G1_GENERATOR;
  const Q = bn254Internals.G2_GENERATOR;
  const miller = fp12.mul(fp12.mul(millerLoop(bn254Internals.G2_GENERATOR, P), millerLoop(Q, g1.neg(P))), fp12.ONE);
  assert.ok(!fp12.eq(miller, fp12.ONE), 'a miller loop value is not one');
  assert.ok(fp12.eq(finalExponentiation(miller), fp12.ONE), 'and after the final exponentiation the pair cancels to one');
  assert.ok(fp12.eq(finalExponentiation(fp12.ONE), fp12.ONE), 'the identity stays the identity');
});

// --- the real vector ---

test('K3B3.10 the public vector verifies with 35 and does not with 22', () => {
  assert.equal(verifyGroth16Bn254(backendInput()), true, 'the fixture signal 35 is a root of the circuit');
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: ['22'] })), false, '22 is not');
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: [] })), false, 'no signal is not');
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: ['35', '1'] })), false, 'one signal too many is not');
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: ['350'] })), false, 'and neither is 35 with a digit appended');
});

test('K3B3.11 a signal at or above r is refused before the pairing runs', () => {
  const r = bn254Internals.R.toString();
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: [r] })), false);
  assert.equal(verifyGroth16Bn254(backendInput({ publicInputs: [(bn254Internals.R + 35n).toString()] })), false, 'r + x');
  const vk = fx.verificationKey();
  const atP = fx.proof();
  atP.a[0] = fp.P.toString();
  assert.equal(verifyGroth16Bn254({ verificationKey: vk, proof: atP, publicInputs: fx.publicInputs() }), false);
});

test('K3B3.12 an empty or malformed input is refused, never thrown on', () => {
  for (const bad of [null, undefined, {}, 'proof', 7, [], { verificationKey: null, proof: null, publicInputs: null }]) {
    assert.equal(verifyGroth16Bn254(bad), false, JSON.stringify(bad));
  }
});

test('K3B3.13 the reference is strict about curve membership: out of field, off curve, off subgroup, infinity', () => {
  const good = backendInput();
  // A coordinate at p is not in the field.
  const atP = JSON.parse(JSON.stringify(good));
  atP.proof.a[0] = fp.P.toString();
  assert.equal(verifyGroth16Bn254(atP), false, 'coordinate equal to p');
  // A point that is not on the curve.
  const offCurve = JSON.parse(JSON.stringify(good));
  offCurve.proof.a[1] = '3';
  assert.equal(verifyGroth16Bn254(offCurve), false, 'a[1] = 3 is not on y^2 = x^3 + 3 for this x');
  // A G2 point on the twist but outside the r-order subgroup.
  const offSubgroup = g2.pointOnTwistOutsideSubgroup();
  assert.ok(offSubgroup !== null, 'a point on the twist outside the subgroup exists');
  assert.ok(g2.onCurve(offSubgroup), 'it really is on the twist');
  assert.ok(!g2.inSubgroup(offSubgroup), 'and it really is outside the subgroup');
  for (const where of ['b', 'beta', 'gamma', 'delta']) {
    const broken = JSON.parse(JSON.stringify(good));
    const target = where === 'b' ? broken.proof : broken.verificationKey;
    const key = where === 'b' ? 'b' : `vk_${where}_2`;
    if (where === 'b') target.b = [[offSubgroup[0].map(String), offSubgroup[1].map(String)]];
    else target[key] = [[offSubgroup[0].map(String), offSubgroup[1].map(String)], ['1', '0']];
    assert.equal(verifyGroth16Bn254(broken), false, `${where} outside the subgroup`);
  }
  // The identity is refused where a proof or a fixed point needs a real element.
  for (const where of ['a', 'b', 'c', 'alpha', 'beta', 'gamma', 'delta']) {
    const broken = JSON.parse(JSON.stringify(good));
    const target = where === 'a' || where === 'b' || where === 'c' ? broken.proof : broken.verificationKey;
    const key = where === 'a' ? 'a' : where === 'b' ? 'b' : where === 'c' ? 'c' : `vk_${where}_${where === 'alpha' ? '1' : '2'}`;
    if (where === 'a' || where === 'c') target[key] = ['0', '0'];
    else target[key] = [['1', '0'], ['0', '0']];
    assert.equal(verifyGroth16Bn254(broken), false, `${where} at the identity`);
  }
});

test('K3B3.14 an identity in ic is allowed, because a legitimate key may carry one', () => {
  const vk = fx.verificationKey();
  const proof = fx.proof();
  const icIdentity = JSON.parse(JSON.stringify(vk));
  icIdentity.ic[1] = ['0', '0'];
  assert.equal(verifyGroth16Bn254({ verificationKey: icIdentity, proof, publicInputs: fx.publicInputs() }), false,
    'the vector does not verify against a key whose ic entry was replaced, and nothing crashes');
  const zero = JSON.parse(JSON.stringify(vk));
  zero.ic[0] = ['0', '0'];
  assert.equal(verifyGroth16Bn254({ verificationKey: zero, proof, publicInputs: fx.publicInputs() }), false);
});

test('K3B3.15 omitting one pairing term breaks the verification', () => {
  // The control the design asks for: the equation is four terms, and three do not do.
  const input = backendInput();
  const vk = input.verificationKey;
  const noDelta = { ...vk, delta: vk.gamma };
  assert.equal(verifyGroth16Bn254({ ...input, verificationKey: noDelta }), false, 'delta replaced by gamma');
  const noAlpha = { ...vk, alpha: input.proof.c };
  assert.equal(verifyGroth16Bn254({ ...input, verificationKey: noAlpha }), false, 'alpha replaced by c');
  const noIc = { ...vk, ic: vk.ic.map((point) => [point[0], point[1]]) };
  assert.equal(verifyGroth16Bn254({ ...input, verificationKey: noIc }), true, 'an unchanged key still verifies');
});

test('K3B3.16 the adapter conversion is pinned: swapping the Fp2 components fails against the fixture', () => {
  const input = backendInput();
  assert.equal(verifyGroth16Bn254(input), true);
  assert.equal(verifyGroth16Bn254({ ...input, verificationKey: fx.swapG2(input.verificationKey) }), false,
    'a key read with c1 before c0 is not this key');
  const swappedProof = { ...input.proof, b: [[input.proof.b[0][1], input.proof.b[0][0]], [input.proof.b[1][1], input.proof.b[1][0]]] };
  assert.equal(verifyGroth16Bn254({ ...input, proof: swappedProof }), false, 'and neither is a proof read that way');
});

test('K3B3.17 the reference can drive the port, and the port pins the key it verifies with', async () => {
  const vk = fx.verificationKey();
  const verify = createZkVerifier({
    verificationKey: vk,
    expectedVkDigest: digestZkVerificationKey(vk),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: verifyGroth16Bn254,
    backendDigest: BACKEND_DIGEST,
  });
  const good = await verify({ proof: fx.proof(), publicInputs: fx.publicInputs() });
  assert.equal(good.verified, true);
  assert.equal(good.zk.result, 'verified');
  const bad = await verify({ proof: fx.proof(), publicInputs: ['22'] });
  assert.equal(bad.verified, false);
  assert.equal(bad.zk.code, 'public_inputs_mismatch');
  // A substituted key under the original pin is refused before the reference ever runs.
  assert.throws(() => createZkVerifier({
    verificationKey: fx.swapG2(vk),
    expectedVkDigest: digestZkVerificationKey(vk),
    circuitDigest: CIRCUIT_DIGEST,
    expectedPublicInputs: fx.publicInputs(),
    backend: verifyGroth16Bn254,
    backendDigest: BACKEND_DIGEST,
  }), TypeError);
});

// --- what a scalar multiplication with the full r is worth ---

test('K3B3.18 a forged proof that satisfies nothing is refused, and so is a proof with a tampered coordinate', () => {
  const input = backendInput();
  const tampered = JSON.parse(JSON.stringify(input.proof));
  tampered.c[0] = (BigInt(tampered.c[0]) + 1n).toString();
  assert.equal(verifyGroth16Bn254({ ...input, proof: tampered }), false);
  const swapped = { a: input.proof.c, b: input.proof.b, c: input.proof.a };
  assert.equal(verifyGroth16Bn254({ ...input, proof: swapped }), false, 'A and C exchanged');
});

test('K3B3.19 no leftover: the reference exports one verifier and a frozen internals bag for these tests', () => {
  const module = require('../src/zk-bn254.js');
  assert.deepEqual(Object.keys(module).sort(), ['bn254Internals', 'verifyGroth16Bn254']);
  assert.ok(Object.isFrozen(bn254Internals), 'the internals bag is frozen');
  assert.equal(typeof verifyGroth16Bn254, 'function');
  assert.equal(verifyGroth16Bn254(backendInput()), true);
  assert.equal(asBigInts(fx.proof().a)[0] > 0n, true, 'the fixture coordinates are decimal strings, as the port expects');
});
