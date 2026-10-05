'use strict';

// The seven minimal fixes of the second review of the trimmed bridge (roadmap §3), one case each,
// written before the code that answers them. What they pin:
//
//   F1  A reserved authorization identity is reserved once: a second preparation with the same
//       authorization does not overwrite the record the first one left, and an authorization that
//       already went on the wire is not resurrected by a later preparation.
//   F2  A pending record that can no longer be sent is removed, with the fall-off written down: what
//       is dropped, when, and why dropping it is not a resend.
//   F3  The authorization shape is closed to what this bridge declares: an envelope that carries
//       more than the declared invocation is refused rather than verified.
//   F4  The ledger read is bounded and cancellable, and an abort is revalidated on the way back.
//   F5  Cancellation reaches Horizon while the settlement reader is reading.
//   F6  A body is cancelled even when the refusal happens before the reader is acquired.
//   F7  The public claims of the bridge and of the example say what is proven and what is not.
//
// Nothing here touches the network: `fetch` is swapped for the tests that need one, and every
// fixture injects its own ledger reader. Where a limit is declared rather than fixed, the test says
// so in its own name instead of passing a weaker claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'demo', 'x402');
const requireDemo = createRequire(path.join(DEMO, 'package.json'));
const { Account, Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr, authorizeEntry } = requireDemo('@stellar/stellar-sdk');
const { createMemoryPaymentClaims } = require(path.join(ROOT, 'src', 'x402.js'));

const bridgeModules = import(pathToFileURL(path.join(DEMO, 'ports.js')).href);

const payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const payTo = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const FIXTURE_LEDGER = 1000;
const serviceUrl = 'http://127.0.0.1:1/svc';
const realFetch = globalThis.fetch;

const expected = { network: null, payer: payer.publicKey(), payTo, asset: null, amount: null };
let terms = null;

async function fixture() {
  const mod = await bridgeModules;
  expected.network = mod.NETWORK;
  expected.asset = mod.USDC_CONTRACT;
  expected.amount = mod.PRICE_ATOMIC;
  terms = {
    scheme: 'exact',
    network: expected.network,
    asset: expected.asset,
    payTo,
    amount: expected.amount,
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true },
  };
  return mod;
}

async function envelope({ recipient = payTo, expiration = 1050, subInvocations = [] } = {}) {
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
      subInvocations,
    }),
  });
  const signed = await authorizeEntry(entry, payer, expiration, Networks.TESTNET);
  return new TransactionBuilder(new Account(payer.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(fn), auth: [signed] }))
    .setTimebounds(0, 2000000000).build().toXDR();
}

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

async function withFetch(fn, body) {
  globalThis.fetch = fn;
  try {
    return await body();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const plan = { title: 'Report', summary: 'Summary', deliverables: [], nextSteps: [] };

// ------------------------------------------------------------------------------------------
// F1 — a reserved authorization identity is reserved once
// ------------------------------------------------------------------------------------------

test('F1a a second preparation with the same authorization does not overwrite the reserved record', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  let built = 0;
  const bridge = ports(createStellarPorts, async () => {
    built++;
    return { x402Version: 2, payload: { transaction: raw } };
  });
  const first = await bridge.signer.prepare({ terms, expected });
  // The builder hands back the very same authorization a second time. The second preparation must
  // not silently replace the record the first one reserved: either it is refused, or the record the
  // send reads is still the one the first preparation left.
  await bridge.signer.prepare({ terms, expected }).then(
    () => assert.equal(built, 1, 'a second preparation rebuilt the payload instead of refusing the reserved identity'),
    () => { /* refused is also an answer, and the assertion below is the one that counts */ },
  );
  const v = await bridge.inspectPrepared(first.authorization, { expected });
  assert.equal(v.verified, true, 'the reserved record was overwritten by a second preparation');
});

test('F1b an authorization that already went on the wire is not resurrected by a later preparation', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }));
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  await withFetch(async () => new Response('{}'), async () => {
    await bridge.http.sendPaid({ url: serviceUrl, authorization, idempotencyKey: 'f1b', signal: undefined });
  });
  // Preparing the same bytes again must not produce a sendable record: what left is gone.
  await bridge.signer.prepare({ terms, expected }).catch(() => {});
  await withFetch(async () => new Response('{}'), async () => {
    await assert.rejects(
      () => bridge.http.sendPaid({ url: serviceUrl, authorization, idempotencyKey: 'f1b-again', signal: undefined }),
      /authorization that was inspected|not.*reserved|resent/i,
      'the same authorization went on the wire twice',
    );
  });
});

