// The x402 contract bridge (demo/x402/ports.js) exercised against real SDK objects.
//
// What is real here: the Stellar SDK 16 classes (Keypair, Address, StrKey, TransactionBuilder,
// Transaction, Operation, xdr), the real Ed25519 authorization signature produced by
// `basicNodeSigner` (the same function `@x402/stellar`'s `createEd25519Signer` wraps), real
// base64 XDR envelopes, the real `@x402/fetch` HTTP client (header encoding and decoding), the
// real `Horizon.Server` parsing real Horizon JSON, and the real `settlement.js` reader.
//
// What is NOT real: no live payment. The Soroban RPC of `ExactStellarScheme` cannot be emulated
// without a ledger, so the payload builder is the one injection point this file uses, and it
// returns a payload assembled by the same SDK calls the scheme makes. Everything downstream of the
// payload (the fee rewrite, the inspection, the ledger readback, the delivery) is the bridge's
// own code running for real.
//
// No network: `fetch` is wrapped below so anything that is not loopback is refused outright. If a
// port ever reached for the internet, these tests would fail instead of quietly paying.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  Account, Address, Keypair, Networks, Operation, TransactionBuilder, buildAuthorizationEntryPreimage, nativeToScVal, xdr,
} from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import { basicNodeSigner } from '@stellar/stellar-sdk/contract';
import { createRequire } from 'node:module';
import { NETWORK, PRICE_ATOMIC, USDC_CONTRACT, createMarketingPlanPayment, createStellarPorts } from './ports.js';

const require = createRequire(import.meta.url);
const { createOperation } = require('../../src/operation.js');
const { createMemoryPaymentClaims } = require('../../src/x402.js');

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const realFetch = globalThis.fetch;
const offLoopbackAttempts = [];
globalThis.fetch = (input, init) => {
  const href = typeof input === 'string' ? input : (input?.url ?? String(input));
  let host = '';
  try { host = new URL(href).hostname; } catch { host = ''; }
  if (!LOOPBACK.has(host)) {
    offLoopbackAttempts.push(href);
    return Promise.reject(new Error('bridge tests refuse to leave loopback'));
  }
  return realFetch(input, init);
};

const b64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const PLAN = {
  service: 'marketing-plan',
  paid: true,
  title: 'Queen Marketing Plan',
  summary: 'A 90-day plan.',
  deliverables: ['Landing page A/B test'],
  nextSteps: ['Launch week 1'],
};

