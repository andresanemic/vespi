'use strict';
// The independent reviewer's adversarial cases, moved into the kernel suite so they cannot be lost.
// Every title keeps the reviewer's ADV code, so a failure names the finding it answers. Synthetic
// data, synthetic ports, a stubbed SDK: no network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const { createOperation } = require('../src/operation.js');

const DEMO = path.join(__dirname, '..', 'demo', 'x402');
const RAW_URL = 'https://example.test/pay';
const CANONICAL_URL = new URL(RAW_URL).toString();
const CLOCK_MS = Date.parse('2040-01-01T00:00:00.000Z');
const TX_HASH = 'a'.repeat(64);
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
const PLAN = { title: 'Queen Marketing Plan', summary: 'A 90-day plan.', deliverables: ['Landing page'], nextSteps: ['Launch week 1'] };
const PLAN_DIGEST = createHash('sha256').update(JSON.stringify(PLAN), 'utf8').digest('hex');
// A marker that stands for whatever a host would leak: a raw SDK message, a url, a key. No receipt
// this suite produces may contain it.
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_MARKER';

function spec(over = {}) {
  return {
    id: 'x402-marketing-plan',
    url: RAW_URL,
    method: 'GET',
    network: 'stellar:testnet',
    asset: 'TOKEN',
    grantAsset: 'USDC:TOKEN',
    payer: 'PAYER',
    payTo: 'RECIPIENT',
    amount: '100000',
    maxTimeoutSeconds: 300,
    ...over,
  };
}

