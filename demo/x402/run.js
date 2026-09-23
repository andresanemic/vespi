import readline from 'node:readline';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Horizon } from '@stellar/stellar-sdk';
import { createRequire } from 'node:module';

const require = createRequire(process.argv[1]);
const { createOperation, runOperation } = require('../../src/operation.js');
const { x402Capability, USDC_CONTRACT } = await import('./capability.js');

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const SERVICE_URL = args['--service-url'] || process.env.SERVICE_BASE_URL || 'http://localhost:3777/api/agent-service';
const PAY_TO = args['--pay-to'] || process.env.BORA_PAY_TO_EXPECTED || '';
const SECRET = process.env.CLIENT_SECRET || '';
const MAX_USDC = args['--max-usdc'] ?? '0.05';

function atomic(usdc) {
  return Math.round(parseFloat(usdc) * 10_000_000).toString();
}
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

async function verify(evidence) {
  const server = new Horizon.Server('https://horizon-testnet.stellar.org');
  const txn = await server.transactions().transaction(evidence.txHash).call();
  if (txn.successful !== true) return { verified: false, checks: {}, reason: 'tx not successful' };
  const ops = await server.operations().forTransaction(evidence.txHash).call();
  const changes = [];
  for (const o of ops.records) {
    const full = await server.operations().operation(o.id).call();
    if (full.asset_balance_changes) changes.push(...full.asset_balance_changes);
  }
  const hit = changes.find((c) => c.asset_code === 'USDC' && c.asset_issuer === ISSUER && c.to === PAY_TO && parseFloat(c.amount) >= 0.01);
  if (!hit) return { verified: false, checks: { changesSeen: changes.length }, reason: 'no matching transfer' };
  const planDigest = crypto.createHash('sha256').update(JSON.stringify(evidence.plan)).digest('hex');
  return { verified: true, checks: { transfer: true, planDigest }, reason: 'settlement matches' };
}

async function main() {
  if (!PAY_TO || !SECRET) throw new Error('Need BORA_PAY_TO_EXPECTED + CLIENT_SECRET env (never committed).');
  const authority = { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: atomic(MAX_USDC) }] };
  const op = createOperation({ goal: 'obtain-marketing-plan (demo)', authority });
  const cap = x402Capability({ serviceUrl: SERVICE_URL, payTo: PAY_TO, secret: SECRET });
  const res = await runOperation(op, cap, {
    verify,
    ask: async (reqs) => {
      const need = reqs.map((r) => `${r.amount} of ${r.asset} to ${r.to}`).join(', ');
      const a = await ask(`Spend ${need}? [y/N] `);
      return { approved: a.trim().toLowerCase() === 'y' };
    },
  });
  console.log(JSON.stringify({ status: res.status, receipt: res.receipt }, null, 2));
}
main().catch((e) => { console.error('DEMO_FAIL: ' + e.message); process.exit(1); });
