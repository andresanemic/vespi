#!/usr/bin/env node
'use strict';

// Verifier for the sandbox run. It extends the pattern of `demo/testnet/pay.cjs --verify-mainnet` to
// testnet: for every payment it recomputes the receipt digest from the published receipt and compares it
// with the memo and the payment on Horizon. Read-only; it signs and pays nothing. No SDK needed.
//   node demo/sandbox/verify.cjs                 re-reads Horizon testnet and saves a snapshot
//   node demo/sandbox/verify.cjs --offline       replays the saved snapshot (testnet can be reset)
//   node demo/sandbox/verify.cjs --evidence=DIR  another evidence folder

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { computeDigest, verifyReceipt } = require('../../src/receipt.js');
const { toStroops } = require('./lib/sandbox.cjs');

const HEX64 = /^[0-9a-f]{64}$/;

function snapshotFetcher({ fetchImpl, snapshot }) {
  return async (url) => {
    if (snapshot.responses[url] !== undefined) return snapshot.responses[url];
    if (!fetchImpl) throw new Error(`not in snapshot: ${url}`);
    const res = await fetchImpl(url);
    const body = res.ok ? await res.json() : { __status: res.status };
    snapshot.responses[url] = body;
    return body;
  };
}

async function verifyEvidence({ dir, fetchImpl, snapshot }) {
  const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const horizon = run.horizon;
  const get = snapshotFetcher({ fetchImpl, snapshot });
  const allowed = new Set(run.concession.spend.map((g) => g.to));
  const results = [];
  const paidHashes = new Set();
  let paidTotal = 0n;

  for (const step of run.steps) {
    const checks = {};
    let receipt = null;
    try {
      receipt = JSON.parse(readFileSync(path.join(dir, step.receiptFile), 'utf8'));
    } catch {
      receipt = null;
    }
    checks.receiptReadable = receipt !== null;
    if (receipt) {
      checks.digestRecomputes = computeDigest(receipt) === receipt.digest;
      checks.receiptIntact = verifyReceipt(receipt).ok === true;
      checks.matchesRunIndex = receipt.digest === step.receiptDigest;
      checks.markedSimulated = /SIMULATED ROLE/.test(String(receipt.operation && receipt.operation.goal))
        && /SIMULATED ROLE/.test(String(receipt.context && receipt.context.scope));
    }
    if (step.outcome === 'paid' && receipt) {
      const hash = step.txHash;
      checks.anchorBound = !!receipt.anchor && receipt.anchor.status === 'anchored' && receipt.anchor.digest === receipt.digest
        && receipt.anchor.txHash === hash && receipt.anchor.network === 'stellar:testnet';
      const ex = receipt.authority && receipt.authority.exercised && receipt.authority.exercised[0];
      const tx = HEX64.test(hash || '') ? await get(`${horizon}/transactions/${hash}`) : {};
      checks.txFound = tx.hash === hash;
      checks.txSuccessful = tx.successful === true;
      checks.memoIsReceiptDigest = tx.memo_type === 'hash' && Buffer.from(String(tx.memo || ''), 'base64').toString('hex') === receipt.digest;
      checks.sourceIsPayer = tx.source_account === run.payer;
      const opsBody = HEX64.test(hash || '') ? await get(`${horizon}/transactions/${hash}/operations`) : {};
      const ops = ((opsBody._embedded && opsBody._embedded.records) || []).filter((o) => o.type === 'payment');
      checks.singlePayment = ops.length === 1;
      const op = ops[0] || {};
      checks.paymentMatchesReceipt = !!ex && op.asset_type === 'native' && ex.asset === 'XLM'
        && op.to === ex.to && toStroops(op.amount) === String(ex.maxAmount);
      checks.destinationInConcession = !!ex && allowed.has(ex.to);
      if (checks.txSuccessful) { paidHashes.add(hash); if (ex) paidTotal += BigInt(ex.maxAmount); }
    } else if (step.outcome === 'blocked' && receipt) {
      checks.notVerifiedStatus = receipt.status !== 'verified';
      checks.noTransaction = !step.txHash && !(receipt.anchor && receipt.anchor.txHash);
    }
    results.push({ id: step.id, outcome: step.outcome, attemptReason: step.attemptReason || null, txHash: step.txHash || null, digest: step.receiptDigest, checks, ok: Object.values(checks).every(Boolean) });
  }

  // The ledger must hold exactly the payments the receipts account for: nothing else left the payer.
  const pays = await get(`${horizon}/accounts/${run.payer}/payments?order=asc&limit=200`);
  const sent = ((pays._embedded && pays._embedded.records) || []).filter((r) => r.type === 'payment' && r.from === run.payer);
  const ledgerHashes = new Set(sent.map((r) => r.transaction_hash));
  const global = {
    ledgerPaymentsEqualPaidReceipts: ledgerHashes.size === paidHashes.size && [...ledgerHashes].every((h) => paidHashes.has(h)),
    everyLedgerDestinationAllowed: sent.every((r) => allowed.has(r.to)),
    totalWithinBudget: paidTotal <= BigInt(run.concession.budgetStroops),
    ledgerPaymentCount: sent.length,
    paidReceiptCount: paidHashes.size,
    paidTotalStroops: paidTotal.toString(),
  };
  const ok = results.every((r) => r.ok) && global.ledgerPaymentsEqualPaidReceipts && global.everyLedgerDestinationAllowed && global.totalWithinBudget;
  return { network: run.network, horizon, payer: run.payer, ok, global, results };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
  const dir = path.resolve(opt('evidence', path.join(__dirname, 'evidence')));
  const offline = args.includes('--offline');
  const snapFile = path.join(dir, 'horizon-snapshot.json');
  let snapshot;
  if (offline) {
    if (!existsSync(snapFile)) throw new Error('no horizon-snapshot.json to replay');
    snapshot = JSON.parse(readFileSync(snapFile, 'utf8'));
  } else {
    const run = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
    if (!/testnet/.test(run.horizon)) throw new Error('this verifier only reads Horizon testnet');
    snapshot = { schema: 'vespi-sandbox-horizon-snapshot/1', horizon: run.horizon, fetchedAt: new Date().toISOString(), responses: {} };
  }
  const report = await verifyEvidence({ dir, fetchImpl: offline ? null : fetch, snapshot });
  const say = (l = '') => process.stdout.write(`${l}\n`);
  say(`${offline ? 'Replaying the saved Horizon snapshot' : 'Reading Horizon testnet'} for ${report.payer}`);
  for (const r of report.results) {
    say(`${r.ok ? 'OK ' : 'NO '} ${r.id.padEnd(3)} ${r.outcome.padEnd(8)} ${r.attemptReason || ''}`);
    say(`      digest ${r.digest}${r.txHash ? `\n      tx     ${r.txHash}` : ''}`);
    if (!r.ok) for (const [k, v] of Object.entries(r.checks)) if (!v) say(`      FAILED ${k}`);
  }
  say(`Ledger: ${report.global.ledgerPaymentCount} payments from the payer, ${report.global.paidReceiptCount} paid receipts, total ${report.global.paidTotalStroops} stroops.`);
  say(`  ledgerPaymentsEqualPaidReceipts ${report.global.ledgerPaymentsEqualPaidReceipts}; everyLedgerDestinationAllowed ${report.global.everyLedgerDestinationAllowed}; totalWithinBudget ${report.global.totalWithinBudget}`);
  say(report.ok ? 'VERIFIED' : 'NOT VERIFIED');
  if (!offline) {
    writeFileSync(snapFile, `${JSON.stringify(snapshot, null, 2)}\n`);
    writeFileSync(path.join(dir, 'verification.json'), `${JSON.stringify({ verifiedAt: snapshot.fetchedAt, mode: 'live', ...report }, null, 2)}\n`);
    say(`Saved ${snapFile}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`${err && err.message ? err.message : err}\n`); process.exitCode = 1; });
}

module.exports = { verifyEvidence };