// A real signed Soroban transfer authorization, assembled with the SDK calls `@x402/stellar` makes:
// nativeToScVal args, an InvokeContractArgs host function, an unsigned auth entry, the SDK's own
// authorization preimage for this network hashed by basicNodeSigner, and the signature placed in the
// scvVec as the public_key/signature map that an Ed25519 account entry carries. Real Soroban
// transaction data around it.
//
// The network id is the sha256 of the public testnet passphrase: a constant of the network, not a
// secret of the test, and the reason the fixture below carries it inside itself. `D1b` checks the
// constant against the SDK's own preimage builder, and every case that reaches `inspectPrepared` with
// verified true would fail if it were wrong, because the bridge verifies that signature the way a
// ledger would.
async function signedTransfer({ payerKeypair, payTo, amount = PRICE_ATOMIC, asset = USDC_CONTRACT, expiration = 1050, subInvocations = [] }) {
  const TESTNET_NETWORK_ID = 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472';
  const args = [
    nativeToScVal(payerKeypair.publicKey(), { type: 'address' }),
    nativeToScVal(payTo, { type: 'address' }),
    nativeToScVal(amount, { type: 'i128' }),
  ];
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(asset).toScAddress(),
    functionName: 'transfer',
    args,
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations,
  });
  const unsigned = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: Address.fromString(payerKeypair.publicKey()).toScAddress(),
      nonce: new xdr.Int64(0n),
      signatureExpirationLedger: expiration,
      signature: xdr.ScVal.scvVec([]),
    })),
    rootInvocation: invocation,
  });
  // The preimage the SDK builds for this entry and this network, hashed by the signer: the payload a
  // ledger verifies is sha256 of exactly these bytes.
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
    networkId: Buffer.from(TESTNET_NETWORK_ID, 'hex'),
    nonce: unsigned.credentials().address().nonce(),
    invocation,
    signatureExpirationLedger: expiration,
  }));
  const { signedAuthEntry } = await basicNodeSigner(payerKeypair, Networks.TESTNET).signAuthEntry(preimage.toXDR('base64'));
  const signature = xdr.ScVal.scvVec([xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('public_key'), val: xdr.ScVal.scvBytes(payerKeypair.rawPublicKey()) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signature'), val: xdr.ScVal.scvBytes(Buffer.from(signedAuthEntry, 'base64')) }),
  ])]);
  const signed = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: Address.fromString(payerKeypair.publicKey()).toScAddress(),
      nonce: new xdr.Int64(0n),
      signatureExpirationLedger: expiration,
      signature,
    })),
    rootInvocation: invocation,
  });
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [signed],
  });
  const transaction = new TransactionBuilder(new Account(payerKeypair.publicKey(), '0'), {
    fee: '1', networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setSorobanData(new xdr.SorobanTransactionData({
      ext: new xdr.SorobanTransactionDataExt(0),
      resources: new xdr.SorobanResources({
        footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
        instructions: 1,
        diskReadBytes: 100,
        writeBytes: 100,
      }),
      resourceFee: new xdr.Int64(100),
      auth: [signed],
    }).toXDR('base64'))
    .setTimeout(300)
    .build();
  return transaction.toXDR();
}

// One loopback server for all three roles the bridge talks to: the paid service, and Horizon.
async function startWorld({ terms, settle, body = PLAN, horizonPatch = {}, ledger = 1000 } = {}) {
  const state = { horizonReads: 0, serviceReads: 0, paidReads: 0, terms, settle, body, horizonPatch, ledger };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, payload, headers = {}) => {
      const bodyText = typeof payload === 'string' ? payload : JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(bodyText);
    };
    if (url.pathname === '/svc') {
      state.serviceReads++;
      if (!req.headers['payment-signature']) {
        if (state.discoveryStatus && state.discoveryStatus !== 402) {
          return send(state.discoveryStatus, state.body);
        }
        // `termsRaw` is written into the header verbatim, so a header that is not base64 of a
        // payment-required document can be exercised.
        return send(402, { error: 'payment required' }, { 'payment-required': state.termsRaw ?? b64(state.terms) });
      }
      state.paidReads++;
      return send(200, state.body, state.settleRaw ? { 'payment-response': state.settleRaw } : (state.settle ? { 'payment-response': b64(state.settle) } : {}));
    }
    // Horizon: /transactions/{hash}, /transactions/{hash}/operations, /operations/{id}
    const tx = url.pathname.match(/^\/transactions\/([a-f0-9]{64})$/);
    if (tx) {
      state.horizonReads++;
      return send(200, {
        hash: tx[1],
        successful: true,
        ledger_attr: state.ledger,
        ledger: () => ({}),
        envelope_xdr: state.envelope,
        ...state.horizonPatch.transaction,
      });
    }
    if (/^\/transactions\/[a-f0-9]{64}\/operations$/.test(url.pathname)) {
      state.horizonReads++;
      return send(200, { records: [{ id: 'op-1' }], _links: {} });
    }
    if (/^\/operations\/[^/]+$/.test(url.pathname)) {
      state.horizonReads++;
      return send(200, { asset_balance_changes: state.changes });
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { state, base, serviceUrl: `${base}/svc`, horizonUrl: base, close: () => server.close() };
}

function termsFor(serviceUrl, { payTo, amount = PRICE_ATOMIC, extra = { areFeesSponsored: true, paymentFlow: 'authorization' } } = {}) {
  return {
    x402Version: 2,
    resource: { url: serviceUrl },
    accepts: [{
      scheme: 'exact', network: NETWORK, asset: USDC_CONTRACT, payTo,
      amount, maxTimeoutSeconds: 300, extra,
    }],
  };
}

function settleFor({ payer, payTo, txHash, amount = PRICE_ATOMIC }) {
  return { success: true, transaction: txHash, network: NETWORK, payer, amount, payTo, asset: USDC_CONTRACT };
}

const TX_HASH = 'a'.repeat(64);
const usdcChange = (overrides = {}) => ({
  asset_code: 'USDC', asset_issuer: ISSUER, from: USDC_CONTRACT, amount: '0.0100000', ...overrides,
});

// A bridge wired to a loopback world, with the payload builder replaced by the SDK calls the
// Stellar scheme makes (see the header: no live payment here).
async function bridge(world, { payerKeypair, payTo, createPaymentPayload, claims, horizonUrl } = {}) {
  const transaction = await signedTransfer({ payerKeypair, payTo });
  world.state.envelope = transaction;
  const payload = createPaymentPayload || (async () => ({ x402Version: 2, payload: { transaction } }));
  const store = claims || createMemoryPaymentClaims();
  const ports = createStellarPorts({
    serviceUrl: world.serviceUrl,
    payTo,
    secret: payerKeypair.secret(),
    claims: store,
    horizonUrl: horizonUrl || world.horizonUrl,
    // The ledger of right now, answered by the fixture world: nothing in this file reaches an RPC.
    readCurrentLedger: async () => world.state.ledger,
    createPaymentPayload: payload,
  });
  return { ports, claims: store, createPaymentPayload: payload };
}

const expectedFor = (payer, payTo) => ({
  network: NETWORK, asset: USDC_CONTRACT, payer, payTo, amount: PRICE_ATOMIC,
});

// Prepare, then publish the finalized envelope the way Horizon would: the ledger answers with the
// transaction that was actually authorized, which is the rewritten one, not the pre-rewrite payload.
async function prepareAndInspect(ports, world, expected) {
  const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
  world.state.envelope = authorization;
  const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
  return { authorization, verdict };
}

// =====================================================================================
// Group A ÔÇö the factory refuses what cannot pay, before any I/O
// =====================================================================================

test('A1 the bridge refuses a recipient that is not a Stellar public key', () => {
  assert.throws(() => createStellarPorts({ serviceUrl: 'http://127.0.0.1:1/svc', payTo: 'NOT-A-KEY', secret: Keypair.random().secret() }), /public key/);
});

test('A2 the bridge refuses to be built without a signer secret', () => {
  assert.throws(() => createStellarPorts({ serviceUrl: 'http://127.0.0.1:1/svc', payTo: Keypair.random().publicKey(), secret: '' }), /CLIENT_SECRET/);
});

// =====================================================================================
// Group B ÔÇö discovery against a real 402 with a real PAYMENT-REQUIRED header
// =====================================================================================

test('B1 discovery decodes the 402 terms the kernel then selects, from a real header', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const found = await ports.http.discover({ url: world.serviceUrl, method: 'GET', redirect: 'error' });
    assert.equal(found.status, 402);
    assert.equal(found.paymentRequired.x402Version, 2);
    assert.equal(found.paymentRequired.resource.url, world.serviceUrl);
    assert.equal(found.paymentRequired.accepts[0].amount, PRICE_ATOMIC);
    assert.equal(found.paymentRequired.accepts[0].payTo, payTo);
  } finally { world.close(); }
});

