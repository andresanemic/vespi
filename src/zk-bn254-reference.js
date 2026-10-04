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

// --- the pairing ---------------------------------------------------------------------------
// Written from the public equations of the optimal ate pairing on BN curves. The two ingredients
// that a hand written pairing usually gets wrong are the untwisting and the final exponentiation,
// so neither is left implicit:
//
//  * The sextic twist is handled by embedding G2 into the twist curve over Fp12 itself, with
//    (x, y) -> (w^2 * x, w^3 * y). That image satisfies Y^2 = X^3 + 3 exactly, because w^6 = XI and
//    the twist curve parameter is b/XI, so the untwisted parameter is XI * b/XI = b. No scaling
//    factor is carried in the Miller loop and none can be misplaced.
//  * The final exponentiation is (p^12 - 1)/r applied to the whole Miller value. The Miller loop
//    alone is exposed separately and is not a pairing.

// Frobenius on the tower. p = 3 mod 4 so i^p = -i; v^3 = XI and 3 | p-1 so v^p = v*XI^((p-1)/3);
// w^6 = XI and 6 | p-1 so w^p = w*XI^((p-1)/6). The suite checks pi^12 = identity, which is what
// makes these three constants the Frobenius and not a plausible looking guess.
const FROB_FP6_1 = fp2.pow(XI, (P - 1n) / 3n);
const FROB_FP6_2 = fp2.mul(FROB_FP6_1, FROB_FP6_1);
const FROB_FP12_W = fp2.pow(XI, (P - 1n) / 6n);
const FROB_FP12_W6 = [FROB_FP12_W, fp2.ZERO, fp2.ZERO];
const conjugateFp2 = (a) => [a[0], fp.neg(a[1])];

function frobeniusFp6(value) {
  return [
    conjugateFp2(value[0]),
    fp2.mul(conjugateFp2(value[1]), FROB_FP6_1),
    fp2.mul(conjugateFp2(value[2]), FROB_FP6_2),
  ];
}
function frobenius(element) {
  return [frobeniusFp6(element[0]), fp6.mul(frobeniusFp6(element[1]), FROB_FP12_W6)];
}

// An Fp2 element enters the tower as the constant Fp6 coefficient, unchanged: the tower already
// uses i, and i is w^6 - 9, which is the embedding the polynomial basis documents.
const embedFp2 = (a) => [[[fp.add(a[0], 0n), fp.add(a[1], 0n)], fp2.ZERO, fp2.ZERO], fp6.ZERO];

// A G2 point in Fp2 becomes a point of the twist curve over Fp12. Null stays null.
const untwistG2 = (q) => (q === null ? null : {
  x: [[fp2.ZERO, q.x, fp2.ZERO], fp6.ZERO],
  y: [fp6.ZERO, [fp2.ZERO, q.y, fp2.ZERO]],
});

// Affine arithmetic on Y^2 = X^3 + 3 over Fp12, used only inside the Miller loop.
const twistCurve = (() => {
  const self = {
    b: embedFp2([3n, 0n]),
    neg: (a) => ({ x: a.x, y: fp12.neg(a.y) }),
    add(a, c) {
      if (a === null || c === null) return a === null ? c : a;
      let slope;
      if (fp12.eq(a.x, c.x)) {
        if (!fp12.eq(a.y, c.y) || fp12.eq(a.y, fp12.ZERO)) return null;
        const xx = fp12.square(a.x);
        slope = fp12.div(fp12.add(xx, fp12.add(xx, xx)), fp12.add(a.y, a.y));
      } else {
        slope = fp12.div(fp12.sub(c.y, a.y), fp12.sub(c.x, a.x));
      }
      const x = fp12.sub(fp12.sub(fp12.square(slope), a.x), c.x);
      return { x, y: fp12.sub(fp12.mul(slope, fp12.sub(a.x, x)), a.y) };
    },
    double: (a) => self.add(a, a),
    onCurve: (a) => fp12.eq(fp12.mul(a.y, a.y), fp12.add(fp12.mul(fp12.square(a.x), a.x), self.b)),
  };
  return Object.freeze(self);
})();

// The line through two points of the twist curve, evaluated at the G1 point. All three
// coordinates live in Fp12, so the slope is a real Fp12 division and there is no sparse factor to
// lose. A vertical line is the difference of the x coordinates alone.
function lineAt(p1, p2, target) {
  let slope;
  if (!fp12.eq(p1.x, p2.x)) {
    slope = fp12.div(fp12.sub(p2.y, p1.y), fp12.sub(p2.x, p1.x));
  } else if (fp12.eq(p1.y, p2.y)) {
    const xx = fp12.square(p1.x);
    slope = fp12.div(fp12.add(xx, fp12.add(xx, xx)), fp12.add(p1.y, p1.y));
  } else {
    return fp12.sub(target.x, p1.x);
  }
  return fp12.sub(fp12.mul(slope, fp12.sub(target.x, p1.x)), fp12.sub(target.y, p1.y));
}

