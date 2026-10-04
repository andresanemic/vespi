'use strict';
// SPDX-License-Identifier: Apache-2.0
// Experimental BN254 reference, derived from field and affine curve equations.
// This is not audited, not production-ready, not constant-time, and has no CPU budget.
// A valid proof does not authenticate a presenter, attest an institution or prevent replay.

const { FP_MODULUS: P, SCALAR_MODULUS: R } = require('./zk.js');

function mod(a) { const b = a % P; return b < 0n ? b + P : b; }
function power(field, a, n) {
  if (typeof n !== 'bigint' || n < 0n) throw new TypeError('invalid exponent');
  let out = field.ONE;
  while (n > 0n) {
    if (n & 1n) out = field.mul(out, a);
    n >>= 1n;
    if (n) a = field.square(a);
  }
  return out;
}
function complete(field) {
  field.square = (a) => field.mul(a, a);
  field.pow = (a, n) => power(field, a, n);
  field.div = (a, b) => field.mul(a, field.inv(b));
  return Object.freeze(field);
}
const fp = complete({
  ZERO: 0n, ONE: 1n,
  add: (a, b) => mod(a + b), sub: (a, b) => mod(a - b),
  neg: (a) => mod(-a), mul: (a, b) => mod(a * b), eq: (a, b) => a === b,
  inv(a) {
    a = mod(a);
    if (a === 0n) throw new RangeError('inverse of zero');
    // Extended Euclid over integers, not a scalar reduction.
    let old = P, current = a, x = 0n, y = 1n;
    while (current !== 0n) {
      const q = old / current;
      [old, current] = [current, old - q * current];
      [x, y] = [y, x - q * y];
    }
    return mod(x);
  },
});
const fp2 = complete({
  ZERO: Object.freeze([0n, 0n]), ONE: Object.freeze([1n, 0n]),
  add: (a, b) => [fp.add(a[0], b[0]), fp.add(a[1], b[1])],
  sub: (a, b) => [fp.sub(a[0], b[0]), fp.sub(a[1], b[1])],
  neg: (a) => [fp.neg(a[0]), fp.neg(a[1])],
  eq: (a, b) => a[0] === b[0] && a[1] === b[1],
  mul: (a, b) => [mod(a[0] * b[0] - a[1] * b[1]), mod(a[0] * b[1] + a[1] * b[0])],
  inv(a) {
    const d = fp.inv(mod(a[0] * a[0] + a[1] * a[1]));
    return [mod(a[0] * d), mod(-a[1] * d)];
  },
});
const XI = Object.freeze([9n, 1n]);
const fp6 = complete({
  ZERO: Object.freeze([fp2.ZERO, fp2.ZERO, fp2.ZERO]),
  ONE: Object.freeze([fp2.ONE, fp2.ZERO, fp2.ZERO]),
  add: (a, b) => a.map((x, i) => fp2.add(x, b[i])),
  sub: (a, b) => a.map((x, i) => fp2.sub(x, b[i])),
  neg: (a) => a.map(fp2.neg),
  eq: (a, b) => a.every((x, i) => fp2.eq(x, b[i])),
  mul(a, b) {
    // Convolution reduced by v^3 = 9+i.
    const c = Array.from({ length: 5 }, () => fp2.ZERO);
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
      c[i + j] = fp2.add(c[i + j], fp2.mul(a[i], b[j]));
    }
    c[0] = fp2.add(c[0], fp2.mul(c[3], XI));
    c[1] = fp2.add(c[1], fp2.mul(c[4], XI));
    return c.slice(0, 3);
  },
  inv(a) {
    // Adjugate of multiplication by a in Fp2[v]/(v^3-XI).
    const t0 = fp2.sub(fp2.square(a[0]), fp2.mul(XI, fp2.mul(a[1], a[2])));
    const t1 = fp2.sub(fp2.mul(XI, fp2.square(a[2])), fp2.mul(a[0], a[1]));
    const t2 = fp2.sub(fp2.square(a[1]), fp2.mul(a[0], a[2]));
    const d = fp2.inv(fp2.add(fp2.mul(a[0], t0),
      fp2.mul(XI, fp2.add(fp2.mul(a[2], t1), fp2.mul(a[1], t2)))));
    return [t0, t1, t2].map((x) => fp2.mul(x, d));
  },
});
const timesV = (a) => [fp2.mul(a[2], XI), a[0], a[1]];
const fp12 = complete({
  ZERO: Object.freeze([fp6.ZERO, fp6.ZERO]), ONE: Object.freeze([fp6.ONE, fp6.ZERO]),
  add: (a, b) => [fp6.add(a[0], b[0]), fp6.add(a[1], b[1])],
  sub: (a, b) => [fp6.sub(a[0], b[0]), fp6.sub(a[1], b[1])],
  neg: (a) => [fp6.neg(a[0]), fp6.neg(a[1])],
  eq: (a, b) => fp6.eq(a[0], b[0]) && fp6.eq(a[1], b[1]),
  mul(a, b) {
    // (a0+a1*w)(b0+b1*w), w^2=v.
    const ac = fp6.mul(a[0], b[0]), bd = fp6.mul(a[1], b[1]);
    const cross = fp6.sub(fp6.sub(fp6.mul(fp6.add(a[0], a[1]), fp6.add(b[0], b[1])), ac), bd);
    return [fp6.add(ac, timesV(bd)), cross];
  },
  inv(a) {
    const d = fp6.inv(fp6.sub(fp6.square(a[0]), timesV(fp6.square(a[1]))));
    return [fp6.mul(a[0], d), fp6.neg(fp6.mul(a[1], d))];
  },
});