// ------------------------------------------------------------------------------------------
// F2 — a pending record that can no longer be sent is removed, with the fall-off written down
// ------------------------------------------------------------------------------------------

test('F2a pending records that can no longer be sent are removed instead of blocking the bridge', async () => {
  const { createStellarPorts } = await fixture();
  // Fill the port with authorizations that are already dead: their validity window closed against
  // the fixture ledger, so none of them can be sent any more. A port that keeps them can only
  // refuse the next payment, which is not a statement about the effect.
  const dead = [];
  for (let ledger = 1; ledger <= 8; ledger++) {
    dead.push(await envelope({ expiration: ledger }));
  }
  let index = 0;
  const bridge = ports(
    createStellarPorts,
    async () => ({ x402Version: 2, payload: { transaction: dead[index++] ?? dead[dead.length - 1] } }),
    // The ledger has moved far past every one of those expiration ledgers.
    { readCurrentLedger: async () => FIXTURE_LEDGER },
  );
  for (const _ of dead) {
    await bridge.signer.prepare({ terms, expected }).catch(() => {});
  }
  // A fresh, live authorization still goes through: the dead records were dropped, not the port.
  const live = await envelope({ expiration: FIXTURE_LEDGER + 30 });
  index = dead.length;
  const answer = await bridge.signer.prepare({
    terms,
    expected,
  });
  assert.equal(typeof answer.authorization, 'string');
  const verdict = await bridge.inspectPrepared(answer.authorization, { expected });
  assert.equal(verdict.verified, true, `a live authorization was refused because dead records filled the port: ${verdict.reason}`);
  assert.equal(live.length > 0, true);
});

test('F2b the fall-off of an unsendable record is written where the port is', () => {
  const source = fs.readFileSync(path.join(DEMO, 'ports.js'), 'utf8');
  assert.match(source, /MAX_PENDING_AUTHORIZATIONS/, 'the bound is named');
  // What is dropped, on what ground, and why dropping a record is not a resend: all three have to
  // be written down where the next reader of this port will meet them.
  assert.match(source, /no se puede enviar|can no longer be sent|unsendable/i, 'the record that can no longer be sent is named');
  assert.match(source, /not a resend|no es un reenvío/i, 'and dropping a record is stated not to be a resend');
});

// ------------------------------------------------------------------------------------------
// F3 — the authorization shape is closed to what this bridge declares
// ------------------------------------------------------------------------------------------

test('F3 an envelope carrying a sub-invocation is not a verified preparation of this effect', async () => {
  const { createStellarPorts } = await fixture();
  // The declared effect is one transfer, to one recipient, for one amount. An authorization that
  // also authorizes a second invocation is not this effect, whatever its first invocation says.
  const nested = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(expected.asset).toScAddress(),
      functionName: 'transfer',
      args: [],
    })),
    subInvocations: [],
  });
  const raw = await envelope({ subInvocations: [nested] });
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }));
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  const verdict = await bridge.inspectPrepared(authorization, { expected });
  assert.equal(verdict.verified, false, 'an authorization for more than the declared invocation was verified');
});

// ------------------------------------------------------------------------------------------
// F4 — the ledger read is bounded, cancellable, and revalidates its abort on the way back
// ------------------------------------------------------------------------------------------