test('B2 discovery reports a status and no terms when the service answers 200', async () => {
  const payTo = Keypair.random().publicKey();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    world.state.discoveryStatus = 200;
    const { ports } = await bridge(world, { payerKeypair: Keypair.random(), payTo });
    const found = await ports.http.discover({ url: world.serviceUrl, method: 'GET', redirect: 'error' });
    assert.equal(found.status, 200);
    assert.equal(found.paymentRequired, undefined);
  } finally { world.close(); }
});

test('B3 a 402 whose payment header is unreadable yields no terms and no throw', async () => {
  const payTo = Keypair.random().publicKey();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair: Keypair.random(), payTo });
    // A header that is not base64 of a payment-required document.
    world.state.termsRaw = 'not base64 and not JSON **';
    const found = await ports.http.discover({ url: world.serviceUrl, method: 'GET', redirect: 'error' });
    assert.equal(found.status, 402);
    assert.equal(found.paymentRequired, undefined);
  } finally { world.close(); }
});

test('B4 discovery refuses a redirect and refuses a method that is not GET', async () => {
  const payTo = Keypair.random().publicKey();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair: Keypair.random(), payTo });
    await assert.rejects(ports.http.discover({ url: world.serviceUrl, method: 'GET', redirect: 'follow' }), /redirect/);
    await assert.rejects(ports.http.discover({ url: world.serviceUrl, method: 'POST', redirect: 'error' }), /GET/);
  } finally { world.close(); }
});

// =====================================================================================
// Group C ÔÇö preparation: the payload is rewritten, kept, and tied to what was inspected
// =====================================================================================

