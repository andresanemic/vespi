// Kernel commit 1f558b8 (vespi kernel repo).
// Source: test/contributions-final-fix.test.js, with paths pointed at this copy and the kernel CHANGELOG test left out.
// Do not edit: change the source and re-copy.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const contributions = require('../contributions.js');

const {
  buildContribution, canonicalBytes, contributionDigest, surveyCommitment, buildIndexEntry, verifyChain,
} = contributions;

const HEX = 'a'.repeat(64);
const SALT = '01'.repeat(16);
const REQUEST = {
  version: 1, chain: null, kind: 'REQUEST', role: 'requester', actor: `G${'A'.repeat(55)}`,
  statement: 'Busco un aporte', comment: null, subject: null, prev: null, evidence: null,
  createdAt: '2026-11-16T16:00:00.000Z',
};
const REPORT = {
  ...REQUEST, kind: 'REPORT', role: 'organizer',
  evidence: { surveys: [], commitments: [], counts: { withAccount: 0, withoutAccount: 0, fallbackForm: 0 }, aggregate: {} },
};
const INDEX = {
  digest: HEX, network: 'stellar:testnet', txHash: 'b'.repeat(64), ledger: 1,
  envelopeXdr: 'YWJjZA==', rehearsal: false,
};
const sha256 = bytes => createHash('sha256').update(bytes, 'utf8').digest('hex');
const reportWith = aggregate => ({ ...REPORT, evidence: { ...REPORT.evidence, aggregate } });

// I1 — the published bytes are bound to the digest.

test('I1 parseContribution returns a frozen receipt whose digest is the sha256 of the bytes', () => {
  const { parseContribution } = contributions;
  assert.equal(typeof parseContribution, 'function');
  for (const fields of [REQUEST, { ...REQUEST, evidence: { uri: 'https://example.org/f', sha256: HEX } }, REPORT]) {
    const bytes = canonicalBytes(buildContribution(fields));
    const receipt = parseContribution(bytes);
    assert.ok(Object.isFrozen(receipt));
    assert.equal(canonicalBytes(receipt), bytes);
    assert.equal(contributionDigest(receipt), sha256(bytes));
  }
});

test('I1 parseContribution rejects non-canonical bytes: no version, other order, whitespace, escapes', () => {
  const { parseContribution } = contributions;
  const canonical = canonicalBytes(buildContribution(REQUEST));
  const { version, ...withoutVersion } = REQUEST;
  const reordered = JSON.stringify(REQUEST);
  assert.notEqual(reordered, canonical);
  for (const bytes of [
    JSON.stringify(Object.fromEntries(Object.keys(withoutVersion).sort().map(k => [k, withoutVersion[k]]))),
    reordered,
    JSON.stringify(JSON.parse(canonical), null, 2),
    ` ${canonical}`,
    `${canonical}\n`,
    canonical.replace('"version":1', '"version":1.0'),
    canonical.replace('Busco', '\\u0042usco'),
  ]) {
    assert.throws(() => parseContribution(bytes), /^Error: contribution:/);
  }
});

test('I1 parseContribution rejects non-string and non-JSON input with a contribution error', () => {
  const { parseContribution } = contributions;
  for (const bytes of [undefined, null, 1, {}, Buffer.from('{}'), '', '{', 'null', '[]', '"x"']) {
    assert.throws(() => parseContribution(bytes), /^Error: contribution:/);
  }
});

test('I1 a REQUEST without version and with unordered keys is not a valid publication of chainId', () => {
  const { parseContribution } = contributions;
  const { version, ...rest } = REQUEST;
  const published = JSON.stringify(rest);
  assert.throws(() => parseContribution(published), /^Error: contribution:/);
  const canonical = canonicalBytes(buildContribution(rest));
  assert.equal(verifyChain([parseContribution(canonical)]).chainId, sha256(canonical));
});

test('I1 canonicalBytes and contributionDigest reject a raw object with a digest key', () => {
  const raw = { ...REQUEST, digest: HEX };
  assert.throws(() => contributionDigest(raw), /^Error: contribution:/);
  assert.throws(() => canonicalBytes(raw), /^Error: contribution:/);
});

