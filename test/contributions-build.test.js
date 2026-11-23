'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { computeDigest } = require('../src/receipt.js');
const {
  CONTRIBUTION_VERSION, KINDS, ROLE_BY_KIND, buildContribution, canonicalBytes, contributionDigest,
} = require('../src/contributions.js');

const HEX = 'a'.repeat(64);
const REQUEST = {
  version: 1, chain: null, kind: 'REQUEST', role: 'requester', actor: `G${'A'.repeat(55)}`,
  statement: 'Busco un aporte', comment: null, subject: null, prev: null, evidence: null,
  createdAt: '2026-11-16T16:00:00.000Z',
};
const VARIANTS = [
  ['REQUEST', 'requester', null, null, null, null],
  ['CONTRIBUTE', 'contributor', HEX, HEX, null, null],
  ['ACCEPT', 'requester', HEX, HEX, HEX, null],
  ['ATTEST', 'observer', HEX, null, HEX, null],
  ['SURVEY', 'respondent', null, null, null, { commitment: HEX }],
  ['REPORT', 'organizer', null, null, null, {
    surveys: [], commitments: [], counts: { withAccount: 0, withoutAccount: 0, fallbackForm: 0 }, aggregate: {},
  }],
];

function fieldsFor([kind, role, chain, prev, subject, evidence]) {
  return { ...REQUEST, kind, role, chain, prev, subject, evidence };
}

test('builds a valid REQUEST with exactly the eleven fields', () => {
  const receipt = buildContribution(REQUEST);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'version', 'chain', 'kind', 'role', 'actor', 'statement', 'comment', 'subject', 'prev', 'evidence', 'createdAt',
  ].sort());
  assert.deepEqual({ ...receipt }, REQUEST);
  assert.ok(Object.isFrozen(receipt));
  assert.equal(Object.getPrototypeOf(receipt), null);
  assert.equal(CONTRIBUTION_VERSION, 1);
  assert.deepEqual(KINDS, ['REQUEST', 'CONTRIBUTE', 'ACCEPT', 'ATTEST', 'SURVEY', 'REPORT']);
  assert.ok(Object.isFrozen(KINDS));
  assert.ok(Object.isFrozen(ROLE_BY_KIND));
});

for (const variant of VARIANTS) {
  const valid = fieldsFor(variant);
  test(`builds a valid ${valid.kind} with its role and links`, () => {
    assert.deepEqual(JSON.parse(canonicalBytes(buildContribution(valid))), valid);
    assert.equal(ROLE_BY_KIND[valid.kind], valid.role);
  });
  for (const field of ['chain', 'prev', 'subject']) {
    test(`rejects invalid ${valid.kind} ${field}`, () => {
      assert.throws(() => buildContribution({ ...valid, [field]: valid[field] === null ? HEX : null }),
        /^Error: contribution:/);
      if (valid[field] !== null) {
        for (const value of ['g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${HEX}\n`, 42]) {
          assert.throws(() => buildContribution({ ...valid, [field]: value }), /^Error: contribution:/);
        }
      }
    });
  }
}

test('contributionDigest equals computeDigest and the sha256 of canonicalBytes', () => {
  const receipt = buildContribution({ ...fieldsFor(VARIANTS[3]),
    statement: 'Observé la charla de Yerko el 19 de noviembre en Tellus' });
  const bytes = canonicalBytes(receipt);
  assert.equal(bytes, JSON.stringify({
    actor: REQUEST.actor, chain: HEX, comment: null, createdAt: REQUEST.createdAt, evidence: null,
    kind: 'ATTEST', prev: null, role: 'observer', statement: receipt.statement, subject: HEX, version: 1,
  }));
  assert.match(contributionDigest(receipt), /^[0-9a-f]{64}$/);
  assert.equal(contributionDigest(receipt), computeDigest(receipt));
  assert.equal(contributionDigest(receipt), createHash('sha256').update(bytes, 'utf8').digest('hex'));
});

test('sets version to 1 when omitted', () => {
  const { version, ...fields } = REQUEST;
  assert.equal(buildContribution(fields).version, 1);
});

test('C1 evidence stays unchanged after caller and receipt mutation attempts', () => {
  const evidence = { uri: 'https://example.org/photo', sha256: HEX };
  const receipt = buildContribution({ ...REQUEST, evidence });
  const bytes = canonicalBytes(receipt);
  const digest = contributionDigest(receipt);
  evidence.uri = 'http://example.org/changed';
  evidence.extra = 1;
  assert.equal(canonicalBytes(receipt), bytes);
  assert.equal(contributionDigest(receipt), digest);
  assert.equal(Object.getPrototypeOf(receipt.evidence), null);
  assert.ok(Object.isFrozen(receipt.evidence));
  assert.throws(() => { receipt.evidence.uri = 'http://example.org'; }, TypeError);
  assert.throws(() => { receipt.evidence.extra = 1; }, TypeError);
  assert.ok(!Object.isFrozen(evidence));
});

test('C1 REPORT evidence is copied and frozen through nested objects and arrays', () => {
  const evidence = { surveys: [HEX], commitments: [HEX],
    counts: { withAccount: 1, withoutAccount: 0, fallbackForm: 0 }, aggregate: { total: 1 } };
  const receipt = buildContribution({ ...fieldsFor(VARIANTS[5]), evidence });
  const bytes = canonicalBytes(receipt);
  const digest = contributionDigest(receipt);
  evidence.surveys[0] = 'b'.repeat(64);
  evidence.surveys.push(HEX);
  evidence.counts.withAccount = 2;
  evidence.aggregate.total = 2;
  assert.equal(canonicalBytes(receipt), bytes);
  assert.equal(contributionDigest(receipt), digest);
  for (const value of [receipt.evidence, receipt.evidence.surveys,
    receipt.evidence.commitments, receipt.evidence.aggregate, receipt.evidence.counts]) assert.ok(Object.isFrozen(value));
  assert.equal(Object.getPrototypeOf(receipt.evidence.aggregate), null);
  assert.throws(() => { receipt.evidence.counts.withAccount = 3; }, TypeError);
  assert.throws(() => { receipt.evidence.surveys.push({}); }, TypeError);
});

test('C1 rejects evidence accessors without invoking them, including nested ones', () => {
  let reads = 0;
  const reference = { sha256: HEX };
  Object.defineProperty(reference, 'uri', {
    enumerable: true, get() { reads += 1; return 'https://example.org/photo'; },
  });
  const nested = {};
  Object.defineProperty(nested, 'value', { get() { reads += 1; return 1; } });
  assert.throws(() => buildContribution({ ...REQUEST, evidence: reference }), /contribution:/);
  assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[5]), evidence: { nested } }), /contribution:/);
  assert.equal(reads, 0);
});

