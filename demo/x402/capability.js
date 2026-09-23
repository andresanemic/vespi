import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { x402Client, x402HTTPClient } from '@x402/fetch';
import { createEd25519Signer, getNetworkPassphrase } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { createRequire } from 'node:module';

// Demo adapter: the ONLY place that knows x402/Stellar/USDC.
// The kernel sees { id, required(), perform() } and nothing else.
const NETWORK = 'stellar:testnet';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PRICE_ATOMIC = '100000'; // 0.01 USDC
const MAX_SIGNATURE_SECONDS = 300; // reference endpoint's x402 default
const require = createRequire(import.meta.url);
const { sufficient } = require('../../src/authority.js');

export function x402Capability({ serviceUrl, payTo, secret }) {
  return {
    id: 'x402-marketing-plan',
    required: () => ({ spend: [{ asset: `USDC:${USDC_CONTRACT}`, amount: PRICE_ATOMIC, to: payTo }] }),
    perform: async ({ authority }) => {
      const signer = createEd25519Signer(secret, NETWORK);
      const client = new x402Client().register('stellar:*', new ExactStellarScheme(signer, { url: RPC_URL }));
      const httpClient = new x402HTTPClient(client);
      const first = await fetch(`${serviceUrl}?service=marketing-plan`);
      if (first.status !== 402) return { ok: false, error: `expected 402, got ${first.status}` };
      const pr = httpClient.getPaymentRequiredResponse((n) => first.headers.get(n));
      // The kernel records required() as the exercised effect. With this fixed-price
      // capability, an authorized grant may be wider, but the signed 402 must match
      // the declared 0.01 effect exactly or the receipt would misstate what happened.
      // Keep only offers inside both the declared effect and the effective grant.
      const authorized = pr.x402Version === 2 && Array.isArray(pr.accepts) ? pr.accepts.filter((r) =>
        r.scheme === 'exact' &&
        r.network === NETWORK &&
        r.asset === USDC_CONTRACT &&
        r.payTo === payTo &&
        r.amount === PRICE_ATOMIC &&
        Number.isSafeInteger(r.maxTimeoutSeconds) &&
        r.maxTimeoutSeconds > 0 &&
        r.maxTimeoutSeconds <= MAX_SIGNATURE_SECONDS &&
        r.extra?.areFeesSponsored === true &&
        (r.extra.paymentFlow === undefined || r.extra.paymentFlow === 'authorization') &&
        sufficient([{ asset: 'USDC:' + r.asset, amount: r.amount, to: r.payTo }], authority).ok
      ) : [];
      if (authorized.length === 0) return { ok: false, error: '402 terms outside declared effect or operation authority' };
      let payload = await client.createPaymentPayload({ ...pr, accepts: authorized });
      const tx = new Transaction(payload.payload.transaction, getNetworkPassphrase(NETWORK));
      const sd = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
      if (sd) {
        payload = { ...payload, payload: { ...payload.payload, transaction: TransactionBuilder.cloneFrom(tx, { fee: '1', sorobanData: sd, networkPassphrase: getNetworkPassphrase(NETWORK) }).build().toXDR() } };
      }
      const paid = await fetch(`${serviceUrl}?service=marketing-plan`, { headers: httpClient.encodePaymentSignatureHeader(payload) });
      if (paid.status !== 200) return { ok: false, error: `paid request failed (${paid.status})` };
      const settle = httpClient.getPaymentSettleResponse((n) => paid.headers.get(n));
      return { ok: true, evidence: { txHash: settle.transaction || settle.txHash || '', plan: await paid.json() } };
    },
  };
}

export { USDC_CONTRACT, PRICE_ATOMIC, NETWORK };