test('C1 prepare returns the authorization and rewrites the fee while keeping the Soroban data', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const prepared = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    assert.equal(typeof prepared.authorization, 'string');
    assert.ok(prepared.authorization.length > 0);
    // The envelope the bridge hands on is the one the payload carried, Soroban data and all.
    const envelope = TransactionBuilder.fromXDR(prepared.authorization, Networks.TESTNET);
    assert.ok(envelope.toEnvelope().v1()?.tx()?.ext()?.sorobanData(), 'the sponsored Soroban data survived');
    assert.equal(envelope.operations.length, 1);
    assert.equal(envelope.operations[0].type, 'invokeHostFunction');
    assert.equal(envelope.fee > 1, true, 'the resource fee is added to the sponsored fee');
  } finally { world.close(); }
});

test('C2 prepare hands back exactly the payload the signer built, not a second transaction', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    let built = 0;
    const { ports } = await bridge(world, {
      payerKeypair,
      payTo,
      createPaymentPayload: async () => {
        built++;
        return { x402Version: 2, payload: { transaction: await signedTransfer({ payerKeypair, payTo }) } };
      },
    });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const prepared = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    assert.equal(built, 1, 'the signer built one payload');
    const sent = await ports.http.sendPaid({
      url: world.serviceUrl, method: 'GET', redirect: 'error',
      authorization: prepared.authorization, terms: world.state.terms.accepts[0],
      idempotencyKey: 'effect-key', signal: null,
    });
    assert.equal(sent.status, 200);
    assert.equal(built, 1, 'the paid request did not build a second payload');
  } finally { world.close(); }
});

test('C3 a cancelled signal stops preparation before anything is signed', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      ports.signer.prepare({ terms: world.state.terms.accepts[0], expected: expectedFor(payerKeypair.publicKey(), payTo), signal: controller.signal }),
      /aborted/,
    );
  } finally { world.close(); }
});

// =====================================================================================
// Group D ÔÇö inspection: a real signed envelope, read back as XDR
// =====================================================================================

test('D1 inspection clears a real signed authorization for the declared effect', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
    assert.equal(verdict.verified, true);
    assert.match(verdict.authDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(verdict.effect, expected);
    assert.equal(verdict.checks.prepared, true);
    for (const value of Object.values(verdict.checks)) assert.equal(typeof value, 'boolean');
  } finally { world.close(); }
});

test('D1b the fixture authorization verifies against the SDK preimage, signed for this network', async () => {
  // The fixture above carries the network id of the testnet passphrase as a constant. This checks it
  // against the SDK's own preimage builder and then verifies the signature the fixture produced over
  // exactly that preimage, so "real SDK signature" in this file is a checked claim and not a name.
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const raw = await signedTransfer({ payerKeypair, payTo });
  const tx = TransactionBuilder.fromXDR(raw, Networks.TESTNET);
  const entry = tx.operations[0].auth[0];
  const node = entry.credentials().address();
  const preimage = buildAuthorizationEntryPreimage(entry, node.signatureExpirationLedger(), Networks.TESTNET);
  const networkId = preimage.sorobanAuthorization().networkId();
  assert.equal(Buffer.from(networkId).toString('hex'), createHash('sha256').update(Networks.TESTNET, 'utf8').digest('hex'));
  const first = node.signature().vec()[0];
  assert.equal(first.switch().name, 'scvMap');
  const fields = new Map(first.map().map((item) => [item.key().sym().toString(), item.val().bytes()]));
  assert.equal(fields.get('public_key').length, 32);
  assert.equal(fields.get('signature').length, 64);
  const payload = createHash('sha256').update(preimage.toXDR()).digest();
  assert.equal(Keypair.fromPublicKey(payerKeypair.publicKey()).verify(payload, fields.get('signature')), true);
  // And the same entry read as mainnet does not verify: the network is part of what was signed.
  const mainnetPreimage = buildAuthorizationEntryPreimage(entry, node.signatureExpirationLedger(), Networks.PUBLIC);
  const mainnetPayload = createHash('sha256').update(mainnetPreimage.toXDR()).digest();
  assert.equal(Keypair.fromPublicKey(payerKeypair.publicKey()).verify(mainnetPayload, fields.get('signature')), false);
});

