// Kernel commit 1f558b8 (vespi kernel repo).
// Source: test/contributions-chain.test.js, with paths pointed at this copy.
// Do not edit: change the source and re-copy.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildContribution, contributionDigest, verifyChain } = require('../contributions.js');

const REQUESTER = 'G' + 'A'.repeat(55);
const CONTRIBUTOR = 'G' + 'B'.repeat(55);
const OTHER = 'G' + 'C'.repeat(55);
const HEX = 'a'.repeat(64);
const request = buildContribution({
  kind: 'REQUEST', role: 'requester', actor: REQUESTER, statement: 'Busco un aporte',
  chain: null, prev: null, subject: null, comment: null, evidence: null,
  createdAt: '2026-11-16T16:00:00.000Z',
});
const chainId = contributionDigest(request);
const contribution = buildContribution({
  ...request, kind: 'CONTRIBUTE', role: 'contributor', actor: CONTRIBUTOR,
  chain: chainId, prev: chainId, statement: 'Primer aporte',
});
const corrected = buildContribution({
  ...contribution, prev: contributionDigest(contribution), statement: 'Aporte corregido',
});
const accept = buildContribution({
  ...request, kind: 'ACCEPT', chain: chainId,
  prev: contributionDigest(contribution), subject: contributionDigest(contribution),
});

function rejects(receipts, reason, expectedChainId = chainId) {
  assert.deepEqual(verifyChain(receipts), { ok: false, reason, chainId: expectedChainId });
}

for (const [label, receipts] of [
  ['object', {}], ['Map', new Map()], ['number', 5], ['empty string', ''], ['null', null],
]) {
  test(`throws a contribution error for a non-array input: ${label}`, () => {
    assert.throws(() => verifyChain(receipts), { name: 'Error', message: /^contribution:/ });
  });
}

test('rejects an empty chain', () => {
  rejects([], 'empty', null);
});

test('rejects a first receipt that is not REQUEST', () => {
  rejects([contribution], 'first-not-request', null);
});

test('rejects a receipt from the wrong chain', () => {
  rejects([request, buildContribution({ ...contribution, chain: HEX })], 'wrong-chain');
});

test('rejects a broken prev link', () => {
  rejects([request, contribution, buildContribution({ ...corrected, prev: chainId })], 'broken-prev');
});

for (const [kind, role, chain, subject, evidence] of [
  ['ATTEST', 'observer', chainId, contributionDigest(contribution), null],
  ['SURVEY', 'respondent', null, null, { commitment: HEX }],
  ['REPORT', 'organizer', null, null, {
    surveys: [], commitments: [], counts: { withAccount: 0, withoutAccount: 0, fallbackForm: 0 }, aggregate: {},
  }],
  ['REQUEST', 'requester', null, null, null],
]) {
  test(`rejects unexpected kind ${kind}`, () => {
    const receipt = buildContribution({
      ...request, kind, role, chain, subject, evidence, statement: 'Otro recibo',
    });
    rejects([request, contribution, receipt], 'unexpected-kind');
  });
}

test('rejects ACCEPT when it is not last', () => {
  rejects([request, contribution, accept, corrected], 'accept-not-last');
});

test('rejects ACCEPT by someone other than the requester', () => {
  rejects([request, contribution, buildContribution({ ...accept, actor: CONTRIBUTOR })],
    'accept-by-non-requester');
});

test('rejects ACCEPT whose subject is outside the chain', () => {
  rejects([request, contribution, buildContribution({ ...accept, subject: HEX })],
    'accept-subject-not-in-chain');
});

test('rejects ACCEPT whose subject is the REQUEST', () => {
  rejects([request, contribution, buildContribution({ ...accept, subject: chainId })],
    'accept-subject-not-in-chain');
});

test('rejects a changed contributor', () => {
  rejects([request, contribution, buildContribution({ ...corrected, actor: OTHER })],
    'contributor-changed');
});

test('rejects duplicate receipt digests before their broken prev link', () => {
  rejects([request, contribution, buildContribution({ ...contribution })], 'duplicate');
});

test('accepts REQUEST -> CONTRIBUTE -> ACCEPT', () => {
  assert.deepEqual(verifyChain([request, contribution, accept]), { ok: true, reason: null, chainId });
});

test('accepts a corrected CONTRIBUTE and an ACCEPT of the second version', () => {
  const acceptance = buildContribution({
    ...accept, prev: contributionDigest(corrected), subject: contributionDigest(corrected),
  });
  assert.deepEqual(verifyChain([request, contribution, corrected, acceptance]),
    { ok: true, reason: null, chainId });
});

test('accepts an open chain without ACCEPT', () => {
  assert.deepEqual(verifyChain([request, contribution]), { ok: true, reason: null, chainId });
});

test('accepts an ACCEPT of an earlier contribution version', () => {
  const acceptance = buildContribution({ ...accept, prev: contributionDigest(corrected) });
  assert.deepEqual(verifyChain([request, contribution, corrected, acceptance]),
    { ok: true, reason: null, chainId });
});

test('accepts a REQUEST-only open chain', () => {
  assert.deepEqual(verifyChain([request]), { ok: true, reason: null, chainId });
});

test('rejects an ACCEPT directly after REQUEST', () => {
  rejects([request, buildContribution({ ...accept, prev: chainId })], 'unexpected-kind');
});

test('returns the first chain failure', () => {
  rejects([request, buildContribution({ ...contribution, chain: HEX }),
    buildContribution({ ...corrected, actor: OTHER })], 'wrong-chain');
});

test('throws when the first receipt fails buildContribution', () => {
  assert.throws(() => verifyChain([{ ...request, extra: true }, contribution]),
    /contribution: unexpected field/);
});

test('throws when a later receipt fails buildContribution', () => {
  assert.throws(() => verifyChain([request, { ...contribution, extra: true }]),
    /contribution: unexpected field/);
});
