'use strict';
// Adversarial hardening of the x402 branch, written from the attacker's side after the reviewer's
// ADV01-ADV19 were fixed. Every case here targets a defect class a stronger reviewer looks for in
// model-written code: authority not bound to what it authorizes, a field read twice, a getter or a
// proxy that answers differently to the check and to the use, an object of another shape than the one
// the guard admits, reentrancy, an exception that leaks private data or leaves half a state, an array
// or an integer that is not validated, a receipt that announces `verified` without an independent
// verification having happened, `undefined` or `null` read as success, a clock not read again, a
// `__proto__` or an extra key, and a digest that does not cover a field.
//
// Nothing here duplicates a case the branch suite already covers (test/x402.test.js and
// test/k4-x402-advisor.test.js). Synthetic data, synthetic ports, no network, no credentials, no
// real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const { createOperation } = require('../src/operation.js');

const RAW_URL = 'https://example.test/pay';
const CANONICAL_URL = new URL(RAW_URL).toString();
const CLOCK_MS = Date.parse('2040-01-01T00:00:00.000Z');
const TX_HASH = 'a'.repeat(64);
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
const OTHER_DIGEST = 'b'.repeat(64);
const PLAN = { title: 'Queen Marketing Plan', summary: 'A 90-day plan.', deliverables: ['Landing page'], nextSteps: ['Launch week 1'] };
const PLAN_DIGEST = createHash('sha256').update(JSON.stringify(PLAN), 'utf8').digest('hex');
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

function select(over = {}, declared = spec(), auth = authority(), now = CLOCK_MS) {
  return require('../src/x402.js').selectX402Terms(paymentRequired(over), declared, auth, now);
}

// =====================================================================================
// Group A — the inspected authorization: the guard and the value it hands on
// =====================================================================================

test('H01 the authorization digest on the receipt is the one the inspector validated', async () => {
  // The guard reads `authDigest` twice (typeof, HASH) and the caller reads it twice more. An answer
  // that is honest at the check and different at the use binds a digest nobody inspected.
  let reads = 0;
  const result = inspection();
  Object.defineProperty(result, 'authDigest', {
    enumerable: true,
    get() {
      reads += 1;
      return reads <= 2 ? AUTH_DIGEST : OTHER_DIGEST;
    },
  });
  const ports = fakePorts({ inspectPrepared: async () => result });
  const res = await runOnce(ports);
  assert.equal(ports.calls.send, 1, 'the payment itself is the healthy path here');
  assert.equal(res.status, 'verified');
  assert.equal(
    res.receipt.evidence.authDigest,
    AUTH_DIGEST,
    'a digest that was never validated must not travel on the receipt',
  );
});

test('H02 a false inspection control cannot disappear by answering twice', async () => {
  // ADV01 requires every reported control to be exactly true. The guard reads `checks` four times:
  // plainness, the mandatory `prepared`, the key list, then each value.
  const answers = [
    { prepared: true, authorization: true },
    { prepared: true, authorization: false },
    { authorization: false },
    { authorization: true },
  ];
  let reads = 0;
  const result = inspection();
  Object.defineProperty(result, 'checks', {
    enumerable: true,
    get() {
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      return answer;
    },
  });
  const ports = fakePorts({ inspectPrepared: async () => result });
  const res = await runOnce(ports);
  assert.equal(ports.calls.send, 0, 'an inspection whose authorization control is false must stop the send');
  assert.notEqual(res.status, 'verified');
});

// =====================================================================================
// Group B — the settlement answer and the verdict it claims
// =====================================================================================

test('H03 a false settlement control cannot disappear by answering twice', async () => {
  // ADV04 and ADV05 admit a verdict whole or not at all. The guard reads `checks` three times, so an
  // object that answers differently to each read can drop the control that says the fee was not paid.
  const answers = [{ transfer: true }, { transfer: true }, { transfer: true, feePaid: false }];
  let reads = 0;
  const verdict = {
    verified: true,
    reason: 'independent readback',
    get checks() {
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      return answer;
    },
  };
  const ports = fakePorts({ verifySettlement: async () => verdict });
  const res = await runOnce(ports);
  assert.equal(ports.calls.verifySettlement, 1, 'the independent port was asked');
  assert.notEqual(res.status, 'verified', 'a verdict that carries a false control is not a verification');
  assert.equal(res.output, null, 'nothing is exposed on an unverified payment');
});

