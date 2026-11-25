import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk/base';

const { sessionFromKeypair, signerFromSession, SESSION_MS }: typeof import('./session-key') =
  await import(new URL('./session-key.ts', import.meta.url).href);
const pair = Keypair.random();
const now = 1_800_000_000_000;

test('the session signs as the account and its key cannot be exported', async () => {
  const stored = await sessionFromKeypair(pair, now);
  assert.equal(stored.key.extractable, false);
  for (const format of ['pkcs8', 'jwk', 'raw'] as const) await assert.rejects(crypto.subtle.exportKey(format, stored.key));
  assert.deepEqual(Object.keys(stored).sort(), ['expires', 'key', 'publicKey']);
  const session = signerFromSession(stored, pair.publicKey(), now);
  assert.ok(session);
  const bytes = Buffer.from('a transaction hash');
  assert.ok(pair.verify(bytes, Buffer.from(await session.signer.sign(bytes))));
  assert.equal(session.expires, now + SESSION_MS);
});

test('another account, expiry, a stretched expiry or an exportable key close the session', async () => {
  const stored = await sessionFromKeypair(pair, now);
  assert.equal(signerFromSession(stored, Keypair.random().publicKey(), now), null);
  assert.equal(signerFromSession(stored, pair.publicKey(), now + SESSION_MS), null);
  assert.equal(signerFromSession({ ...stored, expires: now + SESSION_MS + 1 }, pair.publicKey(), now), null);
  assert.equal(signerFromSession({ ...stored, expires: 'never' }, pair.publicKey(), now), null);
  const { privateKey } = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  assert.equal(signerFromSession({ ...stored, key: privateKey }, pair.publicKey(), now), null);
  assert.equal(signerFromSession(undefined, pair.publicKey(), now), null);
});