// Arithmetic takes canonical BigInt coordinates; external validation reads decimals first.
function curve(field, b, readPoint) {
  const g = {
    b,
    neg: (a) => a === null ? null : { x: a.x, y: field.neg(a.y) },
    add(a, c) {
      if (a === null) return c;
      if (c === null) return a;
      let slope;
      if (field.eq(a.x, c.x)) {
        if (!field.eq(a.y, c.y) || field.eq(a.y, field.ZERO)) return null;
        slope = field.div(field.add(field.square(a.x), field.add(field.square(a.x), field.square(a.x))),
          field.add(a.y, a.y));
      } else slope = field.div(field.sub(c.y, a.y), field.sub(c.x, a.x));
      const x = field.sub(field.sub(field.square(slope), a.x), c.x);
      return { x, y: field.sub(field.mul(slope, field.sub(a.x, x)), a.y) };
    },
    double: (a) => g.add(a, a),
    mul(a, n) {
      if (typeof n !== 'bigint' || n < 0n) throw new TypeError('invalid scalar');
      let out = null;
      // The complete integer is consumed, including r in subgroup validation.
      while (n > 0n) {
        if (n & 1n) out = g.add(out, a);
        n >>= 1n;
        if (n) a = g.double(a);
      }
      return out;
    },
    onCurve: (a) => a === null || field.eq(field.square(a.y), field.add(field.mul(field.square(a.x), a.x), b)),
    validate(raw, allowInfinity = true) {
      try {
        if (raw === null) return allowInfinity;
        const a = readPoint(raw);
        return g.onCurve(a) && g.mul(a, R) === null;
      } catch { return false; }
    },
  };
  return Object.freeze(g);
}

function dataObject(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('object');
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('prototype');
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some((k) => !keys.includes(k))) throw new TypeError('keys');
  const out = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, k);
    if (!d || !('value' in d)) throw new TypeError('accessor');
    out[k] = d.value;
  }
  return out;
}
function dataArray(raw, length) {
  if (!Array.isArray(raw) || raw.length !== length) throw new TypeError('array');
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== length + 1) throw new TypeError('array keys');
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !('value' in d)) throw new TypeError('array accessor');
    out.push(d.value);
  }
  return out;
}
function decimal(raw, modulus) {
  if (typeof raw !== 'string' || raw.length > 78 || !/^(0|[1-9][0-9]*)$/.test(raw)) throw new TypeError('decimal');
  const n = BigInt(raw);
  if (n >= modulus) throw new RangeError('range');
  return n;
}
function readG1(raw) {
  const a = dataObject(raw, ['x', 'y']);
  return { x: decimal(a.x, P), y: decimal(a.y, P) };
}
function readG2(raw) {
  const a = dataObject(raw, ['x', 'y']);
  return { x: dataArray(a.x, 2).map((n) => decimal(n, P)),
    y: dataArray(a.y, 2).map((n) => decimal(n, P)) };
}
const g1 = curve(fp, 3n, readG1);
const g2 = curve(fp2, fp2.div([3n, 0n], XI), readG2);

const bn254Internals = Object.freeze({ P, R, fp, fp2, fp6, fp12, g1, g2 });
module.exports = { bn254Internals };
