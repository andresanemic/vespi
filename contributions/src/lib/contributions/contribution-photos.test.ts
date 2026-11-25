import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { GetBlobResult } from '@vercel/blob';

import './test-imports.mjs';
const { createPhotoStore, createPhotoUpload }: typeof import('./contribution-photos') =
  await import(new URL('./contribution-photos.ts', import.meta.url).href);
const { photoUploadMessage }: typeof import('./photo-authorization') =
  await import(new URL('./photo-authorization.ts', import.meta.url).href);
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13));
const actor = signer.publicKey();
// One pixel PNG. Hashes and authorization signs cover the original file bytes.
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const expiresAt = 50;
const signature = signer.sign(Buffer.from(photoUploadMessage(actor, sha256, expiresAt))).toString('hex');

test('photo upload checks authorization and bytes before writing a private Blob', async () => {
  const saves: unknown[][] = [];
  const checks: unknown[][] = [];
  let quota = false;
  const upload = createPhotoUpload({
    accountExists: async key => key === actor,
    reserve: async (...args) => { checks.push(args); return quota; },
    save: async (...args) => { saves.push(args); },
  }, () => 1000);
  const body = { actor, sha256, expiresAt, signature, base64: bytes.toString('base64') };
  assert.deepEqual(await upload({ ...body, signature: 'a'.repeat(128) }),
    { ok: false, reason: 'photo-signature-required' });
  const different = Buffer.concat([bytes, Buffer.from('extra')]).toString('base64');
  assert.deepEqual(await upload({ ...body, base64: different }), { ok: false, reason: 'invalid-photo' });
  assert.deepEqual(checks, []);
  assert.deepEqual(await upload(body), { ok: false, reason: 'photo-quota' });
  assert.equal(saves.length, 0);
  quota = true;
  assert.ok((await upload(body)).ok);
  assert.deepEqual(checks, [[actor, sha256, bytes.length], [actor, sha256, bytes.length]]);
  assert.deepEqual(saves, [[actor, sha256, bytes, 'image/png']]);
});

test('Blob reads belong to the signed actor, and bytes mismatching the evidence hash are refused', async () => {
  let data = bytes;
  const store = createPhotoStore({
    fetchBlob: async (path, options) => {
      assert.equal(options.access, 'private');
      assert.equal(path, `contributions/testnet/photos/${actor}/${sha256}`);
      return { statusCode: 200, stream: new Response(new Uint8Array(data)).body,
        blob: { size: data.length, contentType: 'image/png' } } as GetBlobResult;
    },
  });
  assert.deepEqual((await store.read(actor, sha256))?.bytes, bytes);
  data = Buffer.concat([bytes, Buffer.from('extra')]);
  assert.equal(await store.read(actor, sha256), null);
});