test('D2 inspection refuses an authorization signed for another recipient', async () => {
  const payTo = Keypair.random().publicKey();
  const otherRecipient = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    // The signer builds for a recipient the declaration does not name.
    let envelope = null;
    const { ports } = await bridge(world, {
      payerKeypair,
      payTo,
      createPaymentPayload: async () => {
        envelope = await signedTransfer({ payerKeypair, payTo: otherRecipient });
        return { x402Version: 2, payload: { transaction: envelope } };
      },
    });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
    assert.equal(verdict.verified, false);
  } finally { world.close(); }
});

test('D3 inspection refuses an authorization for a larger amount', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, {
      payerKeypair,
      payTo,
      createPaymentPayload: async () => ({
        x402Version: 2,
        payload: { transaction: await signedTransfer({ payerKeypair, payTo, amount: '200000' }) },
      }),
    });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
    assert.equal(verdict.verified, false);
  } finally { world.close(); }
});

test('D4 inspection refuses an authorization with sub-invocations', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, {
      payerKeypair,
      payTo,
      createPaymentPayload: async () => ({
        x402Version: 2,
        payload: { transaction: await signedTransfer({ payerKeypair, payTo, subInvocations: [new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(USDC_CONTRACT).toScAddress(), functionName: 'transfer', args: [] })), subInvocations: [] })] }) },
      }),
    });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
    assert.equal(verdict.verified, false);
  } finally { world.close(); }
});

// =====================================================================================
// Group E ÔÇö the paid send: headers, body, and the association with what was inspected
// =====================================================================================

test('E1 the paid request carries the x402 signature header and the idempotency hint', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER'), settle: settleFor({ payer: 'P', payTo, txHash: TX_HASH }) });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    let seen = null;
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    world.state.settle = settleFor({ payer: payerKeypair.publicKey(), payTo, txHash: TX_HASH });
    const sent = await ports.http.sendPaid({
      url: world.serviceUrl, method: 'GET', redirect: 'error', authorization,
      terms: world.state.terms.accepts[0], idempotencyKey: 'effect-1', signal: null,
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.settlement.success, true);
    assert.equal(sent.settlement.transaction, TX_HASH);
    assert.equal(typeof sent.readBody, 'function');
    assert.deepEqual(await sent.readBody(), PLAN);
    seen = world.state.paidReads;
    assert.equal(seen, 1);
  } finally { world.close(); }
});

test('E2 the paid request refuses an authorization that was not the one prepared', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    // A different, equally valid authorization: the bridge must send the one it inspected.
    const other = await signedTransfer({ payerKeypair, payTo, expiration: 1049 });
    assert.notEqual(other, authorization);
    await assert.rejects(ports.http.sendPaid({
      url: world.serviceUrl, method: 'GET', redirect: 'error',
      authorization: other,
      terms: world.state.terms.accepts[0], idempotencyKey: 'k', signal: null,
    }), /authorization that was inspected/);
    assert.equal(world.state.paidReads, 0, 'nothing was sent');
  } finally { world.close(); }
});

test('E3 a settlement header that cannot be decoded leaves the settlement empty instead of throwing', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    world.state.settleRaw = 'not base64 and not JSON **';
    const sent = await ports.http.sendPaid({
      url: world.serviceUrl, method: 'GET', redirect: 'error', authorization,
      terms: world.state.terms.accepts[0], idempotencyKey: 'k', signal: null,
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.settlement, null);
  } finally { world.close(); }
});

test('E4 a paid body larger than the bound is refused instead of parsed', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    world.state.body = { ...PLAN, filler: 'x'.repeat(1024 * 1024 + 16) };
    const sent = await ports.http.sendPaid({
      url: world.serviceUrl, method: 'GET', redirect: 'error', authorization,
      terms: world.state.terms.accepts[0], idempotencyKey: 'k', signal: null,
    });
    await assert.rejects(sent.readBody(), /too large/);
  } finally { world.close(); }
});

// =====================================================================================
// Group F ÔÇö the settlement reader, over real Horizon JSON and a real Horizon.Server
// =====================================================================================

