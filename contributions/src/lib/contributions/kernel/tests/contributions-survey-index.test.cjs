// Kernel commit 1f558b8 (vespi kernel repo).
// Source: test/contributions-survey-index.test.js, with paths pointed at this copy.
// Do not edit: change the source and re-copy.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { surveyCommitment, buildContribution, buildIndexEntry, INDEX_VERSION } = require('../contributions.js');

const HEX = 'a'.repeat(64);
const SALT = '01'.repeat(16);
const REPORT = {
  chain: null, kind: 'REPORT', role: 'organizer', actor: `G${'A'.repeat(55)}`,
  statement: 'Resultados de la encuesta', comment: null, subject: null, prev: null,
  createdAt: '2026-11-16T16:00:00.000Z',
};
const evidence = () => ({
  surveys: [HEX], commitments: [HEX, 'b'.repeat(64), 'c'.repeat(64)],
  counts: { withAccount: 1, withoutAccount: 1, fallbackForm: 1 },
  aggregate: { average: 4.5, label: 'Sí', complete: true },
});
const INDEX = {
  digest: HEX, network: 'stellar:testnet', txHash: 'b'.repeat(64), ledger: 1,
  envelopeXdr: 'YWJjZA==', rehearsal: false,
};

test('surveyCommitment is deterministic and changes with the salt', () => {
  const answer = { z: [true, 'Sí'], a: { y: 2, b: 1 } };
  const expected = createHash('sha256').update(Buffer.alloc(16, 1))
    .update('{"a":{"b":1,"y":2},"z":[true,"Sí"]}', 'utf8').digest('hex');
  assert.equal(surveyCommitment(SALT, answer), expected);
  assert.equal(surveyCommitment(SALT, { a: { b: 1, y: 2 }, z: [true, 'Sí'] }), expected);
  assert.notEqual(surveyCommitment('02'.repeat(16), answer), expected);
  assert.match(surveyCommitment('01'.repeat(17), answer), /^[0-9a-f]{64}$/);
  assert.ok(!Object.isFrozen(answer));
});

test('surveyCommitment rejects a 31-char or uppercase salt and malformed hex', () => {
  for (const salt of ['a'.repeat(31), 'AB'.repeat(16), 'a'.repeat(33), 'g'.repeat(32),
    '', null, 123, `${'a'.repeat(33)}\n`]) {
    assert.throws(() => surveyCommitment(salt, {}), /contribution:/);
  }
});

test('surveyCommitment copies only own data and rejects non-object answers', () => {
  const answer = Object.assign(Object.create(null), { a: 1 });
  Object.defineProperty(answer, '__proto__', { value: { b: 2 }, enumerable: true });
  const expected = createHash('sha256').update(Buffer.alloc(16, 1))
    .update('{"__proto__":{"b":2},"a":1}').digest('hex');
  assert.equal(surveyCommitment(SALT, answer), expected);
  assert.throws(() => surveyCommitment(SALT, Object.assign(Object.create({ inherited: true }), { a: 1 })),
    /contribution:/);
  for (const invalid of [null, undefined, [], 'answer', 1]) {
    assert.throws(() => surveyCommitment(SALT, invalid), /contribution:/);
  }
});

test('surveyCommitment rejects accessors and proxies without invoking them', () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, 'value', { get() { calls += 1; return 1; } });
  const proxy = new Proxy({}, { ownKeys() { calls += 1; return []; } });
  for (const answer of [accessor, { nested: accessor }, proxy, { nested: [proxy] }]) {
    assert.throws(() => surveyCommitment(SALT, answer), /contribution:/);
  }
  assert.equal(calls, 0);
});

test('surveyCommitment rejects cycles and non-data answers', () => {
  const cycle = {};
  cycle.self = cycle;
  for (const answer of [cycle, { value: () => 1 }, { value: 1n }, { value: Symbol('answer') }]) {
    assert.throws(() => surveyCommitment(SALT, answer), /contribution:/);
  }
});

test('REPORT accepts the aggregate contract and empty survey results', () => {
  const data = evidence();
  assert.deepEqual(JSON.parse(JSON.stringify(buildContribution({ ...REPORT, evidence: data }).evidence)), data);
  assert.doesNotThrow(() => buildContribution({ ...REPORT, evidence: {
    surveys: [], commitments: [], counts: { withAccount: 0, withoutAccount: 0, fallbackForm: 0 }, aggregate: {},
  } }));
});

test('REPORT rejects counts.withAccount different from surveys.length', () => {
  const data = evidence();
  data.counts.withAccount = 0;
  data.commitments.pop();
  assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
});

test('REPORT rejects commitments that do not add up', () => {
  for (const commitments of [[HEX, 'b'.repeat(64)],
    [HEX, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]]) {
    assert.throws(() => buildContribution({ ...REPORT, evidence: { ...evidence(), commitments } }), /contribution:/);
  }
});

