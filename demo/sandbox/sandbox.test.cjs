'use strict';

// Offline tests: no network, no SDK. Run from the repository root: node --test demo/sandbox/
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, cpSync, mkdtempSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { operateStep, buildConcession, buildStaleConcession, validateRole, toStroops, deriveAuthority } = require('./lib/sandbox.cjs');
const { verifyEvidence } = require('./verify.cjs');
const { computeDigest } = require('../../src/receipt.js');

const role = JSON.parse(readFileSync(path.join(__dirname, 'role', 'contributor-payments.role.json'), 'utf8'));
const config = JSON.parse(readFileSync(path.join(__dirname, 'config', 'run.config.json'), 'utf8'));
const addr = { 'contributor-ana': 'GANA', 'contributor-bruno': 'GBRUNO', outsider: 'GOUT', 'unlisted-random': 'GRAND' };
const resolve = (l) => addr[l];

function fakeAdapter() {
  const sent = [];
  return {
    sent,
    async pay(p) { sent.push(p); return `${String(sent.length).padStart(2, '0')}`.padEnd(64, 'a'); },
    async confirm({ txHash, memoHex }) { return sent.some((s, i) => s.memoHex === memoHex && txHash.startsWith(String(i + 1).padStart(2, '0'))); },
  };
}
const step = (o) => ({ id: 't', type: 'pay', to: 'contributor-ana', amountXLM: '0.5', contribution: 'test', ...o });

test('a payment inside the concession is authorized and its memo is the receipt digest', async () => {
  const adapter = fakeAdapter();
  const concession = buildConcession(config, resolve, validateRole(role));
  const r = await operateStep({ step: step({}), role, concession, spent: 0n, resolve, adapter });
  assert.equal(r.outcome, 'paid');
  assert.equal(adapter.sent.length, 1);
  assert.equal(adapter.sent[0].memoHex, r.receipt.digest);
  assert.equal(computeDigest(r.receipt), r.receipt.digest);
  assert.equal(r.receipt.anchor.status, 'anchored');
  assert.match(r.receipt.operation.goal, /SIMULATED ROLE/);
});

test('out-of-limit attempts are blocked by the kernel and nothing is sent', async () => {
  const adapter = fakeAdapter();
  const concession = buildConcession(config, resolve, role);
  const spent = BigInt(toStroops('2.4'));
  const cases = [
    [step({ amountXLM: '0.7' }), /consume/],                 // over the remaining budget
    [step({ amountXLM: '25' }), /consume/],                  // far above the budget
    [step({ to: 'outsider' }), /no grant/],                  // destination not listed
    [step({ to: 'unlisted-random' }), /no grant/],           // destination not listed
    [step({ asset: 'USDC' }), /no grant for asset USDC/],    // asset never granted
  ];
  for (const [s, why] of cases) {
    const r = await operateStep({ step: s, role, concession, spent, resolve, adapter });
    assert.equal(r.outcome, 'blocked');
    assert.equal(r.kernelStatus, 'needs_human_decision');
    assert.match(r.detail, why);
    assert.equal(r.receipt.anchor.status, 'pending');
  }
  assert.equal(adapter.sent.length, 0);
});

test('an expired authority is refused, with the real clock and with an injected one', async () => {
  const adapter = fakeAdapter();
  const live = buildConcession(config, resolve, role);
  const stale = buildStaleConcession(config, live);
  const a = await operateStep({ step: step({}), role, concession: stale, spent: 0n, resolve, adapter });
  assert.equal(a.outcome, 'blocked');
  assert.match(a.detail, /expired/);
  const later = () => new Date(Date.parse(live.expiresAt) + 1000).toISOString();
  const b = await operateStep({ step: step({}), role, concession: live, spent: 0n, resolve, adapter, now: later });
  assert.equal(b.outcome, 'blocked');
  assert.match(b.detail, /expired/);
  assert.equal(adapter.sent.length, 0);
});

test('the budget is cumulative: payments up to the budget pass, the next one is blocked', async () => {
  const adapter = fakeAdapter();
  const concession = buildConcession(config, resolve, role);
  let spent = 0n;
  for (const amt of ['1', '1', '1']) {
    const r = await operateStep({ step: step({ amountXLM: amt }), role, concession, spent, resolve, adapter });
    assert.equal(r.outcome, 'paid');
    spent += BigInt(toStroops(amt));
  }
  const over = await operateStep({ step: step({ amountXLM: '0.0000001' }), role, concession, spent, resolve, adapter });
  assert.equal(over.outcome, 'blocked');
  assert.equal(deriveAuthority(concession, spent).remaining, '0');
});

test('the role must be simulated and the concession cannot exceed the role limits', () => {
  assert.throws(() => validateRole({ ...role, simulated: false }), /simulated/);
  const big = { ...config, concession: { ...config.concession, budgetXLM: '6' } };
  assert.throws(() => buildConcession(big, resolve, role), /exceeds/);
});

function evidenceCopy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sandbox-ev-'));
  cpSync(path.join(__dirname, 'evidence'), dir, { recursive: true });
  return dir;
}
const replay = (dir) => {
  const snapshot = JSON.parse(readFileSync(path.join(dir, 'horizon-snapshot.json'), 'utf8'));
  return { dir, fetchImpl: null, snapshot };
};

test('the committed evidence verifies offline against the saved Horizon snapshot', async () => {
  const report = await verifyEvidence(replay(evidenceCopy()));
  assert.equal(report.ok, true);
  assert.equal(report.results.filter((r) => r.outcome === 'paid').length >= 5, true);
  assert.equal(report.results.filter((r) => r.outcome === 'blocked').length >= 6, true);
  assert.equal(report.global.ledgerPaymentsEqualPaidReceipts, true);
});

test('an edited receipt fails the verifier', async () => {
  const dir = evidenceCopy();
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const file = path.join(dir, run.steps.find((s) => s.outcome === 'paid').receiptFile);
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  receipt.authority.exercised[0].maxAmount = '1';
  writeFileSync(file, JSON.stringify(receipt));
  const report = await verifyEvidence(replay(dir));
  assert.equal(report.ok, false);
});

test('a memo that is not the receipt digest fails the verifier', async () => {
  const dir = evidenceCopy();
  const ctx = replay(dir);
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const url = `${run.horizon}/transactions/${run.steps.find((s) => s.outcome === 'paid').txHash}`;
  ctx.snapshot.responses[url].memo = Buffer.alloc(32, 7).toString('base64');
  const report = await verifyEvidence(ctx);
  assert.equal(report.ok, false);
  assert.equal(report.results.find((r) => r.checks.memoIsReceiptDigest === false) !== undefined, true);
});

test('a payment on the ledger that no receipt accounts for fails the verifier', async () => {
  const dir = evidenceCopy();
  const ctx = replay(dir);
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const key = Object.keys(ctx.snapshot.responses).find((k) => k.includes('/payments?'));
  ctx.snapshot.responses[key]._embedded.records.push({ type: 'payment', from: run.payer, to: run.accounts.outsider, transaction_hash: 'f'.repeat(64), amount: '1.0000000' });
  const report = await verifyEvidence(ctx);
  assert.equal(report.ok, false);
  assert.equal(report.global.everyLedgerDestinationAllowed, false);
});
