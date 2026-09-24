import readline from 'node:readline';
import { parseUsdc } from './amount.js';
import { parseArgs, validateServiceUrl } from './cli.js';
import { requirePublicKey } from './config.js';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOperation, runOperation } = require('../../src/operation.js');
const { x402Capability, USDC_CONTRACT, PRICE_ATOMIC } = await import('./capability.js');
const { verifySettlement } = await import('./settlement.js');

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const args = parseArgs(process.argv.slice(2), new Set(['--service-url', '--pay-to', '--max-usdc']));
const SERVICE_URL = args['--service-url'] || process.env.SERVICE_BASE_URL || 'http://localhost:3777/api/agent-service';
const PAY_TO = args['--pay-to'] || process.env.BORA_PAY_TO_EXPECTED || '';
const SECRET = process.env.CLIENT_SECRET || '';
const MAX_USDC = args['--max-usdc'] ?? '0.05';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

async function verify(evidence, payer, payTo) {
  return verifySettlement(evidence, {
    horizon: new Horizon.Server('https://horizon-testnet.stellar.org'),
    payer,
    payTo,
    amount: PRICE_ATOMIC,
    issuer: ISSUER,
    assetContract: USDC_CONTRACT,
    requireAuthDigest: true,
  });
}

async function main() {
  if (!PAY_TO) throw new Error('Need BORA_PAY_TO_EXPECTED env (never committed).');
  const payTo = requirePublicKey(PAY_TO, 'BORA_PAY_TO_EXPECTED');
  const serviceUrl = validateServiceUrl(SERVICE_URL);
  const payer = SECRET ? Keypair.fromSecret(SECRET).publicKey() : '';
  const authority = { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: parseUsdc(MAX_USDC), to: payTo }] };
  const op = createOperation({ goal: 'obtain-marketing-plan (demo)', authority });
  const cap = x402Capability({ serviceUrl, payTo, secret: SECRET });
  const res = await runOperation(op, cap, {
    verify: (evidence) => verify(evidence, payer, payTo),
    ask: async (reqs) => {
      const need = reqs.map((r) => `${r.amount} of ${r.asset} to ${r.to}`).join(', ');
      const a = await ask(`Spend ${need}? [y/N] `);
      return { approved: a.trim().toLowerCase() === 'y' };
    },
  });
  console.log(JSON.stringify({ status: res.status, output: res.output, receipt: res.receipt }, null, 2));
}
main().catch((e) => { console.error('DEMO_FAIL: ' + e.message); process.exit(1); });
