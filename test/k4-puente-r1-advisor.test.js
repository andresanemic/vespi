'use strict';

// The independent reviewer's adversarial suite for the reference bridge, restricted to the cases the
// trimmed bridge still has to answer: ADV11-ADV13 and ADV15-ADV19. The case names keep the
// reviewer's numbering so a verdict can be traced to its source. What is NOT here (ADV01-ADV10,
// ADV14 and ADV20) is either already answered elsewhere in this tree or belongs to a runner surface
// this cut does not carry; test/k4-puente-r2.test.js carries the seven minimal fixes of the second
// review, written for this branch.
//
// WHAT WAS PORTED VERBATIM: the scenarios, the assertions and the failure messages.
// WHAT HAD TO BE ADAPTED, and why:
//   1. The reviewer imported the modules by absolute path; here they are resolved relative to this
//      file, and the Stellar SDK is still required through `demo/x402/package.json`, because the
//      kernel itself has no dependencies and must keep it that way.
//   2. This is a `.js` file in a package with no "type", so it is CommonJS: `ports.js` (ESM) arrives
//      through dynamic `import()`, exactly as the reviewer did.
//   3. The reviewer did not read anything: he proved it. Fix 4 (an explicit claims store) and
//      fix 7 (the real validity window, read from an injectable ledger reader) are changes the
//      advisor himself asked for, so the shared fixtures below pass one claims store and one
//      fixed ledger instead of letting the bridge read a network. ADV04 and ADV18 are adapted as
//      the advisor specified.
//   4. ADV02 is adapted to the explicit argument list fix 9 requires (spec, secret, claims, ask).
//
// No network: `fetch` is swapped for the tests that need one, and the bridge never reads a ledger
// from the network here because every fixture below injects its own reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'demo', 'x402');
const requireDemo = createRequire(path.join(DEMO, 'package.json'));
const { Account, Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr, authorizeEntry } = requireDemo('@stellar/stellar-sdk');
const { createX402Payment, createMemoryPaymentClaims } = require(path.join(ROOT, 'src', 'x402.js'));
const { createOperation } = require(path.join(ROOT, 'src', 'operation.js'));

// ESM, so it is loaded once, by path, before the cases below use it.
const bridgeModules = import(pathToFileURL(path.join(DEMO, 'ports.js')).href);

const payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const payTo = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const FIXTURE_LEDGER = 1000;
const expected = { network: null, payer: payer.publicKey(), payTo, asset: null, amount: null };
const serviceUrl = 'http://127.0.0.1:1/svc';
const realFetch = globalThis.fetch;

async function fixture() {
  const { createStellarPorts, createMarketingPlanPayment, NETWORK, USDC_CONTRACT, PRICE_ATOMIC } = await bridgeModules;
  expected.network = NETWORK;
  expected.asset = USDC_CONTRACT;
  expected.amount = PRICE_ATOMIC;
  terms = termsFor();
  return { createStellarPorts, createMarketingPlanPayment, NETWORK, USDC_CONTRACT, PRICE_ATOMIC };
}

function termsFor({ payTo: recipient, network = null, amount = null } = {}) {
  return {
    scheme: 'exact',
    network: network || expected.network,
    asset: expected.asset,
    payTo: recipient || payTo,
    amount: amount || expected.amount,
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true },
  };
}

let terms = null;
const plan = { title: 'Report', summary: 'Summary', deliverables: [], nextSteps: [] };

// A real Ed25519 authorization over the SDK preimage for this network, wrapped in a real base64 XDR
// envelope: the same shape a ledger verifies.
async function envelope({ recipient = payTo, expiration = 1050, badSignature = false } = {}) {
  const args = [
    nativeToScVal(payer.publicKey(), { type: 'address' }),
    nativeToScVal(recipient, { type: 'address' }),
    nativeToScVal(expected.amount, { type: 'i128' }),
  ];
  const fn = new xdr.InvokeContractArgs({ contractAddress: Address.fromString(expected.asset).toScAddress(), functionName: 'transfer', args });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: Address.fromString(payer.publicKey()).toScAddress(),
      nonce: new xdr.Int64(1),
      signatureExpirationLedger: expiration,
      signature: xdr.ScVal.scvVec([]),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),
      subInvocations: [],
    }),
  });
  let signed;
  if (badSignature) {
    entry.credentials().address().signature(xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.alloc(1))]));
    signed = entry;
  } else {
    signed = await authorizeEntry(entry, payer, expiration, Networks.TESTNET);
  }
  return new TransactionBuilder(new Account(payer.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(fn), auth: [signed] }))
    .setTimebounds(0, 2000000000).build().toXDR();
}

