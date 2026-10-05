import readline from 'node:readline';
import { parseUsdc } from './amount.js';
import { parseArgs, validateServiceUrl } from './cli.js';
import { requirePublicKey } from './config.js';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { createOperation, runOperation } from '../../src/operation.js';
import { createRequire } from 'node:module';

// This runner is always the entry point, so its own path is the base of a require, and Node can
// require an ES module. That is how the kernel contract is reached for its claims store, and the
// bridge (ports.js, beside this file, ESM) without loading the bridge on the historical path.
const load = createRequire(process.argv[1]);
const kernel = load('../../src/x402.js');
const { x402Capability, USDC_CONTRACT, PRICE_ATOMIC } = await import('./capability.js');
const { verifySettlement } = await import('./settlement.js');
// `--bridge` swaps the historical adapter for the kernel contract (src/x402.js) driven by the
// reference bridge (ports.js), passed as `--bridge=1`. Without the flag the runner behaves exactly as
// it always has: the historical adapter, its own verifier, the same receipts.

// The flag has to be given with its value, not merely present: `--bridge`, `--bridge=1` and
// `--bridge=yes` are three different requests, and only one of them is the bridge. A value this does
// not know is refused before anything else happens, rather than quietly running the other adapter.
function bridgeRequested(args) {
  if (!Object.prototype.hasOwnProperty.call(args, '--bridge')) return false;
  const value = args['--bridge'];
  if (value === '1') return true;
  throw new Error('--bridge takes no value other than 1');
}

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const args = parseArgs(process.argv.slice(2), new Set(['--service-url', '--pay-to', '--max-usdc', '--bridge']));
const SERVICE_URL = args['--service-url'] || process.env.SERVICE_BASE_URL || 'http://localhost:3777/api/agent-service';
const PAY_TO = args['--pay-to'] || process.env.QUEEN_PAY_TO_EXPECTED || '';
const SECRET = process.env.CLIENT_SECRET || '';
const MAX_USDC = args['--max-usdc'] ?? '0.05';
const BRIDGE = bridgeRequested(args);
// One claims store for the life of this process, created here and handed to the bridge: the
// deduplication of a recovered operation cannot live inside a per-request factory.
const CLAIMS = kernel.createMemoryPaymentClaims();

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
  if (!PAY_TO) throw new Error('Need QUEEN_PAY_TO_EXPECTED env (never committed).');
  const payTo = requirePublicKey(PAY_TO, 'QUEEN_PAY_TO_EXPECTED');
  const serviceUrl = validateServiceUrl(SERVICE_URL);
  const payer = SECRET ? Keypair.fromSecret(SECRET).publicKey() : '';
  const authority = { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: parseUsdc(MAX_USDC), to: payTo }] };
  const op = createOperation({ goal: 'obtain-marketing-plan (demo)', authority });
  const askHuman = async (reqs) => {
    const need = reqs.map((r) => `${r.amount} of ${r.asset} to ${r.to}`).join(', ');
    const a = await ask(`Spend ${need}? [y/N] `);
    return { approved: a.trim().toLowerCase() === 'y' };
  };
  if (BRIDGE) {
    const bridgeModule = load('./ports.js');
    const payment = bridgeModule.createMarketingPlanPayment({
      serviceUrl,
      payTo,
      secret: SECRET,
      claims: CLAIMS,
      horizonUrl: process.env.STELLAR_HORIZON_URL || undefined,
      rpcUrl: process.env.STELLAR_RPC_URL || undefined,
    });
    const res = await payment.run(op, { ask: askHuman });
    console.log(JSON.stringify({ status: res.status, output: res.output, receipt: res.receipt }, null, 2));
    return;
  }
  const cap = x402Capability({ serviceUrl, payTo, secret: SECRET });
  const res = await runOperation(op, cap, {
    verify: (evidence) => verify(evidence, payer, payTo),
    ask: askHuman,
  });
  console.log(JSON.stringify({ status: res.status, output: res.output, receipt: res.receipt }, null, 2));
}
main().catch((e) => { console.error('DEMO_FAIL: ' + e.message); process.exit(1); });
