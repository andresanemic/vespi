import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import './test-imports.mjs';

const { readSponsorConfig, sponsorAuthority, checkSponsorSpend, checkParticipantTx, checkOnboarding } =
  await import(new URL('./sponsor-policy.ts', import.meta.url).href);

const participant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const now = new Date('2026-11-16T12:00:00Z');
const cfg = { maxFeeStroops: '200', maxReserveStroops: '10000000', expiresAt: '2026-11-17T12:00:00Z' };
const env = {
  CONTRIB_SPONSOR_MAX_FEE: '200',
  CONTRIB_SPONSOR_MAX_RESERVE: '10000000',
  CONTRIB_SPONSOR_EXPIRES_AT: cfg.expiresAt,
};

function transaction({ source = participant, fee = '100', memo = Memo.hash(Buffer.alloc(32, 3)),
  operations = [Operation.bumpSequence({ bumpTo: '2' })] }: {
  source?: string; fee?: string; memo?: Memo; operations?: ReturnType<typeof Operation.bumpSequence>[];
} = {}) {
  const builder = new TransactionBuilder(new Account(source, '1'), {
    fee, networkPassphrase: Networks.TESTNET,
  }).addMemo(memo);
  for (const operation of operations) builder.addOperation(operation);
  return builder.setTimeout(0).build();
}

test('reads the sponsor limits and expiry without converting stroop strings', () => {
  assert.deepEqual(readSponsorConfig(env), cfg);
  assert.equal(readSponsorConfig({ ...env, CONTRIB_SPONSOR_MAX_FEE: '9007199254740993' }).maxFeeStroops,
    '9007199254740993');
});

test('rejects each missing or empty sponsor setting', () => {
  for (const key of Object.keys(env)) {
    for (const value of [undefined, '', ' ']) {
      assert.throws(() => readSponsorConfig({ ...env, [key]: value }), Error, key);
    }
  }
});

test('rejects malformed stroop budgets and expiry at the configuration boundary', () => {
  for (const key of ['CONTRIB_SPONSOR_MAX_FEE', 'CONTRIB_SPONSOR_MAX_RESERVE']) {
    for (const value of ['-1', '1.5', '1e3', 'NaN', ' 200']) {
      assert.throws(() => readSponsorConfig({ ...env, [key]: value }), Error);
    }
  }
  for (const value of ['tomorrow', '2026-11-17', '2026-02-30T12:00:00Z']) {
    assert.throws(() => readSponsorConfig({ ...env, CONTRIB_SPONSOR_EXPIRES_AT: value }), Error);
  }
});

test('authority separates the fee and reserve destinations and preserves expiry', () => {
  assert.deepEqual(sponsorAuthority(cfg), { spend: [
    { asset: 'XLM', maxAmount: '200', to: 'stellar:fee', expiresAt: cfg.expiresAt },
    { asset: 'XLM', maxAmount: '10000000', to: 'stellar:reserve', expiresAt: cfg.expiresAt },
  ] });
});

test('rejects an ungranted sponsor destination with its own reason', () => {
  assert.equal(typeof checkSponsorSpend, 'function');
  assert.deepEqual(checkSponsorSpend({ to: 'stellar:payment', amountStroops: '100' }, cfg, now),
    { ok: false, reason: 'destination-not-allowed' });
});

test('rejects an invalid current time as a policy error for participant fees', () => {
  assert.deepEqual(checkParticipantTx(transaction(), participant, cfg, new Date('x')),
    { ok: false, reason: 'policy-error' });
});

test('rejects an invalid current time as a policy error for onboarding', () => {
  assert.deepEqual(checkOnboarding(other, cfg, new Date('x')), { ok: false, reason: 'policy-error' });
});

test('rejects malformed spend requirements and grants as policy errors', () => {
  assert.equal(typeof checkSponsorSpend, 'function');
  for (const to of ['stellar:fee', 'stellar:reserve', 'stellar:payment', '']) {
    assert.deepEqual(checkSponsorSpend({ to, amountStroops: 'invalid' }, cfg, now),
      { ok: false, reason: 'policy-error' });
  }
  assert.deepEqual(checkSponsorSpend({ to: 'stellar:fee', amountStroops: '100' },
    { ...cfg, maxFeeStroops: 'invalid' }, now), { ok: false, reason: 'policy-error' });
});

test('accepts one participant bumpSequence with a hash memo at the fee bump limit', () => {
  assert.deepEqual(checkParticipantTx(transaction(), participant, cfg, now), { ok: true, baseFee: '100' });
});