// One bridge, wired the way a host has to wire it: an explicit claims store, an explicit ledger
// reader, and the payload builder replaced (see the header of demo/x402/ports.js).
function ports(createStellarPorts, builder, opts = {}) {
  return createStellarPorts({
    serviceUrl,
    payTo,
    secret: payer.secret(),
    claims: opts.claims || createMemoryPaymentClaims(),
    readCurrentLedger: opts.readCurrentLedger || (async () => FIXTURE_LEDGER),
    createPaymentPayload: builder,
    horizonUrl: 'http://127.0.0.1:1',
    ...opts,
  });
}

async function prepared(createStellarPorts, opts = {}) {
  const transaction = await envelope(opts);
  const payload = { x402Version: 2, payload: { transaction } };
  const bridge = ports(createStellarPorts, async () => payload, opts);
  const answer = await bridge.signer.prepare({ terms, expected });
  return { bridge, payload, ...answer };
}

async function withFetch(fn, body) {
  globalThis.fetch = fn;
  try {
    return await body();
  } finally {
    globalThis.fetch = realFetch;
  }
}

function paid(bridge, authorization, signal) {
  return bridge.http.sendPaid({ url: serviceUrl, authorization, idempotencyKey: 'adv-key', signal });
}

// The reference example is the host-facing half of this surface (fix 9). It is required by path and
// only where a case needs it, so a missing example fails the case that names it rather than the
// whole file.
function exampleRef() {
  return require(path.join(ROOT, 'examples', 'x402-app.js'));
}

// ADV11 — nothing an SDK or a port writes on its way out may reach a sealed receipt.
test('ADV11 SDK exceptions do not leak into kernel receipt', async () => {
  const { createStellarPorts } = await fixture();
  const spec = { id: 'adv-fail', url: serviceUrl, method: 'GET', ...expected, grantAsset: 'USDC:adv', maxTimeoutSeconds: 300 };
  const bridge = ports(createStellarPorts, async () => { throw new Error('SYNTHETIC_PRIVATE_MARKER'); });
  await withFetch(async () => new Response('{}', {
    status: 402,
    headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: serviceUrl }, accepts: [terms] })).toString('base64') },
  }), async () => {
    const result = await createX402Payment(spec, bridge).run(
      createOperation({ authority: { spend: [{ asset: 'USDC:adv', maxAmount: expected.amount, to: payTo }] } }),
      { ask: async () => ({ approved: true }) },
    );
    assert.notEqual(result.status, 'verified');
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  });
});

// ADV12 — the recipient the declaration names is read independently, not taken from the signer.
test('ADV12 mismatched recipient fails independent inspection', async () => {
  const { createStellarPorts } = await fixture();
  const { bridge, authorization } = await prepared(createStellarPorts, { recipient: other });
  assert.equal((await bridge.inspectPrepared(authorization, { expected })).verified, false);
});

// ADV13 — a settlement header that cannot be decoded is no evidence at all.
test('ADV13 malformed settlement header cannot fabricate evidence', async () => {
  const { createStellarPorts } = await fixture();
  const { bridge, authorization } = await prepared(createStellarPorts);
  await withFetch(async () => new Response('{}', { headers: { 'payment-response': 'not-json' } }), async () => {
    assert.equal((await paid(bridge, authorization)).settlement, null);
  });
});

// ADV15 — a factory that declares one network refuses a bridge configured for another one.
test('ADV15 testnet marketing factory rejects a mainnet bridge configuration', async () => {
  const { createMarketingPlanPayment } = await fixture();
  assert.throws(() => createMarketingPlanPayment({
    serviceUrl, payTo, secret: payer.secret(), claims: createMemoryPaymentClaims(), network: 'stellar:pubnet',
  }), /network|testnet/i);
});