test('H04 the payer on the receipt is the payer the check validated', async () => {
  // `payer` is read three times to admit it into the evidence (typeof, length, value) and a fourth
  // time to compare it. The evidence and the comparison must be the same read.
  let reads = 0;
  const settlement = {
    success: true,
    transaction: TX_HASH,
    network: 'stellar:testnet',
    amount: '100000',
    get payer() {
      reads += 1;
      return reads <= 3 ? 'GHOST-PAYER' : 'PAYER';
    },
  };
  const ports = fakePorts({ sendPaid: async () => ({ status: 200, settlement, readBody: async () => PLAN }) });
  const res = await runOnce(ports);
  assert.equal(
    res.receipt.evidence.payer,
    'PAYER',
    'the evidence must state the payer the comparison was made against',
  );
});

test('H05 the amount on the receipt is the amount the check validated', async () => {
  let reads = 0;
  const settlement = {
    success: true,
    transaction: TX_HASH,
    payer: 'PAYER',
    network: 'stellar:testnet',
    get amount() {
      reads += 1;
      return reads <= 4 ? '1' : '100000';
    },
  };
  const ports = fakePorts({ sendPaid: async () => ({ status: 200, settlement, readBody: async () => PLAN }) });
  const res = await runOnce(ports);
  assert.equal(
    res.receipt.evidence.amount,
    '100000',
    'a sealed receipt must not state an amount no comparison ever saw',
  );
});

test('H06 the body digest on the receipt is the digest that was validated', async () => {
  // ADV10 requires a SHA-256 digest from the validator. It is read three times: typeof, HASH, value.
  let reads = 0;
  const ports = fakePorts({
    validateOutput: () => ({
      ok: true,
      output: PLAN,
      get digest() {
        reads += 1;
        return reads <= 2 ? PLAN_DIGEST : OTHER_DIGEST;
      },
    }),
  });
  const res = await runOnce(ports);
  assert.equal(res.status, 'verified', 'the payment itself is the healthy path here');
  assert.equal(
    res.receipt.evidence.planDigest,
    PLAN_DIGEST,
    'a digest that was never validated must not travel on the receipt',
  );
});

// =====================================================================================
// Group C — terms selection: prototype, symbols and the order of the guard
// =====================================================================================

test('H07 an economic key that arrives as __proto__ is refused, not adopted', () => {
  // `__proto__` as an own enumerable key is what a JSON body can carry. The allowlist has to refuse
  // it, and the copy has to stay an ordinary object with no inherited economics.
  const extra = JSON.parse('{"__proto__":{"areFeesSponsored":true,"settlementSecret":"x"}}');
  const r = select({ accepts: [offer({ extra })] });
  assert.equal(r.ok, false, 'an economic field the kernel does not understand is a possible new flow');
  assert.equal(r.code, 'TERMS_REJECTED');
});

test('H08 an offer the server never listed cannot be selected through its own iterator', () => {
  const listed = offer({ amount: '999999' });
  const hidden = offer();
  const accepts = [listed];
  accepts[Symbol.iterator] = function* iterate() { yield hidden; };
  const r = select({ accepts });
  assert.equal(r.ok, false, 'the selected offer has to be one the server actually sent');
  assert.equal(r.code, 'TERMS_REJECTED');
});

