import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import './test-imports.mjs';

const { buildOnboardingTx, wrapFeeBump, onboardingToken, verifyOnboardingToken, isBadSequence } =
  await import(new URL('./stellar-server.ts', import.meta.url).href);
const { checkParticipantTx } = await import(new URL('./sponsor-policy.ts', import.meta.url).href);

const channel = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const sponsor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const participant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const tokenKey = new Uint8Array(32).fill(9);

function onboarding(newAccount = participant.publicKey(), channelId = channel.publicKey()) {
  return buildOnboardingTx({
    channel: new Account(channelId, '100'), sponsor: sponsor.publicKey(), newAccount,
    baseFee: '150', timeoutSeconds: 120,
  });
}

test('builds an unsigned testnet onboarding through the channel with the exact sponsored operations', () => {
  const before = Math.floor(Date.now() / 1000);
  const tx = onboarding();
  assert.equal(tx.source, channel.publicKey());
  assert.equal(tx.sequence, '101');
  assert.equal(tx.networkPassphrase, Networks.TESTNET);
  assert.equal(tx.fee, '450');
  assert.equal(tx.memo.type, 'none');
  assert.deepEqual(tx.signatures, []);
  assert.deepEqual(tx.operations, [
    { type: 'beginSponsoringFutureReserves', source: sponsor.publicKey(), sponsoredId: participant.publicKey() },
    { type: 'createAccount', source: sponsor.publicKey(), destination: participant.publicKey(), startingBalance: '0.0000000' },
    { type: 'endSponsoringFutureReserves', source: participant.publicKey() },
  ]);
  assert.equal(tx.toEnvelope().v1().tx().operations()[1].body().createAccountOp().startingBalance().toString(), '0');
  assert.equal(tx.timeBounds?.minTime, '0');
  assert.ok(Number(tx.timeBounds?.maxTime) >= before + 120);
  assert.ok(Number(tx.timeBounds?.maxTime) <= Math.floor(Date.now() / 1000) + 120);
});

test('wraps and signs the fee bump without changing the participant hash, XDR or signature', () => {
  const inner = new TransactionBuilder(new Account(participant.publicKey(), '100'), {
    fee: '150', networkPassphrase: Networks.TESTNET,
  }).addMemo(Memo.hash(Buffer.alloc(32, 7)))
    .addOperation(Operation.bumpSequence({ bumpTo: '102' })).setTimeout(120).build();
  inner.sign(participant);
  const originalXdr = inner.toXDR();
  const originalHash = inner.hash();
  const cfg = { maxFeeStroops: '300', maxReserveStroops: '10000000', expiresAt: '2026-11-17T12:00:00Z' };
  const checked = checkParticipantTx(inner, participant.publicKey(), cfg, new Date('2026-11-16T12:00:00Z'));
  assert.deepEqual(checked, { ok: true, baseFee: '150' });
  assert.ok(checked.ok);

  const bumped = wrapFeeBump(inner, sponsor, checked.baseFee);
  assert.equal(bumped.fee, String(BigInt(checked.baseFee) * BigInt(2)));
  assert.equal(bumped.fee, '300');
  assert.equal(bumped.feeSource, sponsor.publicKey());
  assert.equal(bumped.networkPassphrase, Networks.TESTNET);
  assert.equal(bumped.innerTransaction.toXDR(), originalXdr);
  assert.deepEqual(bumped.innerTransaction.hash(), originalHash);
  assert.equal(inner.toXDR(), originalXdr);
  assert.equal(bumped.innerTransaction.signatures.length, 1);
  assert.ok(participant.verify(bumped.innerTransaction.hash(), bumped.innerTransaction.signatures[0].signature()));
  assert.equal(bumped.signatures.length, 1);
  assert.ok(sponsor.verify(bumped.hash(), bumped.signatures[0].signature()));
});

