'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { canonicalize, computeDigest } = require('../src/receipt.js');

const sample = { version: 1, kind: 'ATTEST', statement: 'Observé la charla 🐝', comment: null, b: [2, { z: 1, a: 0 }] };

test('canonicalize is exported and its bytes hash to computeDigest', () => {
  assert.equal(typeof canonicalize, 'function');
  const bytes = JSON.stringify(canonicalize(sample));
  assert.equal(createHash('sha256').update(bytes, 'utf8').digest('hex'), computeDigest(sample));
});

test('canonical bytes sort keys at every depth', () => {
  assert.equal(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } })), '{"a":{"c":3,"d":2},"b":1}');
});