test('H09 a refused container is never read', () => {
  let reads = 0;
  const accepts = new Proxy([offer()], {
    get(target, key, receiver) {
      if (typeof key === 'string') reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const r = select({ accepts });
  assert.equal(r.code, 'INVALID_SPEC', 'a list that is not plain data is a malformed declaration');
  assert.equal(reads, 0, 'nothing is read out of a container the contract refuses');
});

// =====================================================================================
// Group D — the boundary of the contract
// =====================================================================================

test('H10 an unreadable io cannot throw out of the contract with a private message', async () => {
  const kernel = require('../src/x402.js');
  const ports = fakePorts();
  const op = createOperation({ goal: 'paid marketing plan', action: 'pay', authority: authority() });
  const io = new Proxy({ now: () => CLOCK_MS }, {
    ownKeys() { throw new Error(PRIVATE_MARKER); },
  });
  let res = null;
  try {
    res = await kernel.createX402Payment(spec(), ports).run(op, io);
  } catch (error) {
    assert.fail(`run must answer with a public code, not with ${error && error.message}`);
  }
  assert.notEqual(res.status, 'verified');
  assert.equal(ports.calls.send, 0);
});

test('H11 the gate payload names the network and the resource it authorizes', {
  todo: "decision of the owner: a spend grant has no network and no resource field, so the person who says yes cannot tell which chain and which url the payment reaches. Adding either one changes the public shape of authority.js, which is not this hardening's call.",
}, () => {
  const kernel = require('../src/x402.js');
  const required = kernel.createX402Payment(spec(), fakePorts()).required({ authority: authority() });
  assert.equal(required.spend[0].network, 'stellar:testnet');
  assert.equal(required.spend[0].resource, CANONICAL_URL);
});

test('H12 an output that cannot be read again is not a delivered output', {
  todo: "decision of the owner: what a validateOutput port may return as `output` is a contract choice. Refusing a non-plain output is defensible and json-copying it changes what a host gets back; either way it is the owner's call, not a hardening fix.",
}, async () => {
  const trap = { get title() { throw new Error(PRIVATE_MARKER); } };
  const ports = fakePorts({ validateOutput: () => ({ ok: true, output: trap, digest: PLAN_DIGEST }) });
  const res = await runOnce(ports);
  assert.equal(res.output, null, 'a body nobody can read again is not a delivered body');
});

// =====================================================================================
// Group E — the defences that must stay green
// =====================================================================================

test('H13 a claims store that answers with a promise is not a claim', async () => {
  const ports = fakePorts({ claimTransaction: async () => 'claimed' });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'an unanswered store cannot make a transaction unique');
  assert.match(res.receipt.verification.reason, /CLAIMS_CAPACITY/);
});

test('H14 a settlement asset of null is a contradiction, not an absent field', async () => {
  const ports = fakePorts({
    sendPaid: async () => ({
      status: 200,
      settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000', asset: null },
      readBody: async () => PLAN,
    }),
  });
  const res = await runOnce(ports);
  assert.notEqual(res.status, 'verified', 'null is a declared value that contradicts the effect');
  assert.equal(res.output, null);
  assert.equal(res.receipt.evidence.txHash, TX_HASH, 'the hash is kept so a person can reconcile');
});

test('H15 a control name written by a port cannot travel into a sealed receipt', async () => {
  // The settlement port names its own controls. The receipt admits kernel-written codes, so a control
  // name is port-written text and has to be refused rather than carried.
  const ports = fakePorts({
    verifySettlement: async () => ({
      verified: true,
      checks: { transfer: true, [PRIVATE_MARKER]: true },
      reason: 'independent readback',
    }),
  });
  const res = await runOnce(ports);
  assert.equal(
    JSON.stringify(res.receipt).includes(PRIVATE_MARKER),
    false,
    'no free text written by a port travels into a receipt',
  );
  assert.notEqual(res.status, 'verified', 'a verdict is admitted whole or not at all');
});

test('H16 a claims capacity that throws falls back to the default', () => {
  const kernel = require('../src/x402.js');
  const store = kernel.createMemoryPaymentClaims({
    get capacity() { throw new Error(PRIVATE_MARKER); },
  });
  assert.equal(store.reserveEffect(TX_HASH), 'claimed', 'the store still works on the default capacity');
  assert.equal(store.reserveEffect(TX_HASH), 'duplicate');
  assert.equal(store.claimTransaction('stellar:testnet', TX_HASH), 'claimed');
});
