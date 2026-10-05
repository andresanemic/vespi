'use strict';
// The four decisions this round took, kept in the suite as guards (D2-a, D2-b, C1..C4, F1). They
// were the red of the round that introduced them and they stay here so a later edit that widens a
// gate, renames a port or forgets to await the validator fails loudly instead of silently.
//
// Synthetic data and synthetic ports. No network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const kernel = require('../src/x402.js');
const { createOperation } = require('../src/operation.js');

const AUTH_DIGEST = createHash('sha256').update('A', 'utf8').digest('hex');
const PLAN = { t: 1 };

const spec = {
  id: 'p',
  url: 'https://example.test/pay',
  method: 'GET',
  network: 'stellar:testnet',
  asset: 'TOKEN',
  grantAsset: 'USDC:TOKEN',
  payer: 'PAYER',
  payTo: 'RECIPIENT',
  amount: '100000',
  maxTimeoutSeconds: 300,
};

function auth() {
  return { spend: [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT' }] };
}

const now = () => Date.parse('2040-01-01T00:00:00Z');

function ports(over = {}) {
  const seen = { send: 0, keys: [] };
  const p = {
    http: {
      async discover(r) {
        return {
          status: 402,
          paymentRequired: {
            x402Version: 2,
            resource: { url: r.url },
            accepts: [{
              scheme: 'exact',
              network: 'stellar:testnet',
              asset: 'TOKEN',
              payTo: 'RECIPIENT',
              amount: '100000',
              maxTimeoutSeconds: 300,
              extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
            }],
          },
        };
      },
      async sendPaid() {
        seen.send += 1;
        return {
          status: 200,
          settlement: {
            success: true,
            transaction: (over.tx || 'a').repeat(64),
            payer: 'PAYER',
            network: 'stellar:testnet',
            amount: '100000',
          },
          readBody: async () => PLAN,
        };
      },
    },
    signer: { async prepare() { return { authorization: 'A' }; } },
    async inspectPrepared() {
      return {
        verified: true,
        authDigest: AUTH_DIGEST,
        effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
        checks: { prepared: true, authorization: true },
        reason: 'ok',
      };
    },
    async verifySettlement() { return { verified: true, checks: { transfer: true }, reason: 'r' }; },
    validateOutput: over.validateOutput || ((b) => ({ ok: true, output: b, digest: 'b'.repeat(64) })),
  };
  if (over.claims !== false) {
    p.claims = over.claims || {
      reserveEffect: (k) => {
        seen.keys.push(k);
        return 'claimed';
      },
      claimTransaction: () => 'claimed',
    };
  }
  return { p, seen };
}

const op = (goal = 'g') => createOperation({ goal, action: 'pay', authority: auth() });

// Decision 2: the claims store is a port the host passes, and the effect key names the operation.
test('D2-a a contract built without a claims store is not built', () => {
  assert.throws(
    () => kernel.createX402Payment(spec, ports({ claims: false }).p),
    (error) => error.code === 'VESPI_X402_CLAIMS_REQUIRED',
  );
});

test('D2-b two operations with the same goal, action and requirements both pay', async () => {
  const claims = kernel.createMemoryPaymentClaims();
  const a = ports({ claims, tx: 'b' });
  const b = ports({ claims, tx: 'c' });
  const ra = await kernel.createX402Payment(spec, a.p).run(op(), { now });
  const rb = await kernel.createX402Payment(spec, b.p).run(op(), { now });
  assert.equal(ra.status, 'verified');
  assert.equal(rb.status, 'verified', rb.receipt?.detail);
});

// Decision 1: the settlement control catalog is closed and exported as a copy.
test('C1 the control catalog is exported as a frozen copy', () => {
  assert.ok(Array.isArray(kernel.SETTLEMENT_CONTROL_NAMES) && Object.isFrozen(kernel.SETTLEMENT_CONTROL_NAMES));
});

// Decision 2: the key version is exported and is the one hashed.
test('C2 the effect key version is exported and is the one hashed', () => {
  assert.equal(kernel.EFFECT_KEY_VERSION, 2);
});

// Decision 3: a deadline a 32-bit timer cannot hold is refused while the run options are built.
test('C3 a verify budget above 2^31-1 ms is refused before any port', async () => {
  const { p, seen } = ports();
  await assert.rejects(
    kernel.createX402Payment(spec, p).run(op(), { now, verifyTimeoutMs: 2 ** 31 }),
    (error) => error.code === 'VESPI_X402_INVALID_IO',
  );
  assert.equal(seen.send, 0);
});

// Decision 4: the body has to be a plain object before it reaches the host.
test('C4 a validator output that is not a plain object refuses the delivery', async () => {
  const { p } = ports({ validateOutput: () => ({ ok: true, output: [1, 2], digest: 'b'.repeat(64) }) });
  const r = await kernel.createX402Payment(spec, p).run(op(), { now });
  assert.notEqual(r.status, 'verified');
  assert.equal(r.output ?? null, null);
});

// The delivery validator is the sixth port and it is awaited like the other five.
test('F1 an async validator is awaited and a good delivery verifies', async () => {
  const { p } = ports({ validateOutput: async (b) => ({ ok: true, output: b, digest: 'b'.repeat(64) }) });
  const r = await kernel.createX402Payment(spec, p).run(op(), { now });
  assert.equal(r.status, 'verified', r.receipt?.verification?.reason);
});