test('F1 the settlement port reads a Horizon fixture served on loopback: one transaction with one USDC change', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { verdict } = await prepareAndInspect(ports, world, expected);
    world.state.changes = [usdcChange({ to: payTo })];
    world.state.ledger = 1000;
    const settlement = await ports.verifySettlement(
      { txHash: TX_HASH, payer: payerKeypair.publicKey(), network: NETWORK, authDigest: verdict.authDigest },
      { expected, authDigest: verdict.authDigest, signal: null },
    );
    assert.equal(world.state.horizonReads, 3, 'transaction, operation page and operation were read');
    assert.equal(settlement.verified, true);
    for (const value of Object.values(settlement.checks)) assert.equal(typeof value, 'boolean');
    assert.equal(settlement.checks.exactAmount, true);
    assert.equal(settlement.checks.transfer, true);
  } finally { world.close(); }
});

test('F2 a settlement whose transaction failed is refused', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { authorization } = await ports.signer.prepare({ terms: world.state.terms.accepts[0], expected, signal: null });
    const verdict = await ports.inspectPrepared(authorization, { expected, signal: null });
    world.state.horizonPatch = { transaction: { successful: false } };
    world.state.changes = [usdcChange({ to: payTo })];
    const settlement = await ports.verifySettlement(
      { txHash: TX_HASH, payer: payerKeypair.publicKey(), network: NETWORK, authDigest: verdict.authDigest },
      { expected, authDigest: verdict.authDigest, signal: null },
    );
    assert.equal(settlement.verified, false);
    assert.ok(world.state.horizonReads > 0, 'the ledger was consulted before the refusal');
  } finally { world.close(); }
});

test('F3 a settlement that moves more than the declared amount is refused', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { verdict } = await prepareAndInspect(ports, world, expected);
    world.state.changes = [usdcChange({ to: payTo, amount: '0.0200000' })];
    const settlement = await ports.verifySettlement(
      { txHash: TX_HASH, payer: payerKeypair.publicKey(), network: NETWORK, authDigest: verdict.authDigest },
      { expected, authDigest: verdict.authDigest, signal: null },
    );
    assert.equal(settlement.verified, false);
  } finally { world.close(); }
});

test('F4 a settlement whose envelope carries a different authorization digest is refused', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair, payTo });
    const expected = expectedFor(payerKeypair.publicKey(), payTo);
    const { verdict } = await prepareAndInspect(ports, world, expected);
    world.state.changes = [usdcChange({ to: payTo })];
    const settlement = await ports.verifySettlement(
      { txHash: TX_HASH, payer: payerKeypair.publicKey(), network: NETWORK, authDigest: 'b'.repeat(64) },
      { expected, authDigest: verdict.authDigest, signal: null },
    );
    assert.equal(settlement.verified, false);
  } finally { world.close(); }
});

// =====================================================================================
// Group G ÔÇö the delivery validator
// =====================================================================================

test('G1 the delivery validator digests a marketing plan and refuses anything else', async () => {
  const payTo = Keypair.random().publicKey();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(world.serviceUrl, { payTo });
    const { ports } = await bridge(world, { payerKeypair: Keypair.random(), payTo });
    const ok = ports.validateOutput(PLAN);
    assert.equal(ok.ok, true);
    assert.match(ok.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(ok.output, PLAN);
    for (const body of [null, {}, { title: 'only' }, 'text', [PLAN], { ...PLAN, deliverables: [1] }]) {
      assert.equal(ports.validateOutput(body).ok, false, `refused ${JSON.stringify(body)?.slice(0, 40)}`);
    }
  } finally { world.close(); }
});

// =====================================================================================
// Group H ÔÇö one payment end to end through the kernel contract
// =====================================================================================

// The composed factory appends the service query, so the 402 has to name the declared resource.
const endpointOf = (world) => `${world.base}/svc?service=marketing-plan`;

async function runPayment({ world, payTo, payerKeypair, bridge: wired, txHash = TX_HASH, body = PLAN, io = {}, terms, operation } = {}) {
  world.state.terms = terms || termsFor(endpointOf(world), { payTo });
  world.state.body = body;
  world.state.changes = [usdcChange({ to: payTo })];
  world.state.settle = settleFor({ payer: payerKeypair.publicKey(), payTo, txHash });
  const payment = createMarketingPlanPayment({
    serviceUrl: `${world.base}/svc`,
    payTo,
    secret: payerKeypair.secret(),
    claims: wired.claims,
    createPaymentPayload: wired.createPaymentPayload,
    horizonUrl: world.horizonUrl,
    readCurrentLedger: async () => world.state.ledger,
  });
  // The effect key names the operation, so the duplicate case has to be a second run of the very
  // same operation: two operations that want the same thing are two effects, on purpose.
  const op = operation || createOperation({
    goal: 'obtain-marketing-plan (bridge test)',
    authority: { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: '50000', to: payTo }] },
  });
  // The contract's own entry point: it owns the capability, the ordering and the verifier, and the
  // engine is reached through it rather than beside it.
  return payment.run(op, { ask: async () => ({ approved: true }), ...io });
}

