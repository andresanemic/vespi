import readline from 'node:readline';
import { parseUsdc } from './amount.js';
import { parseArgs, validateServiceUrl } from './cli.js';
import { requirePublicKey } from './config.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOperation } = require('../../src/operation.js');
const { createMarketingPlanPayment, USDC_CONTRACT } = await import('./ports.js');

// The demo runner now consumes the kernel contract: it declares the operation and the authority, and
// the contract owns discovery, terms selection, preparation, the send, the delivery check and the
// settlement verification. Stellar, x402 and HTTP stay in ports.js.
const args = parseArgs(process.argv.slice(2), new Set(['--service-url', '--pay-to', '--max-usdc']));
const SERVICE_URL = args['--service-url'] || process.env.SERVICE_BASE_URL || 'http://localhost:3777/api/agent-service';
const PAY_TO = args['--pay-to'] || process.env.QUEEN_PAY_TO_EXPECTED || '';
const SECRET = process.env.CLIENT_SECRET || '';
const MAX_USDC = args['--max-usdc'] ?? '0.05';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

async function main() {
  if (!PAY_TO) throw new Error('Need QUEEN_PAY_TO_EXPECTED env (never committed).');
  const payTo = requirePublicKey(PAY_TO, 'QUEEN_PAY_TO_EXPECTED');
  const serviceUrl = validateServiceUrl(SERVICE_URL);
  const authority = { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: parseUsdc(MAX_USDC), to: payTo }] };
  const op = createOperation({ goal: 'obtain-marketing-plan (demo)', action: 'pay', authority });
  const payment = createMarketingPlanPayment({ serviceUrl, payTo, secret: SECRET });
  const res = await payment.run(op, {
    ask: async (reqs) => {
      const need = reqs.map((r) => `${r.amount} of ${r.asset} to ${r.to}`).join(', ');
      const a = await ask(`Spend ${need}? [y/N] `);
      return { approved: a.trim().toLowerCase() === 'y', by: 'operator' };
    },
  });
  console.log(JSON.stringify({ status: res.status, output: res.output, receipt: res.receipt }, null, 2));
}
main().catch((e) => { console.error('DEMO_FAIL: ' + e.message); process.exit(1); });