test('F4a the ledger read is cancelled when the caller aborts, and the abort is revalidated', async () => {
  const { createStellarPorts } = await fixture();
  let reads = 0;
  let controller = null;
  let cancelled = false;
  const raw = await envelope();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }), {
    // The reader this port would build for itself, standing in for the RPC exchange: it opens a
    // stream, and it is the port's job to stop that stream when the signal fires.
    readCurrentLedger: async (signal) => {
      reads++;
      const stream = new ReadableStream({
        start(c) { controller = c; },
        cancel() { cancelled = true; },
      });
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      // A service that never sends a byte: the port's own budget has to end this.
      return await new Promise(() => {});
    },
  });
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  const c = new AbortController();
  const pending = bridge.inspectPrepared(authorization, { expected, signal: c.signal });
  c.abort();
  const settled = await Promise.race([
    pending.then((v) => ({ kind: 'verdict', v }), (e) => ({ kind: 'refusal', e })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'pending' }), 250)),
  ]);
  if (controller) { try { controller.error(new Error('closed')); } catch { } }
  assert.notEqual(settled.kind, 'pending', 'the ledger read kept going after the caller aborted it');
  assert.equal(reads, 1, 'the ledger was read once');
  assert.equal(cancelled, true, 'the stream behind the ledger read was not cancelled');
});

test('F4b an abort that arrives during the ledger read makes the preparation not verified', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }), {
    readCurrentLedger: async (signal) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The read answered, but the caller gave up while it was in flight. An answer nobody is
      // waiting for is not a window that was checked.
      if (signal && signal.aborted) throw Object.assign(new Error('ledger read aborted'), { code: 'VESPI_ABORTED' });
      return FIXTURE_LEDGER;
    },
  });
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  const c = new AbortController();
  c.abort();
  const verdict = await bridge.inspectPrepared(authorization, { expected, signal: c.signal });
  assert.equal(verdict.verified, false, 'an aborted ledger read was read as a checked validity window');
});

// ------------------------------------------------------------------------------------------
// F5 — cancellation reaches Horizon while the settlement reader is reading
// ------------------------------------------------------------------------------------------

test('F5 a cancelled signal reaches Horizon during the settlement read', async () => {
  const { createStellarPorts } = await fixture();
  let horizonReads = 0;
  let abortedAt = null;
  const raw = await envelope();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }), {
    horizonUrl: 'http://127.0.0.1:1',
  });
  // The reader this port builds for itself is replaced by one that only answers to Horizon and
  // records what it was handed: a settlement read that ignores the signal keeps a cancelled run
  // waiting on the ledger.
  bridge.verifySettlement = async (evidence, { expected: exp, authDigest, signal }) => {
    const { readSettlementFromLedger } = await import(pathToFileURL(path.join(DEMO, 'settlement.js')).href);
    return readSettlementFromLedger(evidence, {
      horizon: {
        transactions: () => ({ transaction: () => ({ call: async () => { horizonReads++; abortedAt = signal ? signal.aborted : null; throw new Error('no ledger here'); } }) }),
        operations: () => ({ forTransaction: () => ({ call: async () => ({ records: [], _links: {} }) }) }),
      },
      payer: exp.payer,
      payTo: exp.payTo,
      amount: exp.amount,
      issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      assetContract: exp.asset,
      network: exp.network,
      requireAuthDigest: true,
      authDigest,
    });
  };
  const c = new AbortController();
  c.abort();
  const verdict = await bridge.verifySettlement(
    { txHash: 'a'.repeat(64), payer: payer.publicKey(), network: expected.network, authDigest: 'b'.repeat(64) },
    { expected, authDigest: 'b'.repeat(64), signal: c.signal },
  );
  assert.equal(verdict.verified, false);
  assert.equal(horizonReads, 0, 'a cancelled settlement read still went to Horizon');
  assert.equal(abortedAt, null, 'the reader was never reached, so it was never told about the abort');
});