test('H1 one payment runs end to end and the settlement is read from the Horizon fixture on loopback', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    const wired = await bridge(world, { payerKeypair, payTo });
    const res = await runPayment({ world, payTo, payerKeypair, bridge: wired });
    assert.equal(res.status, 'verified', `got ${res.status}: ${res.receipt?.verification?.reason}`);
    assert.ok(world.state.horizonReads > 0, 'the settlement port read the ledger');
    assert.equal(res.output.title, PLAN.title);
    assert.equal(res.receipt.status, 'verified');
    assert.equal(res.receipt.verification.checks.settlement, true);
    assert.equal(res.receipt.verification.checks.settlement_exactAmount, true);
    assert.equal(res.receipt.verification.checks.delivery, true);
    assert.match(res.receipt.digest, /^[a-f0-9]{64}$/);
  } finally { world.close(); }
});

test('H2 a body that is not the declared delivery leaves the payment unverified', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    const wired = await bridge(world, { payerKeypair, payTo });
    const res = await runPayment({ world, payTo, payerKeypair, bridge: wired, body: { title: 'not a plan' } });
    assert.equal(res.status, 'not_verified');
    assert.equal(res.output, null);
  } finally { world.close(); }
});

test('H3 a service that charges more than the declaration was refused before the wire', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    const wired = await bridge(world, { payerKeypair, payTo });
    const res = await runPayment({
      world, payTo, payerKeypair, bridge: wired,
      terms: termsFor(endpointOf(world), { payTo, amount: '900000' }),
    });
    assert.notEqual(res.status, 'verified');
    assert.equal(world.state.paidReads, 0, 'nothing was sent');
  } finally { world.close(); }
});

test('H4 the same settled transaction replayed by a second payment is not verified twice', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    const wired = await bridge(world, { payerKeypair, payTo });
    const first = await runPayment({ world, payTo, payerKeypair, bridge: wired, txHash: TX_HASH });
    assert.equal(first.status, 'verified');
    world.state.paidReads = 0;
    // A second, independent operation, but the provider replays the transaction it already settled.
    const replayed = await runPayment({ world, payTo, payerKeypair, bridge: wired, txHash: TX_HASH });
    assert.notEqual(replayed.status, 'verified', 'a replayed transaction hash cannot verify twice');
    assert.match(replayed.receipt.verification.reason, /DUPLICATE_TRANSACTION/);
  } finally { world.close(); }
});

test('H5 an authority that does not name this recipient stops the payment before discovery', async () => {
  const payTo = Keypair.random().publicKey();
  const payerKeypair = Keypair.random();
  const world = await startWorld({ terms: termsFor('PLACEHOLDER') });
  try {
    world.state.terms = termsFor(endpointOf(world), { payTo });
    const wired = await bridge(world, { payerKeypair, payTo });
    world.state.body = PLAN;
    world.state.changes = [usdcChange({ to: payTo })];
    world.state.settle = settleFor({ payer: payerKeypair.publicKey(), payTo, txHash: TX_HASH });
    const payment = createMarketingPlanPayment({
      serviceUrl: `${world.base}/svc`, payTo, secret: payerKeypair.secret(), claims: wired.claims,
      createPaymentPayload: wired.createPaymentPayload, horizonUrl: world.horizonUrl,
      readCurrentLedger: async () => world.state.ledger,
    });
    const operation = createOperation({
      goal: 'obtain-marketing-plan (bridge test)',
      authority: { spend: [{ asset: `USDC:${USDC_CONTRACT}`, maxAmount: '50000', to: Keypair.random().publicKey() }] },
    });
    const res = await payment.run(operation, { ask: async () => ({ approved: true }) });
    assert.notEqual(res.status, 'verified');
    assert.equal(world.state.serviceReads, 0, 'the service was never asked');
  } finally { world.close(); }
});

test('H6 no port in this file reached the network', () => {
  assert.deepEqual(offLoopbackAttempts, []);
});
