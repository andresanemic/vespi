#!/usr/bin/env node
// Re-checks, against Horizon, every transaction listed in docs/testnet-evidence.json.
// It only READS: no keys, no signing, no writes to the network. Dependency-free (Node 18+ for fetch).
//   node scripts/verify-testnet-evidence.mjs            checks all of them against Horizon testnet
//   node scripts/verify-testnet-evidence.mjs --offline  only checks the shape of the file
// Exit code 0 only if every listed hash is a successful transaction on the network.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HORIZON = process.env.HORIZON_TESTNET_URL || 'https://horizon-testnet.stellar.org';
const file = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const offline = process.argv.includes('--offline');

export function readEvidence(path = file) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const list = data.transactions;
  if (!Array.isArray(list) || list.length === 0) throw new Error('docs/testnet-evidence.json has no transactions');
  const seen = new Set();
  for (const t of list) {
    if (!/^[0-9a-f]{64}$/.test(t.hash)) throw new Error(`not a transaction hash: ${t.hash}`);
    if (seen.has(t.hash)) throw new Error(`duplicate hash: ${t.hash}`);
    seen.add(t.hash);
  }
  return data;
}

async function check(hash) {
  try {
    const r = await fetch(`${HORIZON}/transactions/${hash}`, { headers: { accept: 'application/json' } });
    if (r.status === 404) return { ok: false, why: 'not found on this network' };
    if (!r.ok) return { ok: false, why: `Horizon answered ${r.status}` };
    const j = await r.json();
    return j.successful ? { ok: true, ledger: j.ledger, at: j.created_at } : { ok: false, why: 'transaction failed on the network' };
  } catch (e) {
    return { ok: false, why: String(e && e.message ? e.message : e) };
  }
}

async function main() {
  const data = readEvidence();
  const list = data.transactions;
  if (offline) {
    console.log(`shape ok: ${list.length} unique transaction hashes listed (not checked against the network)`);
    return;
  }
  let good = 0;
  const failed = [];
  for (let i = 0; i < list.length; i += 6) {
    const batch = list.slice(i, i + 6);
    const results = await Promise.all(batch.map((t) => check(t.hash)));
    results.forEach((r, k) => { if (r.ok) good += 1; else failed.push({ hash: batch[k].hash, why: r.why }); });
  }
  console.log(`${good} of ${list.length} listed transactions are successful on Horizon testnet (${HORIZON})`);
  for (const f of failed) console.log(`  FAILED ${f.hash} ${f.why}`);
  if (failed.length) {
    console.log('A failure can mean the testnet was reset since these were written (Stellar resets it a few times a year); the receipts in this repository stay as the record.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
