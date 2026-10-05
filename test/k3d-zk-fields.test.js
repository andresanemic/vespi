'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const v = require('./fixtures/zk/independent-vectors.json');
const manifest = require('./fixtures/zk/independent-manifest.json');
const { bn254Internals: m } = require('../src/zk-bn254-reference.js');
const big = (x) => x === null ? null : Array.isArray(x) ? x.map(big)
  : typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, big(y)])) : BigInt(x);

test('K3d fixture bytes match the independent oracle manifest', () => {
  assert.equal(createHash('sha256').update(readFileSync(`${__dirname}/fixtures/zk/independent-vectors.json`)).digest('hex'), manifest.vectors_sha256);
  assert.equal(m.P, BigInt(v.constants.p));
  assert.equal(m.R, BigInt(v.constants.r));
  assert.deepEqual(m.g2.b, big(v.constants.b2));
});

test('K3d tower relations and independent minimal field calculations', () => {
  const { fp, fp2, fp6, fp12 } = m;
  assert.equal(fp.add(m.P - 1n, 2n), 1n);
  assert.equal(fp.mul(7n, 9n), 63n);
  assert.deepEqual(fp2.mul([3n, 4n], [5n, 6n]), [m.P - 9n, 38n]);
  assert.deepEqual(fp2.mul([0n, 1n], [0n, 1n]), [m.P - 1n, 0n]);
  const V = [fp2.ZERO, fp2.ONE, fp2.ZERO];
  assert.deepEqual(fp6.pow(V, 3n), [[9n, 1n], fp2.ZERO, fp2.ZERO]);
  const W = [fp6.ZERO, fp6.ONE];
  assert.deepEqual(fp12.mul(W, W), [V, fp6.ZERO]);
  for (const [f, a] of [[fp, 37n], [fp2, [3n, 7n]],
    [fp6, [[1n, 2n], [3n, 4n], [5n, 6n]]],
    [fp12, [[[1n, 2n], [3n, 4n], [5n, 6n]], [[7n, 8n], [9n, 10n], [11n, 12n]]]]]) {
    assert.ok(f.eq(f.mul(a, f.inv(a)), f.ONE));
    assert.ok(f.eq(f.square(a), f.mul(a, a)));
    assert.throws(() => f.inv(f.ZERO), /zero/);
  }
});

for (const name of ['g1', 'g2']) {
  for (const x of v.arithmetic[name]) test(`K3d oracle ${x.id}`, () => {
    const g = m[name];
    const p = big(x.p);
    const q = big(x.q ?? null);
    const result = x.operation === 'double' ? g.double(p)
      : x.operation === 'multiply' ? g.mul(p, BigInt(x.scalar))
        : x.operation === 'negate' ? g.neg(p) : g.add(p, q);
    assert.deepEqual(result, big(x.expected));
  });
  for (const x of v.invalid[name]) test(`K3d rejects ${x.id}`, () => {
    assert.equal(m[name].validate(x.point), false);
    if (x.class === 'outside_subgroup') {
      assert.equal(m[name].onCurve(big(x.point)), true);
      assert.deepEqual(m[name].mul(big(x.point), m.R), big(x.r_times_point));
    }
  });
}

test('K3d subgroup checks and infinity policy', () => {
  for (const name of ['g1', 'g2']) {
    const g = m[name], p = big(v.constants[name]);
    assert.equal(g.mul(p, m.R), null);
    assert.equal(g.validate(v.constants[name]), true);
    assert.equal(g.validate(null), true);
    assert.equal(g.validate(null, false), false);
    assert.throws(() => g.mul(p, -1n), /scalar/);
  }
});