const EXPECTED = { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' };

function authority(over = {}) {
  return { spend: [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT' }], ...over };
}

function offer(over = {}) {
  return {
    scheme: 'exact',
    network: 'stellar:testnet',
    asset: 'TOKEN',
    payTo: 'RECIPIENT',
    amount: '100000',
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
    ...over,
  };
}

function paymentRequired(over = {}) {
  return { x402Version: 2, resource: { url: CANONICAL_URL }, accepts: [offer()], ...over };
}

function inspection(over = {}) {
  return {
    verified: true,
    authDigest: AUTH_DIGEST,
    effect: EXPECTED,
    checks: { prepared: true, authorization: true },
    reason: 'prepared transaction matches declared effect',
    ...over,
  };
}

// The simulated port set: every call is counted, so a test can prove a payment never went out.
function fakePorts(over = {}) {
  const calls = { discover: 0, prepare: 0, inspect: 0, send: 0, verifySettlement: 0, claimTransaction: 0 };
  const ports = {
    calls,
    http: {
      async discover(request) {
        calls.discover += 1;
        if (over.discover) return over.discover(request);
        return { status: 402, paymentRequired: paymentRequired({ resource: { url: request.url } }) };
      },
      async sendPaid(request) {
        calls.send += 1;
        if (over.sendPaid) return over.sendPaid(request);
        return {
          status: 200,
          settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
          readBody: async () => PLAN,
        };
      },
    },
    signer: {
      async prepare(request) {
        calls.prepare += 1;
        if (over.prepare) return over.prepare(request);
        return { authorization: AUTHORIZATION };
      },
    },
    async inspectPrepared(auth, request) {
      calls.inspect += 1;
      if (over.inspectPrepared) return over.inspectPrepared(auth, request);
      return inspection();
    },
    async verifySettlement(evidence, request) {
      calls.verifySettlement += 1;
      if (over.verifySettlement) return over.verifySettlement(evidence, request);
      return { verified: true, checks: { transfer: true }, reason: 'independent readback' };
    },
    validateOutput(body) {
      if (over.validateOutput) return over.validateOutput(body);
      const shaped = body !== null && typeof body === 'object' && !Array.isArray(body)
        && typeof body.title === 'string' && typeof body.summary === 'string'
        && Array.isArray(body.deliverables) && Array.isArray(body.nextSteps);
      return shaped ? { ok: true, output: body, digest: PLAN_DIGEST } : { ok: false };
    },
  };
  ports.claims = {
    reserveEffect: () => 'claimed',
    claimTransaction(network, txHash) {
      calls.claimTransaction += 1;
      if (over.claimTransaction) return over.claimTransaction(network, txHash);
      return 'claimed';
    },
  };
  return ports;
}

async function runOnce(ports, over = {}, auth = authority(), io = { now: () => CLOCK_MS }) {
  const kernel = require('../src/x402.js');
  const op = createOperation({ goal: 'paid marketing plan', action: 'pay', authority: auth });
  return kernel.createX402Payment(spec(), ports).run(op, { ...io, ...over });
}

// =====================================================================================
// Group J — the reviewer's attacks on the control gates (ADV01, ADV02, ADV03, ADV18)
// =====================================================================================

test('ADV01 rejects inspection with a false authorization control before send', async () => {
  const ports = fakePorts({ inspectPrepared: async () => inspection({ checks: { prepared: true, authorization: false } }) });
  const res = await runOnce(ports);
  assert.equal(ports.calls.send, 0, 'a false inspection control must stop the send');
  assert.notEqual(res.status, 'verified');
});

test('ADV02 expiry reached during preparation must prevent send', async () => {
  let now = CLOCK_MS;
  const ports = fakePorts({ prepare: async () => { now = CLOCK_MS + 2000; return { authorization: AUTHORIZATION }; } });
  const expiring = authority({ spend: [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT', expiresAt: CLOCK_MS + 1000 }] });
  const res = await runOnce(ports, {}, expiring, { now: () => now });
  assert.equal(ports.calls.send, 0, 'a permission that expired while preparing must stop the send');
  assert.deepEqual(res.receipt.authority.exercised, [], 'nothing is exercised when the permission expired');
});

test('ADV03 expiry reached during independent inspection must prevent send', async () => {
  let now = CLOCK_MS;
  const ports = fakePorts({ inspectPrepared: async () => { now = CLOCK_MS + 1000; return inspection(); } });
  const expiring = authority({ spend: [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT', expiresAt: CLOCK_MS + 1000 }] });
  const res = await runOnce(ports, {}, expiring, { now: () => now });
  assert.equal(ports.calls.send, 0, 'a permission that expired while inspecting must stop the send');
  assert.deepEqual(res.receipt.authority.exercised, []);
});

test('ADV18 replacing the operation authority during inspection revokes send', async () => {
  const kernel = require('../src/x402.js');
  const op = createOperation({ goal: 'revoked paid effect', action: 'pay', authority: authority() });
  const ports = fakePorts({ inspectPrepared: async () => { op.authority = { spend: [] }; return inspection(); } });
  const res = await kernel.createX402Payment(spec(), ports).run(op, { now: () => CLOCK_MS });
  assert.equal(ports.calls.send, 0, 'a substituted authority must stop the send');
  assert.deepEqual(res.receipt.authority.exercised, []);
});

test('ADV11 a changed budget during inspection must prevent send', async () => {
  const kernel = require('../src/x402.js');
  const op = createOperation({ goal: 'narrowed paid effect', action: 'pay', authority: authority() });
  const ports = fakePorts({ inspectPrepared: async () => { op.authority.spend[0].maxAmount = '1'; return inspection(); } });
  const res = await kernel.createX402Payment(spec(), ports).run(op, { now: () => CLOCK_MS });
  assert.equal(ports.calls.send, 0, 'a ceiling that no longer reaches the amount must stop the send');
});

// =====================================================================================
// Group J — the reviewer's attacks on terms selection (ADV06, ADV07, ADV08, ADV09, ADV19)
// =====================================================================================

function select(over = {}, declared = spec(), auth = authority(), now = CLOCK_MS) {
  return require('../src/x402.js').selectX402Terms(paymentRequired(over), declared, auth, now);
}

test('ADV06 the declared signing window bounds the selected terms', () => {
  const r = select({ accepts: [offer({ maxTimeoutSeconds: 300 })] }, spec({ maxTimeoutSeconds: 1 }));
  assert.equal(r.ok, false, 'a declared ceiling of one second cannot accept a three hundred second offer');
  assert.equal(r.code, 'TERMS_REJECTED');
});

test('ADV07 a changing economic getter cannot change the terms after validation', () => {
  let reads = 0;
  const candidate = offer();
  Object.defineProperty(candidate.extra, 'areFeesSponsored', { enumerable: true, get: () => ++reads === 1 });
  const r = select({ accepts: [candidate] });
  assert.ok(!r.ok || r.terms.extra.areFeesSponsored === true, 'the signed terms are the validated ones');
});

test('ADV08 a throwing economic getter during the copy returns a rejection instead of leaking the error', () => {
  let reads = 0;
  const candidate = offer();
  Object.defineProperty(candidate.extra, 'areFeesSponsored', {
    enumerable: true,
    get: () => { if (++reads === 1) return true; throw new Error(PRIVATE_MARKER); },
  });
  let r = null;
  assert.doesNotThrow(() => { r = select({ accepts: [candidate] }); }, 'a port error never travels out as a throw');
  assert.equal(r.ok, false);
});

test('ADV09 an authority proxy getter must return a public rejection', () => {
  const hostile = new Proxy(authority(), { get() { throw new Error(PRIVATE_MARKER); } });
  let r = null;
  assert.doesNotThrow(() => { r = select({}, spec(), hostile); }, 'a port error never travels out as a throw');
  assert.deepEqual(r, { ok: false, code: 'TERMS_REJECTED' });
});

test('ADV19 a changing offer signing-window getter cannot escape the allowed bound', () => {
  let reads = 0;
  const candidate = offer();
  Object.defineProperty(candidate, 'maxTimeoutSeconds', { enumerable: true, get: () => (++reads <= 3 ? 300 : 10_000) });
  const r = select({ accepts: [candidate] });
  assert.ok(!r.ok || r.terms.maxTimeoutSeconds <= 300, 'the selected window never exceeds the global bound');
});

// =====================================================================================
// Group J — the reviewer's attacks on the settlement verdict, delivery and the bridge
// =====================================================================================

test('ADV04 a malformed nonboolean settlement check cannot disappear into verified', async () => {
  const ports = fakePorts({ verifySettlement: async () => ({ verified: true, checks: { transfer: 'false' }, reason: 'contradictory readback' }) });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'a control that is not a boolean is not a control');
  assert.equal(res.output, null);
});

test('ADV05 a settlement verdict without checks cannot yield verified', async () => {
  const ports = fakePorts({ verifySettlement: async () => ({ verified: true, reason: 'no observations' }) });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'an empty observation set is not a verification');
  assert.equal(res.output, null);
});

test('ADV13 a false boolean settlement control rejects and hides output', async () => {
  const ports = fakePorts({ verifySettlement: async () => ({ verified: true, checks: { transfer: false }, reason: 'failed transfer' }) });
  const res = await runOnce(ports);
  assert.equal(res.status, 'not_verified');
  assert.equal(res.output, null);
});

test('ADV10 a delivery without a body digest is not covered', async () => {
  const ports = fakePorts({ validateOutput: (body) => ({ ok: true, output: body }) });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'a body nobody hashed is not evidence of delivery');
  assert.equal(res.output, null);
});

test('ADV12 a different settlement asset reported by the server is rejected without output', async () => {
  const ports = fakePorts({
    sendPaid: async () => ({
      status: 200,
      settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000', asset: 'OTHER-TOKEN' },
      readBody: async () => PLAN,
    }),
  });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'an asset the server contradicts is not the declared effect');
  assert.equal(res.output, null);
  assert.equal(res.receipt.evidence.txHash, TX_HASH, 'the hash is kept so a person can reconcile');
});

test('ADV14 a failed send preserves uncertainty and does not retry', async () => {
  const ports = fakePorts({ sendPaid: async () => { throw new Error(PRIVATE_MARKER); } });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified');
  assert.equal(res.receipt.evidence.settlementUnknown, true);
  assert.equal(ports.calls.send, 1, 'an uncertain payment is never sent again');
  assert.equal(JSON.stringify(res.receipt).includes(PRIVATE_MARKER), false, 'the port message does not travel');
});

test('ADV16 a claim port exception after send keeps exercised uncertainty and hides raw errors', async () => {
  const ports = fakePorts({ claimTransaction: () => { throw new Error(PRIVATE_MARKER); } });
  const res = await runOnce(ports);
  assert.equal(res.status, 'not_verified', 'a send that went out cannot be reported as a plain failure');
  assert.ok(res.receipt.authority.exercised.length > 0, 'the exercised permission is kept for reconciliation');
  assert.equal(JSON.stringify(res.receipt).includes(PRIVATE_MARKER), false, 'the port message does not travel');
});

test('ADV17 a hostile settlement property after send keeps exercised uncertainty', async () => {
  const ports = fakePorts({
    sendPaid: async () => ({ status: 200, get settlement() { throw new Error(PRIVATE_MARKER); } }),
  });
  const res = await runOnce(ports);
  assert.equal(res.status, 'not_verified', 'a send that went out cannot be reported as a plain failure');
  assert.ok(res.receipt.authority.exercised.length > 0, 'the exercised permission is kept for reconciliation');
  assert.equal(JSON.stringify(res.receipt).includes(PRIVATE_MARKER), false, 'the port message does not travel');
});

// =====================================================================================
// Group J — the reference bridge is a pending reference, and the trim is what holds
// =====================================================================================

// The coordinator's decision on the final review round: the demo runner went back to the base
// version, so nothing loads ports.js any more and there is no execution path to it. A file nothing
// runs cannot be asserted to compose with the contract, and a stubbed evaluation of a body whose
// module declarations were stripped is not evidence about a payment. What is left to check is the
// trim itself and the honesty of the header: that the runner drives the historical adapter, that no
// demo module reaches for ports.js, and that the file says out loud that it was never executed.

function demoSources() {
  const out = [];
  for (const entry of fs.readdirSync(DEMO, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const inner of fs.readdirSync(path.join(DEMO, entry.name))) {
        if (/\.(mjs|js)$/.test(inner)) out.push(path.join(DEMO, entry.name, inner));
      }
    } else if (/\.(mjs|js)$/.test(entry.name) && entry.name !== 'ports.js') {
      out.push(path.join(DEMO, entry.name));
    }
  }
  return out;
}

test('ADV15 no demo module loads the reference bridge, and the runner drives the historical adapter', () => {
  const runner = fs.readFileSync(path.join(DEMO, 'run.js'), 'utf8');
  assert.doesNotMatch(runner, /ports\.js/, 'the runner does not reach the pending reference');
  assert.match(runner, /x402Capability/, 'the runner drives the historical adapter capability');
  assert.match(runner, /runOperation\(/, 'the historical path drives the operation through the engine');
  for (const file of demoSources()) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /from '\.\/ports\.js'|import\('\.\/ports\.js'\)|require\('\.\/ports\.js'\)/,
      `${path.basename(file)} does not load ports.js`,
    );
  }
});

test('ADV15 the reference bridge says it was never executed, and only its declared shape is read', () => {
  const ports = fs.readFileSync(path.join(DEMO, 'ports.js'), 'utf8');
  assert.match(ports, /PENDING REFERENCE\. Nothing imports this file and nothing runs it\./);
  assert.match(ports, /NEVER EXECUTED WITH THE REAL SDK/, 'the header states the unexecuted truth');
  assert.match(ports, /has never been executed/, 'the header states that the payment path is unproven');
  assert.match(ports, /DO NOT USE THIS FILE/, 'the header tells the next reader what to do with it');
  // The six ports are declared, and what is declared is what the contract asks for. Reading the text
  // is the whole of the claim: nothing below these lines has ever been executed.
  for (const port of ['discover', 'sendPaid', 'prepare', 'inspectPrepared', 'verifySettlement', 'validateOutput']) {
    assert.match(ports, new RegExp(`\\b${port}\\b`), `ports.js declares ${port}`);
  }
});

test('ADV15c the reference bridge factory composes with the contract at run time', {
  todo: "the claim the stubbed evaluation used to make: evaluate ports.js with its module declarations stripped and its SDK stubbed, then check that createStellarPorts() returns the port shape src/x402.js accepts and that a payment runs end to end. Withdrawn on the coordinator's decision for the final round, because it could not survive contact with the truth: the inner verifySettlement shadowed the imported reader of the same name, so the bridge called itself and never read the ledger, and a test that executes a pending reference keeps implying it works. Restore this when the demo suite runs where its dependencies exist.",
}, () => {
  assert.equal(typeof require('../src/x402.js').createX402Payment, 'function');
});