// ADV16 — the claims store the host hands the bridge is what deduplicates, for every run of it.
test('ADV16 shared claims prevent sending the same kernel operation twice', async () => {
  const example = exampleRef();
  const p = example.simulatedPorts({ claims: createMemoryPaymentClaims() });
  let sends = 0;
  const old = p.http.sendPaid;
  p.http.sendPaid = async (...args) => { sends++; return old(...args); };
  const payment = createX402Payment(example.DECLARED_EFFECT, p);
  const op = createOperation({ authority: { spend: [{ asset: example.DECLARED_EFFECT.grantAsset, maxAmount: '5000', to: example.DECLARED_EFFECT.payTo }] } });
  const io = { ask: async () => ({ approved: true }) };
  await payment.run(op, io);
  await payment.run(op, io);
  assert.equal(sends, 1);
});

// ADV17 — the network is part of what was signed, so an authorization made for mainnet is not a
// verified testnet preparation.
test('ADV17 authorization signed for mainnet cannot be inspected as testnet', async () => {
  const { createStellarPorts } = await fixture();
  // Decode a legitimate testnet entry, reauthorize its invocation for mainnet with the real SDK,
  // then put those credentials into a transaction labelled with the testnet passphrase.
  const tx = TransactionBuilder.fromXDR(await envelope(), Networks.TESTNET);
  const wrong = await authorizeEntry(tx.operations[0].auth[0], payer, 1050, Networks.PUBLIC);
  const raw = new TransactionBuilder(new Account(payer.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: tx.operations[0].func, auth: [wrong] }))
    .setTimebounds(0, 2000000000).build().toXDR();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }));
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  assert.equal((await bridge.inspectPrepared(authorization, { expected })).verified, false, 'mainnet Ed25519 authorization was called a verified testnet preparation');
});

// ADV18 — two bridges in one process, one claims store: the same operation is not paid twice.
test('ADV18 rebuilding the bridge within one process cannot resend the same operation', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  const spec = { id: 'adv-rebuild', url: serviceUrl, method: 'GET', ...expected, grantAsset: 'USDC:adv', maxTimeoutSeconds: 300 };
  const op = createOperation({ authority: { spend: [{ asset: spec.grantAsset, maxAmount: expected.amount, to: payTo }] } });
  let sends = 0;
  const recovered = JSON.parse(JSON.stringify(op));
  // One claims store for the life of the process, which is what the host has to hand the bridge.
  const claims = createMemoryPaymentClaims();
  const make = () => {
    const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }), { claims });
    bridge.verifySettlement = async () => ({ verified: false, checks: { transfer: false }, reason: 'not read from a ledger' });
    return createX402Payment(spec, bridge);
  };
  await withFetch(async (_u, o) => {
    if (o.headers) {
      sends++;
      return new Response(JSON.stringify(plan), {
        headers: { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: 'a'.repeat(64), network: expected.network, payer: payer.publicKey() })).toString('base64') },
      });
    }
    return new Response('{}', {
      status: 402,
      headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: serviceUrl }, accepts: [terms] })).toString('base64') },
    });
  }, async () => {
    await make().run(op, { ask: async () => ({ approved: true }) });
    await make().run(recovered, { ask: async () => ({ approved: true }) });
  });
  assert.equal(sends, 1, 'two bridge factories have independent default claims and send the same operation twice');
});

test('ADV18b the reference bridge is not built without an explicit claims store', async () => {
  const { createStellarPorts } = await fixture();
  assert.throws(() => createStellarPorts({
    serviceUrl, payTo, secret: payer.secret(), horizonUrl: 'http://127.0.0.1:1',
  }), /claims/i);
});

// ADV19 — cancelling an in-flight paid body stops the stream, it does not merely stop reading it.
test('ADV19 cancelling an in-flight paid body actually stops its stream', async () => {
  const { createStellarPorts } = await fixture();
  const { bridge, authorization } = await prepared(createStellarPorts);
  let controller;
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } });
  await withFetch(async () => new Response(stream), async () => {
    const r = await paid(bridge, authorization);
    const c = new AbortController();
    const read = r.readBody(c.signal).then(() => 'fulfilled', () => 'rejected');
    c.abort();
    const outcome = await Promise.race([read, new Promise((resolve) => setTimeout(() => resolve('still pending'), 30))]);
    // Always close the synthetic stream so a red assertion leaves no resources running.
    if (!cancelled) { controller.enqueue(new TextEncoder().encode(JSON.stringify(plan))); controller.close(); }
    await read;
    assert.equal(outcome, 'rejected', 'aborted paid body remained pending');
    assert.equal(cancelled, true);
  });
});