// Non-adjacent form of the ate loop count 6u+2, least significant digit first. Any addition chain
// for this exponent gives the same value after the final exponentiation, because two chains differ
// only by vertical line factors, which lie in Fp2 and die under (p^12-1)/r.
//
// The chain starts at the second most significant digit, not the most significant one: R already
// holds 1*Q, so the leading 1 is implicit. Starting one digit higher would square f and double R
// once before any digit, which is a different Miller value and not a pairing.
function nafDigits(exponent) {
  const digits = [];
  let rest = exponent;
  while (rest > 0n) {
    if (rest & 1n) {
      const digit = rest % 4n === 1n ? 1n : -1n;
      digits.push(digit);
      rest -= digit;
    } else {
      digits.push(0n);
    }
    rest >>= 1n;
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0n) digits.pop();
  return digits;
}
const BN_U = 4965661367192848881n;
const ATE_LOOP_COUNT = 6n * BN_U + 2n;
const ATE_DIGITS = nafDigits(ATE_LOOP_COUNT);
const FINAL_EXPONENT = (P ** 12n - 1n) / R;

const frobeniusPoint = (a) => ({ x: frobenius(a.x), y: frobenius(a.y) });

// The Miller value f_{6u+2,Q}(P) over Fp12. This is not a pairing: it is missing the final
// exponentiation, and the suite says so out loud.
function millerLoop(q, p) {
  if (q === null || p === null) return fp12.ONE;
  const point = { x: embedFp2([p.x, 0n]), y: embedFp2([p.y, 0n]) };
  const Q = untwistG2(q);
  const nQ = twistCurve.neg(Q);
  let running = Q;
  let f = fp12.ONE;
  for (let i = ATE_DIGITS.length - 2; i >= 0; i -= 1) {
    f = fp12.mul(fp12.square(f), lineAt(running, running, point));
    running = twistCurve.double(running);
    const digit = ATE_DIGITS[i];
    if (digit === 1n) {
      f = fp12.mul(f, lineAt(running, Q, point));
      running = twistCurve.add(running, Q);
    } else if (digit === -1n) {
      f = fp12.mul(f, lineAt(running, nQ, point));
      running = twistCurve.add(running, nQ);
    }
  }
  // The last two steps of 6u+2 need the Frobenius images of Q, which is where they come from.
  const q1 = frobeniusPoint(Q);
  const nQ2 = twistCurve.neg(frobeniusPoint(q1));
  f = fp12.mul(f, lineAt(running, q1, point));
  running = twistCurve.add(running, q1);
  f = fp12.mul(f, lineAt(running, nQ2, point));
  return f;
}

function finalExponentiate(element) {
  return fp12.pow(element, FINAL_EXPONENT);
}

// e(P, Q) with P in G1 and Q in G2, as an Fp12 element of the tower.
function pairing(p, q) {
  return finalExponentiate(millerLoop(q, p));
}

// The product of pairings, with one single final exponentiation over the product of the Miller
// values. Equal to multiplying the pairings separately, and much cheaper.
function pairingProduct(terms) {
  let f = fp12.ONE;
  for (const term of terms) f = fp12.mul(f, millerLoop(term.q, term.p));
  return finalExponentiate(f);
}

// --- basis conversion, exact and reversible -------------------------------------------------
// The oracle reports Fp12 as sum(cj * w^j) with w^12 - 18*w^6 + 82 = 0 and i = w^6 - 9. That is the
// same field as this tower (w^2 = v, v^3 = XI gives w^6 = XI = 9 + i, hence the same polynomial),
// written in a different basis. For A = a0 + a1*v + a2*v^2 and B = b0 + b1*v + b2*v^2 over Fp2, with
// w^2 = v and i = w^6 - 9:
//   c0 = a0.real - 9*a0.imag      c6 = a0.imag
//   c1 = b0.real - 9*b0.imag      c7 = b0.imag
//   c2 = a1.real - 9*a1.imag      c8 = a1.imag
//   c3 = b1.real - 9*b1.imag      c9 = b1.imag
//   c4 = a2.real - 9*a2.imag      c10 = a2.imag
//   c5 = b2.real - 9*b2.imag      c11 = b2.imag
function toOracleBasis(element) {
  const out = new Array(12).fill(0n);
  const write = (index, value) => { out[index] = mod(value); };
  for (let j = 0; j < 3; j += 1) {
    write(2 * j, fp.sub(element[0][j][0], fp.mul(9n, element[0][j][1])));
    write(2 * j + 6, element[0][j][1]);
    write(2 * j + 1, fp.sub(element[1][j][0], fp.mul(9n, element[1][j][1])));
    write(2 * j + 7, element[1][j][1]);
  }
  return out;
}

function fromOracleBasis(coefficients) {
  if (!Array.isArray(coefficients) || coefficients.length !== 12) throw new TypeError('fp12 needs 12 coefficients');
  const read = (index) => {
    const value = coefficients[index];
    if (typeof value !== 'bigint') throw new TypeError('fp12 coefficient must be a bigint');
    return mod(value);
  };
  const slot = (even, odd) => [fp.add(read(even), fp.mul(9n, read(odd))), read(odd)];
  // The A half takes the even coefficients and the B half the odd ones.
  const half = (base) => [slot(base, base + 6), slot(base + 2, base + 8), slot(base + 4, base + 10)];
  return [half(0), half(1)];
}

const bn254Internals = Object.freeze({ P, R, fp, fp2, fp6, fp12, g1, g2 });
module.exports = {
  bn254Internals,
  constants: Object.freeze({ P, R, XI, BN_U, ATE_LOOP_COUNT, FINAL_EXPONENT }),
  fields: Object.freeze({ fp, fp2, fp6, fp12 }),
  groups: Object.freeze({ g1, g2 }),
  embedFp2,
  frobenius,
  untwistG2,
  millerLoop,
  finalExponentiate,
  pairing,
  pairingProduct,
  toOracleBasis,
  fromOracleBasis,
};