test('C1 rejects evidence proxies without running traps, including nested ones', () => {
  let traps = 0;
  const proxy = new Proxy({ uri: 'https://example.org/photo', sha256: HEX }, {
    get(target, key) { traps += 1; return target[key]; },
    ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
  });
  assert.throws(() => buildContribution({ ...REQUEST, evidence: proxy }), /contribution:/);
  assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[5]), evidence: { nested: [proxy] } }), /contribution:/);
  assert.equal(traps, 0);
});

test('C1 copies only own data and preserves an own __proto__ as inert data', () => {
  const evidence = { ...VARIANTS[5][5] };
  evidence.aggregate = Object.create(null);
  Object.defineProperty(evidence.aggregate, '__proto__', { value: 'inert', enumerable: true });
  const receipt = buildContribution({ ...fieldsFor(VARIANTS[5]), evidence });
  assert.equal(Object.getPrototypeOf(receipt.evidence), null);
  assert.equal(Object.getPrototypeOf(receipt.evidence.aggregate), null);
  assert.equal(Object.hasOwn(receipt.evidence.aggregate, '__proto__'), true);
  assert.equal(receipt.evidence.aggregate.__proto__, 'inert');
});

test('C1 rejects evidence objects with an inherited prototype instead of dropping inherited keys', () => {
  const evidence = Object.assign(Object.create({ inherited: 1 }), VARIANTS[5][5]);
  assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[5]), evidence }), /contribution:/);
});

test('C1 rejects cyclic evidence and non-data values', () => {
  const cycle = {};
  cycle.self = cycle;
  for (const nested of [cycle, () => 1, 1n, Symbol('value')]) {
    assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[5]), evidence: { nested } }), /contribution:/);
  }
});

test('I2 rejects uppercase hex in chain, prev, subject, sha256 and commitment', () => {
  for (const field of ['chain', 'prev', 'subject']) {
    assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[2]), [field]: HEX.toUpperCase() }),
      /contribution:/);
  }
  assert.throws(() => buildContribution({ ...REQUEST,
    evidence: { uri: 'https://example.org/photo', sha256: HEX.toUpperCase() } }), /contribution:/);
  assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[4]),
    evidence: { commitment: HEX.toUpperCase() } }), /contribution:/);
});