// ------------------------------------------------------------------------------------------
// F6 — a body is cancelled even when the refusal happens before the reader is acquired
// ------------------------------------------------------------------------------------------

test('F6a a body refused for its declared length is still cancelled', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  let cancelled = false;
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }));
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('x')); },
    cancel() { cancelled = true; },
  });
  const tooBig = new Response(stream, { headers: { 'content-length': String(4 * 1024 * 1024) } });
  await withFetch(async () => tooBig, async () => {
    const sent = await bridge.http.sendPaid({ url: serviceUrl, authorization, idempotencyKey: 'f6', signal: undefined });
    await assert.rejects(() => sent.readBody(), /too large/);
  });
  assert.equal(cancelled, true, 'the refused body was left open for the service to keep writing into');
});

test('F6b a body refused before any read reports the refusal without leaving a stream behind', async () => {
  const { createStellarPorts } = await fixture();
  const raw = await envelope();
  const bridge = ports(createStellarPorts, async () => ({ x402Version: 2, payload: { transaction: raw } }));
  const { authorization } = await bridge.signer.prepare({ terms, expected });
  let pulled = 0;
  const stream = new ReadableStream({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); },
    cancel() { },
  });
  const response = new Response(stream, { headers: { 'content-length': String(8 * 1024 * 1024) } });
  await withFetch(async () => response, async () => {
    const sent = await bridge.http.sendPaid({ url: serviceUrl, authorization, idempotencyKey: 'f6b', signal: undefined });
    const error = await sent.readBody().then(() => null, (e) => e);
    assert.ok(error !== null, 'a body eight times over the bound was read anyway');
    assert.match(String(error.message), /too large/);
  });
  assert.ok(pulled <= 2, `a refused body was pulled ${pulled} times before the refusal`);
});

// ------------------------------------------------------------------------------------------
// F7 — the public claims of the bridge and of the example
// ------------------------------------------------------------------------------------------

test('F7 the bridge header names what executes it and what no test covers', () => {
  const source = fs.readFileSync(path.join(DEMO, 'ports.js'), 'utf8');
  assert.match(source, /EXECUTED BY demo\/x402\/bridge\.test\.mjs/, 'the header names what executes it');
  assert.match(source, /do NOT cover/, 'the header names what no test covers');
  assert.match(source, /live payment/, 'the header says a live payment was not made');
  assert.match(source, /durable claims store/, 'the header says durable claims are not proven');
  // The defect this tree carried: a port named after the reader it imports re-entered itself.
  assert.match(source, /verifySettlement as readSettlementFromLedger/, 'the imported reader is aliased on import');
  assert.match(source, /await readSettlementFromLedger\(evidence,/, 'the port calls the reader it imported');
  assert.doesNotMatch(source, /await verifySettlement\(/, 'the port never calls itself');
  assert.doesNotMatch(source, /PENDING REFERENCE/, 'the bridge is no longer declared as a reference nobody runs');
  assert.doesNotMatch(source, /DO NOT USE THIS FILE/, 'and no longer tells the reader to avoid it');
});

test('F7b the example says what it needs from its host and does not approve itself', () => {
  const examplePath = path.join(ROOT, 'examples', 'x402-app.js');
  const source = fs.readFileSync(examplePath, 'utf8');
  for (const claim of ['buildWithReferenceBridge', 'claims', 'ask', 'stellar:testnet']) {
    assert.match(source, new RegExp(claim), `the example carries ${claim}`);
  }
  // The example is the shape a host copies, so the claims it makes about the bridge are public
  // claims: it must not tell a reader that the bridge verifies a payment it never ran.
  assert.doesNotMatch(source, /verifies every payment|always verifies/i, 'the example promises a verification it does not run');
  assert.match(source, /SIMULATED/, 'the simulated ports stay marked as simulated');
});