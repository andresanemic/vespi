#!/usr/bin/env node
'use strict';

// Runs the sandbox scenario on Stellar TESTNET (never mainnet). From the repository root, Node 24:
//   npm --prefix demo/sandbox ci
//   node demo/sandbox/run.cjs [--out=DIR]
// Creates and funds (Friendbot) fresh testnet accounts, lets the SIMULATED role operate the scenario
// under the person's one-time concession in config/run.config.json, and writes receipts + run.json.
// Secret keys stay in memory: they are never printed and never written.

const { mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { validateRole, buildConcession, buildStaleConcession, operateStep, toStroops, NETWORK } = require('./lib/sandbox.cjs');
const { createStellarAdapter, fund, loadSdk } = require('./lib/stellar.cjs');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const say = (line = '') => process.stdout.write(`${line}\n`);

async function main() {
  const root = __dirname;
  const out = path.resolve(option('out', path.join(root, 'evidence')));
  const role = validateRole(JSON.parse(readFileSync(path.join(root, 'role', 'contributor-payments.role.json'), 'utf8')));
  const config = JSON.parse(readFileSync(path.join(root, 'config', 'run.config.json'), 'utf8'));
  if (config.network !== NETWORK) throw new Error('this sandbox only runs on stellar:testnet');

  const { Keypair } = loadSdk();
  const keys = {
    treasury: Keypair.random(),
    'contributor-ana': Keypair.random(),
    'contributor-bruno': Keypair.random(),
    outsider: Keypair.random(),
    'unlisted-random': Keypair.random(),
  };
  const addr = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.publicKey()]));
  const resolve = (label) => {
    if (!addr[label]) throw new Error(`unknown destination label: ${label}`);
    return addr[label];
  };

  say(`SIMULATED ROLE "${role.name}" on ${NETWORK}. Testnet only; no real money.`);
  say('1  Funding fresh testnet accounts with Friendbot (the unlisted-random address is left unfunded).');
  for (const label of ['treasury', 'contributor-ana', 'contributor-bruno', 'outsider']) {
    await fund(addr[label]);
    say(`   ${label.padEnd(18)} ${addr[label]}`);
  }
  say(`   ${'unlisted-random'.padEnd(18)} ${addr['unlisted-random']}`);

  const started = new Date();
  const concession = buildConcession(config, resolve, role, started);
  const stale = buildStaleConcession(config, concession);
  say(`2  The person grants authority once: ${config.concession.budgetXLM} XLM budget, destinations ${config.concession.allowedDestinations.join(', ')}, expires ${concession.expiresAt}.`);

  const adapter = createStellarAdapter({ payer: keys.treasury });
  rmSync(path.join(out, 'receipts'), { recursive: true, force: true });
  mkdirSync(path.join(out, 'receipts'), { recursive: true });

  let spent = 0n;
  const steps = [];
  let n = 0;
  say('3  Operating the scenario. The kernel authorizes or blocks every step before any effect.');
  for (const step of config.steps) {
    n += 1;
    const r = await operateStep({
      step, role, resolve, adapter,
      concession: step.useStaleConcession ? stale : concession,
      spent: step.useStaleConcession ? 0n : spent,
    });
    if (r.outcome === 'paid' || r.outcome === 'submitted_unconfirmed') spent += BigInt(toStroops(step.amountXLM));
    const file = `receipts/${String(n).padStart(2, '0')}-${step.id}-${r.outcome}.json`;
    writeFileSync(path.join(out, file), `${JSON.stringify(r.receipt, null, 2)}\n`);
    const { receipt, ...rest } = r;
    steps.push({ ...rest, receiptFile: file, receiptDigest: receipt.digest, receiptStatus: receipt.status });
    const tail = r.txHash ? ` tx ${r.txHash}` : ` (${r.detail})`;
    say(`   ${step.id.padEnd(3)} ${r.outcome.toUpperCase().padEnd(8)} ${step.amountXLM.padStart(5)} ${(step.asset || 'XLM').padEnd(4)} to ${step.to}${tail}`);
  }

  const run = {
    schema: 'vespi-sandbox-run/1',
    network: NETWORK,
    horizon: adapter.horizon,
    simulated: true,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    role,
    concession: { grantedBy: concession.grantedBy, budgetStroops: concession.budget, expiresAt: concession.expiresAt, spend: concession.authority.spend },
    staleConcessionExpiresAt: stale.expiresAt,
    accounts: addr,
    payer: addr.treasury,
    steps,
    summary: {
      paid: steps.filter((s) => s.outcome === 'paid').length,
      blocked: steps.filter((s) => s.outcome === 'blocked').length,
      other: steps.filter((s) => !['paid', 'blocked'].includes(s.outcome)).length,
      spentStroops: spent.toString(),
    },
  };
  writeFileSync(path.join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  say(`4  Done: ${run.summary.paid} paid, ${run.summary.blocked} blocked, ${run.summary.other} other. Evidence in ${out}`);
  say('   Next: node demo/sandbox/verify.cjs   (re-reads Horizon and saves a snapshot)');
  process.exitCode = run.summary.other === 0 && run.summary.paid > 0 ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exitCode = 1;
});