test('I1 canonicalBytes and contributionDigest reject invalid input instead of hashing it', () => {
  for (const raw of [{}, { ...REQUEST, kind: 'UNKNOWN' }, { ...REQUEST, anchor: {} }, null, []]) {
    assert.throws(() => contributionDigest(raw), /^Error: contribution:/);
    assert.throws(() => canonicalBytes(raw), /^Error: contribution:/);
  }
});

test('I1 canonicalBytes of raw fields without version includes version 1', () => {
  const { version, ...rest } = REQUEST;
  assert.match(canonicalBytes(rest), /"version":1}$/);
  assert.equal(contributionDigest(rest), contributionDigest(REQUEST));
});

// I2 — symbol keys and non-enumerable own properties of evidence are rejected.

test('I2 evidence with a symbol key is rejected, also nested and in survey answers', () => {
  const symbolic = { [Symbol('hidden')]: 1 };
  assert.throws(() => buildContribution(reportWith(symbolic)), /^Error: contribution:/);
  assert.throws(() => buildContribution({ ...REQUEST,
    evidence: { uri: 'https://example.org/f', sha256: HEX, [Symbol('x')]: 1 } }), /^Error: contribution:/);
  assert.throws(() => surveyCommitment(SALT, { a: symbolic }), /^Error: contribution:/);
  const arr = [1];
  arr[Symbol('x')] = 2;
  assert.throws(() => surveyCommitment(SALT, { a: arr }), /^Error: contribution:/);
});

test('I2 evidence with a non-enumerable own property is rejected', () => {
  const hidden = Object.defineProperty({}, 'x', { value: 1, enumerable: false });
  assert.throws(() => buildContribution(reportWith(hidden)), /^Error: contribution:/);
  assert.throws(() => surveyCommitment(SALT, hidden), /^Error: contribution:/);
  assert.throws(() => surveyCommitment(SALT, { nested: { deep: hidden } }), /^Error: contribution:/);
});

// I3 — the survey commitment and evidence bytes are binding.

test('I3 non-finite numbers are rejected in answers and evidence', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => surveyCommitment(SALT, { u: value }), /^Error: contribution:/);
    assert.throws(() => surveyCommitment(SALT, { u: [value] }), /^Error: contribution:/);
    assert.throws(() => buildContribution(reportWith({ n: value })), /^Error: contribution:/);
  }
});

test('I3 arrays with holes are rejected in answers and evidence', () => {
  // eslint-disable-next-line no-sparse-arrays
  const holed = [, 1];
  assert.throws(() => surveyCommitment(SALT, { u: holed }), /^Error: contribution:/);
  assert.throws(() => surveyCommitment(SALT, { u: new Array(2) }), /^Error: contribution:/);
  assert.throws(() => buildContribution({ ...REPORT,
    evidence: { ...REPORT.evidence, surveys: new Array(1) } }), /^Error: contribution:/);
  assert.notEqual(surveyCommitment(SALT, { u: [null, 1] }), undefined);
});

test('I3 arrays with extra non-index keys are rejected', () => {
  const extra = [1];
  extra.note = 'not in the bytes';
  assert.throws(() => surveyCommitment(SALT, { u: extra }), /^Error: contribution:/);
});

test('I3 objects whose prototype is not Object.prototype, null or Array.prototype are rejected', () => {
  class Answer { constructor() { this.a = 1; } }
  class List extends Array {}
  for (const value of [new Date(), new Map(), new Set(), new Answer(), /x/, new Uint8Array(1),
    List.from([1]), Object.setPrototypeOf({}, Array.prototype), new String('x'), new Number(1)]) {
    assert.throws(() => surveyCommitment(SALT, { d: value }), /^Error: contribution:/);
    assert.throws(() => buildContribution(reportWith({ d: value })), /^Error: contribution:/);
  }
  assert.throws(() => surveyCommitment(SALT, new Date()), /^Error: contribution:/);
  assert.match(surveyCommitment(SALT, { a: Object.create(null), b: {}, c: [] }), /^[0-9a-f]{64}$/);
});

test('I3 the listed collisions no longer produce a commitment', () => {
  // eslint-disable-next-line no-sparse-arrays
  for (const answer of [{ u: NaN }, { u: [, 1] }, { d: new Date() }]) {
    assert.throws(() => surveyCommitment(SALT, answer), /^Error: contribution:/);
  }
});

