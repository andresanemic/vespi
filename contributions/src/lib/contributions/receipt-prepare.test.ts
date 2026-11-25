import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk/base';

import './test-imports.mjs';

const { POST } = await import(new URL('../../app/api/contributions/receipts/prepare/route.ts', import.meta.url).href);
const actor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const receipt = {
  kind: 'REQUEST', role: 'requester', actor, statement: 'Revisa el documento', comment: null,
  chain: null, prev: null, subject: null, evidence: null, createdAt: '2026-11-17T03:00:00.000Z',
};

async function prepare(body: unknown) {
  const response = await POST(new Request('https://example.test/api/contributions/receipts/prepare', {
    method: 'POST', body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

test('prepares the exact canonical bytes and their SHA-256 for a participant to inspect', async () => {
  const response = await prepare(receipt);
  assert.equal(response.status, 200);
  const { bytes, digest } = response.body;
  assert.equal(response.body.ok, true);
  assert.equal(bytes, JSON.stringify({
    actor, chain: null, comment: null, createdAt: receipt.createdAt, evidence: null, kind: 'REQUEST', prev: null,
    role: 'requester', statement: receipt.statement, subject: null, version: 1,
  }));
  assert.equal(digest, createHash('sha256').update(bytes, 'utf8').digest('hex'));
  assert.notEqual((await prepare({ ...receipt, statement: 'Otro aporte' })).body.digest, digest);
});

test('rejects a wrong role, invalid Stellar address, extra data and oversized input', async () => {
  assert.deepEqual(await prepare({ ...receipt, role: 'organizer' }),
    { status: 400, body: { ok: false, reason: 'invalid-receipt' } });
  assert.deepEqual(await prepare({ ...receipt, actor: 'G' + 'A'.repeat(55) }),
    { status: 400, body: { ok: false, reason: 'invalid-public-key' } });
  assert.deepEqual(await prepare({ ...receipt, digest: 'caller-supplied' }),
    { status: 400, body: { ok: false, reason: 'invalid-receipt' } });
  assert.deepEqual(await prepare({ ...receipt, statement: 'a'.repeat(16_384) }),
    { status: 413, body: { ok: false, reason: 'too_large' } });
});