test('returns the checked transaction base fee to the fee bump signer', () => {
  const tx = transaction({ fee: '150' });
  assert.deepEqual(checkParticipantTx(tx, participant, { ...cfg, maxFeeStroops: '300' }, now),
    { ok: true, baseFee: tx.fee });
});

test('rejects a transaction from another source before consulting expired authority', () => {
  assert.deepEqual(checkParticipantTx(transaction({ source: other }), participant, cfg,
    new Date('2026-11-18T12:00:00Z')), { ok: false, reason: 'wrong-source' });
});

test('rejects an operation with another source account', () => {
  assert.deepEqual(checkParticipantTx(transaction({
    operations: [Operation.bumpSequence({ bumpTo: '2', source: other })],
  }), participant, cfg, now), { ok: false, reason: 'wrong-source' });
});

test('accepts an explicit participant operation source', () => {
  assert.deepEqual(checkParticipantTx(transaction({
    operations: [Operation.bumpSequence({ bumpTo: '2', source: participant })],
  }), participant, cfg, now), { ok: true, baseFee: '100' });
});

test('rejects a different operation before consulting expired authority', () => {
  assert.deepEqual(checkParticipantTx(transaction({
    operations: [Operation.manageData({ name: 'contribution', value: 'test' })],
  }), participant, cfg, new Date('2026-11-18T12:00:00Z')), { ok: false, reason: 'wrong-operation' });
});

test('rejects zero or multiple operations before consulting expired authority', () => {
  for (const operations of [[], [Operation.bumpSequence({ bumpTo: '2' }), Operation.bumpSequence({ bumpTo: '3' })]]) {
    assert.deepEqual(checkParticipantTx(transaction({ operations }), participant, cfg,
      new Date('2026-11-18T12:00:00Z')), { ok: false, reason: 'operation-count' });
  }
});

test('rejects missing, text, id and return-hash memos before consulting expired authority', () => {
  for (const memo of [Memo.none(), Memo.text('receipt'), Memo.id('1'), Memo.return(Buffer.alloc(32, 3))]) {
    assert.deepEqual(checkParticipantTx(transaction({ memo }), participant, cfg,
      new Date('2026-11-18T12:00:00Z')), { ok: false, reason: 'memo-not-hash' });
  }
});

test('charges both the fee bump envelope and its one inner operation', () => {
  assert.deepEqual(checkParticipantTx(transaction(), participant, { ...cfg, maxFeeStroops: '199' }, now),
    { ok: false, reason: 'fee-over-limit' });
});

test('uses the transaction base fee rather than a hardcoded network minimum', () => {
  assert.deepEqual(checkParticipantTx(transaction({ fee: '150' }), participant,
    { ...cfg, maxFeeStroops: '299' }, now), { ok: false, reason: 'fee-over-limit' });
  assert.deepEqual(checkParticipantTx(transaction({ fee: '150' }), participant,
    { ...cfg, maxFeeStroops: '300' }, now), { ok: true, baseFee: '150' });
});

test('does not spend the reserve allowance on a participant fee', () => {
  assert.deepEqual(checkParticipantTx(transaction(), participant, { ...cfg, maxFeeStroops: '0' }, now),
    { ok: false, reason: 'fee-over-limit' });
});

test('rejects participant fees at and after the exact authority expiry', () => {
  for (const time of [cfg.expiresAt, '2026-11-18T12:00:00Z']) {
    assert.deepEqual(checkParticipantTx(transaction(), participant, cfg, new Date(time)),
      { ok: false, reason: 'authority-expired' });
  }
  assert.deepEqual(checkParticipantTx(transaction(), participant, cfg,
    new Date('2026-11-17T11:59:59.999Z')), { ok: true, baseFee: '100' });
});

test('accepts onboarding at exactly two base reserves without charging the fee grant', () => {
  assert.deepEqual(checkOnboarding(other, { ...cfg, maxFeeStroops: '0' }, now), { ok: true });
});

test('rejects onboarding one stroop below two base reserves even with a large fee allowance', () => {
  assert.deepEqual(checkOnboarding(other, { ...cfg, maxReserveStroops: '9999999', maxFeeStroops: '99999999' }, now),
    { ok: false, reason: 'reserve-over-limit' });
});

test('rejects onboarding at and after authority expiry', () => {
  for (const time of [cfg.expiresAt, '2026-11-18T12:00:00Z']) {
    assert.deepEqual(checkOnboarding(other, cfg, new Date(time)), { ok: false, reason: 'authority-expired' });
  }
});