// Minor b — invisible and bidirectional format characters.

const INVISIBLE = [
  0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF,
];

test('b statement and comment reject invisible and bidi format characters', () => {
  for (const code of INVISIBLE) {
    const ch = String.fromCharCode(code);
    assert.throws(() => buildContribution({ ...REQUEST, statement: `Busco${ch}aporte` }), /^Error: contribution:/,
      `statement U+${code.toString(16)}`);
    assert.throws(() => buildContribution({ ...REQUEST, comment: `${ch}` }), /^Error: contribution:/,
      `comment U+${code.toString(16)}`);
  }
});

test('b neighbouring characters stay accepted', () => {
  for (const code of [0x200A, 0x2010, 0x2029, 0x202F, 0x2065, 0x206A, 0xFEFE, 0xFF00]) {
    const ch = String.fromCharCode(code);
    assert.doesNotThrow(() => buildContribution({ ...REQUEST, statement: `a${ch}b`, comment: `c${ch}d` }),
      `U+${code.toString(16)}`);
  }
});

// Minor c — buildIndexEntry applies the strict field rule.

test('c buildIndexEntry rejects extra own keys', () => {
  for (const key of ['extra', 'digestHex', '__proto__']) {
    const input = JSON.parse(JSON.stringify(INDEX).replace(/}$/, `,"${key}":1}`));
    assert.throws(() => buildIndexEntry(input), /^Error: contribution:/, key);
  }
  assert.throws(() => buildIndexEntry({ ...INDEX, [Symbol('x')]: 1 }), /^Error: contribution:/);
});

test('c buildIndexEntry accepts version 1 only and round-trips its own output', () => {
  const entry = buildIndexEntry(INDEX);
  assert.deepEqual({ ...buildIndexEntry(entry) }, { ...entry });
  for (const version of [0, 2, '1', null]) {
    assert.throws(() => buildIndexEntry({ ...INDEX, version }), /^Error: contribution:/);
  }
});

test('c buildIndexEntry does not read accessors or inherited fields', () => {
  let reads = 0;
  const input = { ...INDEX };
  delete input.ledger;
  Object.defineProperty(input, 'ledger', { enumerable: true, get() { reads += 1; return 1; } });
  assert.throws(() => buildIndexEntry(input), /^Error: contribution:/);
  assert.throws(() => buildIndexEntry(Object.create(INDEX)), /^Error: contribution:/);
  let traps = 0;
  const proxy = new Proxy({ ...INDEX }, {
    get(t, k) { traps += 1; return t[k]; }, ownKeys(t) { traps += 1; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { traps += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  assert.throws(() => buildIndexEntry(proxy), /^Error: contribution:/);
  assert.equal(reads, 0);
  assert.equal(traps, 0);
});

test('c buildContribution does not read top-level accessors or proxies either', () => {
  let reads = 0;
  const input = { ...REQUEST };
  delete input.statement;
  Object.defineProperty(input, 'statement', { enumerable: true, get() { reads += 1; return 'x'; } });
  assert.throws(() => buildContribution(input), /^Error: contribution:/);
  let traps = 0;
  const proxy = new Proxy({ ...REQUEST }, {
    get(t, k) { traps += 1; return t[k]; }, ownKeys(t) { traps += 1; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { traps += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  assert.throws(() => buildContribution(proxy), /^Error: contribution:/);
  assert.equal(reads, 0);
  assert.equal(traps, 0);
});

// I4, minor a and the document.

const doc = () => readFileSync(require.resolve('../CONTRIBUTIONS_RECEIPT_V1.md'), 'utf8');

test('I4 the schema does not claim a verifier component that does not exist', () => {
  assert.doesNotMatch(doc(), /another component verifies/);
  assert.match(doc(), /This module does not check this; the planned verifier will\./);
});

test('doc describes parseContribution, the evidence rules and the strict index entry', () => {
  const text = doc();
  assert.match(text, /parseContribution/);
  assert.doesNotMatch(text, /`Date`, `Map`, and class instances are copied/);
  for (const word of [/symbol keys/i, /non-enumerable/i, /holes/i, /non-finite/i, /U\+200B/, /U\+FEFF/,
    /buildIndexEntry[\s\S]*unexpected/]) assert.match(text, word);
});