for (const value of [null, undefined, [], 'receipt', 1]) {
  test(`rejects non-object input ${JSON.stringify(value)}`, () => {
    assert.throws(() => buildContribution(value), /^Error: contribution:/);
  });
}

for (const key of ['extra', 'digest', 'anchor', '__proto__']) {
  test(`rejects extra own key ${key}`, () => {
    const fields = JSON.parse(JSON.stringify(REQUEST).replace(/}$/, `,"${key}":{"x":1}}`));
    assert.throws(() => buildContribution(fields), /^Error: contribution:/);
  });
}

test('does not read required fields from the prototype', () => {
  assert.throws(() => buildContribution(Object.create(REQUEST)), /^Error: contribution:/);
});

test('ignores inherited extra keys', () => {
  assert.deepEqual({ ...buildContribution(Object.assign(Object.create({ extra: true }), REQUEST)) }, REQUEST);
});

const INVALID_FIELDS = [
  ['version', 2], ['version', null], ['version', '1'],
  ['kind', 'UNKNOWN'], ['kind', 'toString'], ['kind', null],
  ['role', 'contributor'], ['actor', `G${'A'.repeat(54)}`], ['actor', `M${'A'.repeat(55)}`],
  ['actor', `G${'a'.repeat(55)}`], ['actor', `G${'1'.repeat(55)}`], ['actor', null],
  ['statement', ''], ['statement', 'a'.repeat(1001)], ['statement', null],
  ['comment', 'a'.repeat(281)], ['comment', 42],
  ['createdAt', '2026-11-16T16:00:00Z'], ['createdAt', '2026-11-16T16:00:00.000+00:00'],
  ['createdAt', '2026-02-30T16:00:00.000Z'], ['createdAt', 'invalid'], ['createdAt', null],
];
for (const [field, value] of INVALID_FIELDS) {
  test(`rejects invalid ${field}: ${JSON.stringify(value)}`, () => {
    assert.throws(() => buildContribution({ ...REQUEST, [field]: value }), /^Error: contribution:/);
  });
}

test('rejects a statement that is not NFC', () => {
  assert.throws(() => buildContribution({ ...REQUEST, statement: 'Observe\u0301' }), /contribution:.*NFC/);
});

test('rejects a comment that is not NFC', () => {
  assert.throws(() => buildContribution({ ...REQUEST, comment: 'Observe\u0301' }), /contribution:.*NFC/);
});

test('accepts the text length boundaries and an empty comment', () => {
  assert.equal(buildContribution({ ...REQUEST, statement: 'é'.repeat(1000), comment: 'é'.repeat(280) }).comment.length, 280);
  assert.equal(buildContribution({ ...REQUEST, statement: 'é', comment: '' }).comment, '');
});

test('role must match kind', () => {
  assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[2]), role: 'contributor' }), /contribution:/);
});

for (const variant of VARIANTS.slice(0, 4)) {
  test(`${variant[0]} accepts a public evidence reference and rejects malformed evidence`, () => {
    const fields = fieldsFor(variant);
    const evidence = { uri: 'https://example.org/photo', sha256: HEX };
    assert.deepEqual({ ...buildContribution({ ...fields, evidence }).evidence }, evidence);
    for (const invalid of [[], {}, 'evidence', { uri: 'http://example.org', sha256: HEX },
      { uri: 42, sha256: HEX }, { uri: 'https://example.org', sha256: 'bad' },
      { uri: 'https://example.org', sha256: HEX, extra: true }]) {
      assert.throws(() => buildContribution({ ...fields, evidence: invalid }), /contribution:/);
    }
  });
}

test('rejects SURVEY evidence without exactly one hex64 commitment', () => {
  for (const evidence of [null, [], {}, { commitment: 'bad' }, { commitment: HEX, extra: true }]) {
    assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[4]), evidence }), /contribution:/);
  }
});

test('rejects REPORT evidence that is not a non-null object', () => {
  for (const evidence of [null, undefined, [], 'report', 42]) {
    assert.throws(() => buildContribution({ ...fieldsFor(VARIANTS[5]), evidence }), /contribution:/);
  }
  assert.deepEqual(JSON.parse(canonicalBytes(buildContribution(fieldsFor(VARIANTS[5])))).evidence,
    VARIANTS[5][5]);
});

for (const field of Object.keys(REQUEST).filter(key => key !== 'version')) {
  test(`rejects missing own field ${field}`, () => {
    const fields = { ...REQUEST };
    delete fields[field];
    assert.throws(() => buildContribution(fields), /contribution:/);
  });
}