test('computes the known HMAC-SHA256 hex token over the unsigned XDR envelope', () => {
  const xdr = 'AAAAAgAAAADtSSjGKNHCxurpAziQWZVhKVknOlxj+TY2wUYUrIc30QAAAGQAAAAAAAAAZQAAAAEAAAAAAAAAAAAAAAB3NZQAAAAAAAAAAAEAAAAAAAAACwAAAAAAAABmAAAAAAAAAAA=';
  const expected = 'f13e82005a447bc54dbb484d8bd6f6f05b6ccf0817168d246501886c7528ea06';
  assert.equal(onboardingToken(xdr, tokenKey), expected);
  assert.equal(verifyOnboardingToken(xdr, expected, tokenKey), true);
});

test('keeps the onboarding token valid after the participant signs without removing their signature', () => {
  const tx = onboarding();
  const token = onboardingToken(tx.toXDR(), tokenKey);
  assert.equal(verifyOnboardingToken(tx.toXDR(), token, tokenKey), true);
  tx.sign(participant);
  const signedXdr = tx.toXDR();
  assert.equal(onboardingToken(signedXdr, tokenKey), token);
  assert.equal(verifyOnboardingToken(signedXdr, token, tokenKey), true);
  assert.equal(tx.toXDR(), signedXdr);
  assert.equal(tx.signatures.length, 1);
});

test('rejects a token when the new account or channel changes', () => {
  const token = onboardingToken(onboarding().toXDR(), tokenKey);
  assert.equal(verifyOnboardingToken(onboarding(other.publicKey()).toXDR(), token, tokenKey), false);
  assert.equal(verifyOnboardingToken(onboarding(participant.publicKey(), other.publicKey()).toXDR(), token, tokenKey), false);
});

test('rejects a token when the transaction operations change', () => {
  const original = onboarding();
  const changed = new TransactionBuilder(new Account(channel.publicKey(), '100'), {
    fee: '150', networkPassphrase: Networks.TESTNET, timebounds: original.timeBounds,
  }).addOperation(Operation.bumpSequence({ bumpTo: '102' }));
  const token = onboardingToken(original.toXDR(), tokenKey);
  assert.equal(verifyOnboardingToken(changed.build().toXDR(), token, tokenKey), false);
});

test('rejects a different token key and altered or malformed hex tokens', () => {
  const xdr = onboarding().toXDR();
  const token = onboardingToken(xdr, tokenKey);
  assert.equal(verifyOnboardingToken(xdr, token, new Uint8Array(32).fill(8)), false);
  const altered = (token[0] === '0' ? '1' : '0') + token.slice(1);
  for (const invalid of [altered, '', token.slice(2), token + '00', 'z'.repeat(64), token + 'zz', token + '\n', token.slice(0, -1) + 'g']) {
    assert.equal(verifyOnboardingToken(xdr, invalid, tokenKey), false);
  }
});

test('rejects malformed XDR and fee bump envelopes during token verification', () => {
  const tx = onboarding();
  const token = onboardingToken(tx.toXDR(), tokenKey);
  const bumped = wrapFeeBump(tx, sponsor, '150');
  for (const invalid of ['', 'not-xdr', bumped.toXDR()]) {
    assert.equal(verifyOnboardingToken(invalid, token, tokenKey), false);
  }
});

test('recognizes the literal Horizon error response for a bad transaction sequence', () => {
  assert.equal(isBadSequence({ response: { status: 400, data: {
    type: 'https://stellar.org/horizon-errors/transaction_failed',
    title: 'Transaction Failed', status: 400,
    extras: { result_codes: { transaction: 'tx_bad_seq' } },
  } } }), true);
});

test('does not treat other Horizon codes, operation codes or malformed errors as a bad sequence', () => {
  for (const error of [
    null, undefined, false, 1, 'tx_bad_seq', new Error('tx_bad_seq'), {}, { response: null },
    { response: { data: null } }, { response: { data: { extras: null } } },
    { response: { data: { extras: { result_codes: null } } } },
    { response: { data: { extras: { result_codes: { transaction: 'tx_failed', operations: ['tx_bad_seq'] } } } } },
    { response: { data: { extras: { result_codes: { transaction: 'tx_bad_auth' } } } } },
  ]) assert.equal(isBadSequence(error), false);
});