test('REPORT rejects duplicate survey digests even when counts match', () => {
  const data = evidence();
  data.surveys = [HEX, HEX];
  data.counts = { withAccount: 2, withoutAccount: 1, fallbackForm: 0 };
  assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
});

test('REPORT rejects duplicate commitment digests even when counts match', () => {
  const data = evidence();
  data.commitments[1] = HEX;
  assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
});

test('REPORT rejects extra evidence keys including nested data', () => {
  for (const notes of [{ deep: [1, { value: 'unvalidated' }] }, true]) {
    assert.throws(() => buildContribution({ ...REPORT, evidence: { ...evidence(), notes } }), /contribution:/);
  }
});

test('REPORT requires all evidence fields and all three counts', () => {
  for (const field of ['surveys', 'commitments', 'counts', 'aggregate']) {
    const data = evidence();
    delete data[field];
    assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
  }
  for (const field of ['withAccount', 'withoutAccount', 'fallbackForm']) {
    const data = evidence();
    delete data.counts[field];
    assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
  }
});

test('REPORT requires dense arrays of lowercase hex64 surveys and commitments', () => {
  for (const field of ['surveys', 'commitments']) {
    for (const value of [null, {}, HEX, [HEX.toUpperCase()], ['bad'], new Array(1)]) {
      assert.throws(() => buildContribution({ ...REPORT, evidence: { ...evidence(), [field]: value } }), /contribution:/);
    }
  }
});

test('REPORT counts must be finite non-negative integers', () => {
  for (const field of ['withAccount', 'withoutAccount', 'fallbackForm']) {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, '1', null, true]) {
      const data = evidence();
      data.counts[field] = value;
      assert.throws(() => buildContribution({ ...REPORT, evidence: data }), /contribution:/);
    }
  }
});

test('REPORT aggregate accepts only finite numbers, strings and booleans', () => {
  for (const aggregate of [null, [], 'summary', { value: NaN }, { value: Infinity }, { value: -Infinity },
    { value: null }, { value: {} }, { value: [] }, { value: undefined }]) {
    assert.throws(() => buildContribution({ ...REPORT, evidence: { ...evidence(), aggregate } }), /contribution:/);
  }
});

test('buildIndexEntry rejects an unknown network and a non-integer ledger', () => {
  assert.throws(() => buildIndexEntry({ ...INDEX, network: 'stellar:unknown' }), /contribution:/);
  for (const ledger of [0, -1, 1.5, NaN, Infinity, '1', null]) {
    assert.throws(() => buildIndexEntry({ ...INDEX, ledger }), /contribution:/);
  }
});

test('buildIndexEntry marks rehearsal entries and freezes exactly the index fields', () => {
  assert.equal(INDEX_VERSION, 1);
  for (const network of ['stellar:testnet', 'stellar:pubnet']) {
    for (const rehearsal of [false, true]) {
      const input = { ...INDEX, network, rehearsal };
      assert.throws(() => buildIndexEntry({ ...input, extra: 'rejected' }), /^Error: contribution:/);
      const entry = buildIndexEntry(input);
      assert.deepEqual({ ...entry }, { ...INDEX, network, rehearsal, version: 1 });
      assert.ok(Object.isFrozen(entry));
      assert.throws(() => { entry.rehearsal = !rehearsal; }, TypeError);
      input.digest = 'c'.repeat(64);
      assert.equal(entry.digest, HEX);
    }
  }
});

test('buildIndexEntry rejects malformed hashes, rehearsal and missing fields', () => {
  for (const field of ['digest', 'txHash']) {
    for (const value of [HEX.toUpperCase(), 'a'.repeat(63), 'g'.repeat(64), null, 1]) {
      assert.throws(() => buildIndexEntry({ ...INDEX, [field]: value }), /contribution:/);
    }
  }
  for (const rehearsal of [null, 0, 'true']) {
    assert.throws(() => buildIndexEntry({ ...INDEX, rehearsal }), /contribution:/);
  }
  for (const field of Object.keys(INDEX)) {
    const input = { ...INDEX };
    delete input[field];
    assert.throws(() => buildIndexEntry(input), /contribution:/);
  }
  for (const input of [undefined, null, [], 'index']) {
    assert.throws(() => buildIndexEntry(input), /contribution:/);
  }
});

test('buildIndexEntry accepts standard base64 and rejects malformed envelopes', () => {
  for (const envelopeXdr of ['YWJj', 'YWI=', 'YQ==', '+/8=']) {
    assert.equal(buildIndexEntry({ ...INDEX, envelopeXdr }).envelopeXdr, envelopeXdr);
  }
  for (const envelopeXdr of ['', 'YQ', 'YQ=', 'Y===', '====', 'YQ==\n', 'YW J', '-_8=', null, 1]) {
    assert.throws(() => buildIndexEntry({ ...INDEX, envelopeXdr }), /contribution:/);
  }
});
