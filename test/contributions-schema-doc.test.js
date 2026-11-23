'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('schema doc names every kind, role and field', () => {
  const doc = readFileSync(require.resolve('../docs/CONTRIBUTIONS_RECEIPT_V1.md'), 'utf8');
  const { KINDS, ROLE_BY_KIND } = require('../src/contributions.js');
  const fields = ['version', 'chain', 'kind', 'role', 'actor', 'statement', 'comment',
    'subject', 'prev', 'evidence', 'createdAt'];

  for (const kind of KINDS) assert.match(doc, new RegExp(`\\b${kind}\\b`));
  for (const role of Object.values(ROLE_BY_KIND)) assert.match(doc, new RegExp(`\\b${role}\\b`));
  for (const field of fields) assert.match(doc, new RegExp(`\\b${field}\\b`));
  assert.match(doc, /version:\s*1/);
  for (const reason of ['empty', 'first-not-request', 'unexpected-kind', 'duplicate', 'wrong-chain',
    'broken-prev', 'contributor-changed', 'accept-not-last', 'accept-by-non-requester',
    'accept-subject-not-in-chain']) assert.match(doc, new RegExp(`\\b${reason}\\b`));
});
