// F5e TDD: a Horizon response that resolves to a malformed shape (null) must stay
// inside the closed settlement vocabulary. The SDK reports a successful HTTP call,
// so verifySettlement cannot rely on a rejected promise - it has to validate the
// shape of what arrived and convert it to a closed failure, never a raw TypeError.
const { test } = require('node:test');
const assert = require('node:assert');

const NETWORK = 'stellar:testnet';
const USDC_CONTRACT = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2WWFEIE3USCIHMXQDAMA';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const TX_HASH = 'a'.repeat(64);

// `verifySettlement` lives in the demo (ESM); the kernel proper keeps no settlement
// reader of its own. The contract calls the port the host supplies, and this is the
// reference port the bridge installs.
async function load() {
  const mod = await import('../demo/x402/settlement.js');
  return mod.verifySettlement;
}

test('F5e a Horizon transaction read that resolves to null returns a closed failure, never a raw TypeError', async () => {
  const verifySettlement = await load();
  // A Horizon double whose `.call()` resolves to null: the HTTP call succeeded, the
  // SDK parsed, and the record is absent or malformed. This is the shape boundary
  // the closed vocabulary has to contain.
  const horizon = { transactions: () => ({ transaction: () => ({ call: async () => null }) }) };
  const result = await verifySettlement(
    { txHash: TX_HASH, payer: 'G-PAYER', network: NETWORK, authDigest: 'b'.repeat(64) },
    { horizon, payer: 'G-PAYER', payTo: 'G-RECIPIENT', issuer: ISSUER, assetContract: USDC_CONTRACT },
  );
  assert.equal(result.verified, false);
  assert.equal(typeof result.reason, 'string');
  // The reason is ours, not the SDK's: no `Cannot read properties` and no host text.
  assert.ok(!result.reason.includes('Cannot read properties'), 'no raw TypeError leaks');
  assert.ok(!/horizon|sdk|fetch/i.test(result.reason), 'no host text in the reason');
});

test('F5e a Horizon operation page read that resolves to null also stays closed', async () => {
  const verifySettlement = await load();
  // The transaction read succeeds, but the operation page read resolves to null.
  // The same shape boundary applies to every Horizon round trip.
  let callCount = 0;
  const horizon = {
    transactions: () => ({
      transaction: () => ({
        call: async () => {
          callCount += 1;
          return {
            hash: TX_HASH,
            successful: true,
            ledger_attr: 1000,
            ledger: () => ({}),
            envelope_xdr: 'AAAA',
          };
        },
      }),
    }),
    operations: () => ({
      forTransaction: () => ({ call: async () => null }),
      operation: () => ({ call: async () => null }),
    }),
  };
  const result = await verifySettlement(
    { txHash: TX_HASH, payer: 'G-PAYER', network: NETWORK, authDigest: 'b'.repeat(64) },
    { horizon, payer: 'G-PAYER', payTo: 'G-RECIPIENT', issuer: ISSUER, assetContract: USDC_CONTRACT },
  );
  assert.equal(result.verified, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(!result.reason.includes('Cannot read properties'), 'no raw TypeError leaks on page read');
});
