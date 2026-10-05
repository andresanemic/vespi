// How a person builds an application that needs x402, from the kernel contract.
//
// Two ways, both shown here, and both with SIMULATED PORTS MARKED AS SUCH: this file opens no
// socket, reads no key, spends nothing and touches no network. It runs as-is with `node examples/
// x402-app.js`.
//
//   1. Your own ports. The kernel ships the contract of the paid effect (src/x402.js) with the
//      network, the signer and the ledger reader left to you. That is the whole integration: you
//      write five functions and a claims store, and the kernel owns the fixed declaration, the
//      order, the deduplication and the receipt verdict.
//   2. The reference bridge. demo/x402/ports.js already implements those ports over the Stellar SDK
//      and the x402 HTTP client. Bring your own spec and the bridge is the whole application.
//
// Both end the same way: an operation whose authority says what may be spent, a human gate, and a
// receipt that says `verified` only when the effect, the authorization, the settlement and the
// delivery were each checked separately.
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { createOperation } = require('../src/operation.js');
const { createX402Payment, createMemoryPaymentClaims } = require('../src/x402.js');

// The Stellar SDK is installed in the demo package, not in the kernel: a require rooted there finds
// it without adding a dependency to this tree.
const demoRequire = createRequire(path.join(__dirname, '..', 'demo', 'x402', 'package.json'));

// ---------------------------------------------------------------------------------------------
// The declaration. This is the fixed effect: exactly this, never a range and never a discount.
// ---------------------------------------------------------------------------------------------
const DECLARED_EFFECT = {
  id: 'example-paid-report',
  url: 'https://reports.example.test/v1/summary',
  method: 'GET',
  network: 'example:local',
  asset: 'ASSET-CONTRACT-OR-CODE',
  grantAsset: 'USD:ASSET',
  payer: 'GPAYER...',
  payTo: 'GRECIPIENT...',
  amount: '2500',
  maxTimeoutSeconds: 300,
};

// ---------------------------------------------------------------------------------------------
// Option 1: your own ports, simulated. Every function below is marked SIMULATED and does no I/O.
// ---------------------------------------------------------------------------------------------
function simulatedPorts({ claims = createMemoryPaymentClaims() } = {}) {
  const authorization = 'BASE64-ENVELOPE-A-SERVER-CANNOT-REUSE';
  const terms = {
    scheme: 'exact',
    network: DECLARED_EFFECT.network,
    asset: DECLARED_EFFECT.asset,
    payTo: DECLARED_EFFECT.payTo,
    amount: DECLARED_EFFECT.amount,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true },
  };

  return {
    claims,
    http: {
      // SIMULATED: ask the service what it charges. No redirect is ever followed.
      discover: async ({ url }) => ({
        status: 402,
        paymentRequired: { x402Version: 2, resource: { url }, accepts: [terms] },
      }),
      // SIMULATED: send the authorization and report what came back.
      sendPaid: async () => ({
        status: 200,
        settlement: { success: true, transaction: 'a'.repeat(64), network: DECLARED_EFFECT.network, payer: DECLARED_EFFECT.payer },
        readBody: async () => ({ title: 'Summary', summary: 'A summary nobody hashed.', deliverables: [], nextSteps: [] }),
      }),
    },
    signer: {
      // SIMULATED: sign. The kernel does not trust this about its own output; a different port reads
      // what came back.
      prepare: async () => ({ authorization }),
    },
    // A separate port, and the one that matters: it re-reads the authorization bytes and compares
    // them with the declaration, not with whatever the signer said about itself.
    inspectPrepared: async () => ({
      verified: true,
      authDigest: createHash('sha256').update(authorization).digest('hex'),
      effect: {
        network: DECLARED_EFFECT.network,
        asset: DECLARED_EFFECT.asset,
        payer: DECLARED_EFFECT.payer,
        payTo: DECLARED_EFFECT.payTo,
        amount: DECLARED_EFFECT.amount,
      },
      checks: { prepared: true, signature: true },
      reason: 'the authorization names the declared effect',
    }),
    // And another separate port, run after the effect, with its own budget and its own cancellation.
    verifySettlement: async () => ({
      verified: true,
      // Only the closed catalog of control names travels onto a sealed receipt, every one of them a
      // boolean, and every one of them true. A name outside the catalog is refused, not carried.
      checks: { invocation: true, authorization: true, transfer: true, payer: true, source: true, exactAmount: true },
      reason: 'the ledger shows the declared effect and nothing else',
    }),
    // Delivery is covered only when the validator returns a digest of the body: a body nobody hashed
    // is not a covered delivery.
    validateOutput: (body) => ({
      ok: Boolean(body) && typeof body === 'object',
      output: body,
      digest: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    }),
  };
}

