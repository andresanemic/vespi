import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { isValidPublicKey, requirePublicKey } from './config.js';

test('accepts a Stellar G public recipient', () => {
  const publicKey = Keypair.random().publicKey();
  assert.equal(isValidPublicKey(publicKey), true);
  assert.equal(requirePublicKey(publicKey), publicKey);
});

test('rejects empty, malformed, and secret recipients without echoing them', () => {
  const secret = Keypair.random().secret();
  for (const value of ['', 'not-a-key', secret]) {
    assert.throws(() => requirePublicKey(value, 'BORA_PAY_TO_EXPECTED'), /public key/);
  }
});