async function buildWithOwnPorts() {
  const payment = createX402Payment(DECLARED_EFFECT, simulatedPorts());
  const operation = createOperation({
    goal: 'obtain the paid summary',
    // The authority names the recipient. A grant that names somebody else does not authorize this
    // payment, and the operation is blocked before a single port is called.
    authority: { spend: [{ asset: DECLARED_EFFECT.grantAsset, maxAmount: '5000', to: DECLARED_EFFECT.payTo }] },
  });
  return payment.run(operation, {
    // The human gate. A payment without one is not one this kernel makes.
    ask: async (reqs) => ({ approved: reqs.every((r) => r.to === DECLARED_EFFECT.payTo) }),
  });
}

// ---------------------------------------------------------------------------------------------
// Option 2: the reference bridge, composed but not run. It needs the demo's installed
// dependencies, so it is loaded only when it is asked for, and it is never imported by this file's
// default path.
//
// The host brings four things and the bridge brings the Stellar SDK: a spec it declares itself, a
// secret it read itself, a claims store whose life is longer than one call, and the human gate that
// says yes or no. The example refuses to invent any of them: an example that approved its own
// payment, or reused a made-up key, would be showing exactly the behaviour this kernel exists to
// prevent. `example:local` below stays simulated and stays where it is.
// ---------------------------------------------------------------------------------------------
async function buildWithReferenceBridge({ spec, secret, claims, ask, horizonUrl, rpcUrl } = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('buildWithReferenceBridge needs a spec: the effect this application declares');
  }
  if (spec.network !== 'stellar:testnet') {
    throw new Error(`this example is written for stellar:testnet and refuses ${spec.network}`);
  }
  if (typeof secret !== 'string' || !secret) {
    throw new Error('buildWithReferenceBridge needs the payer secret, read by the host and never committed');
  }
  if (!claims || typeof claims.reserveEffect !== 'function' || typeof claims.claimTransaction !== 'function') {
    throw new Error('buildWithReferenceBridge needs an explicit claims store: createMemoryPaymentClaims() for a demo, a durable atomic store for an application that can be recovered');
  }
  if (typeof ask !== 'function') {
    throw new Error('buildWithReferenceBridge needs the human gate as a function: a payment this kernel approves on its own is not one it makes');
  }
  const { Keypair } = demoRequire('@stellar/stellar-sdk');
  const payer = Keypair.fromSecret(secret).publicKey();
  if (spec.payer !== payer) {
    throw new Error('the spec names a payer that this secret does not hold');
  }
  // The bridge is ESM, so it is imported by its own path and not required: this example should not
  // need a Node that can require an ES module to be read.
  const { createStellarPorts } = await import(pathToFileURL(path.join(__dirname, '..', 'demo', 'x402', 'ports.js')).href);
  const ports = createStellarPorts({
    serviceUrl: spec.url,
    payTo: spec.payTo,
    secret,
    claims,
    horizonUrl,
    rpcUrl,
  });
  const payment = createX402Payment(spec, ports);
  const operation = createOperation({
    goal: 'obtain the paid summary',
    authority: { spend: [{ asset: spec.grantAsset, maxAmount: spec.amount, to: spec.payTo }] },
  });
  return payment.run(operation, { ask });
}

async function main() {
  const result = await buildWithOwnPorts();
  console.log(JSON.stringify({
    status: result.status,
    output: result.output,
    // What the receipt says about the money, the effect and the permission that was spent.
    capability: result.receipt.capability,
    authority: result.receipt.authority,
    verification: result.receipt.verification,
    exercised: result.receipt.authority.exercised,
  }, null, 2));

  // `verified` above came from simulated ports: the ports in `simulatedPorts` approved, signed,
  // inspected, settled and hashed without a socket, so that authorization is a simulation and not a
  // decision by a person. With the bridge it comes from the Stellar SDK and a ledger readback, and it
  // is reached only through its own entry point, with everything the host has to supply:
  //
  //   const result = await buildWithReferenceBridge({
  //     spec,                      // the effect this application declares
  //     secret: process.env.CLIENT_SECRET,
  //     claims: myClaimsStore,     // longer-lived than one call
  //     ask: askMyPerson,          // the human gate; this kernel approves nothing on its own
  //     horizonUrl: process.env.STELLAR_HORIZON_URL,
  //     rpcUrl: process.env.STELLAR_RPC_URL,
  //   });
  //
  // The bridge is exercised for real by demo/x402/bridge.test.mjs, against real SDK objects, real
  // signatures and Horizon JSON served on loopback. What that does not cover, and what no test here
  // covers: a live payment, a second provider, and a durable claims store.
}

if (require.main === module) {
  main().catch((error) => {
    console.error('EXAMPLE_FAIL: ' + error.message);
    process.exit(1);
  });
}

module.exports = { buildWithOwnPorts, buildWithReferenceBridge, simulatedPorts, DECLARED_EFFECT };
