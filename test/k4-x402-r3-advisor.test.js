'use strict';
// Adversarial tests for the r3 review round of the x402 branch (R3-01..R3-12), held in the branch
// suite with the reviewer's own case codes so a claim can be traced back to his report.
//
// What this round attacks is not a new surface: every port is trusted host code, so the failures are
// the ones a host gets for free. A claims store that answers with a promise (R3-01, R3-02), a
// configuration object that changes while the payment is in flight (R3-03, R3-04), and a deadline
// above the ceiling of a 32-bit timer (R3-11). The rest either pass already or are limits this
// version declares instead of repairing: what the validator hands back as `output` is inspected at
// the top level only, the digest is the validator's word, and the idempotency key is not recomputable
// from the exported version alone (R3-05, R3-06, R3-07, R3-10) — those four stay as `todo` with their
// reason, the code stays as it is and the module header and comments say so.
//
// Synthetic data and synthetic ports. No network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { types } = require('node:util');

const kernel = require('../src/x402.js');
const { createOperation } = require('../src/operation.js');

const RAW_URL = 'https://example.test/pay';
const CLOCK_MS = Date.parse('2040-01-01T00:00:00.000Z');
const TX_HASH = 'a'.repeat(64);
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
const PLAN = { title: 'Plan', summary: 'S', deliverables: ['a'], nextSteps: ['b'] };
const PLAN_DIGEST = createHash('sha256').update(JSON.stringify(PLAN), 'utf8').digest('hex');
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_MARKER';
// The shape of a Stellar secret seed: an S followed by 55 base32 characters. Synthetic, not a key.
const SECRET_SHAPED = `S${'A'.repeat(55)}`;
const EXPECTED = { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' };

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

function grant(over = {}) {
  return { asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT', ...over };
}

function authority(over = {}) {
  return { spend: [grant()], ...over };
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

function paymentRequired(url, over = {}) {
  return { x402Version: 2, resource: { url }, accepts: [offer(over)] };
}

function inspection() {
  return {
    verified: true,
    authDigest: AUTH_DIGEST,
    effect: EXPECTED,
    checks: { prepared: true, authorization: true },
    reason: 'ok',
  };
}

function fakePorts(over = {}) {
  const calls = { discover: 0, prepare: 0, inspect: 0, send: 0, verify: 0, reserved: [] };
  const ports = {
    http: {
      async discover(req) {
        calls.discover += 1;
        if (over.discover) return over.discover(req);
        return { status: 402, paymentRequired: paymentRequired(req.url) };
      },
      async sendPaid(req) {
        calls.send += 1;
        if (over.sendPaid) return over.sendPaid(req);
        return {
          status: 200,
          settlement: {
            success: true,
            transaction: TX_HASH,
            payer: 'PAYER',
            network: 'stellar:testnet',
            amount: '100000',
            ...(over.settlement || {}),
          },
          readBody: async () => PLAN,
        };
      },
    },
    signer: {
      async prepare() {
        calls.prepare += 1;
        return { authorization: AUTHORIZATION };
      },
    },
    async inspectPrepared(prepared, req) {
      calls.inspect += 1;
      if (over.inspectPrepared) return over.inspectPrepared(prepared, req);
      return inspection();
    },
    async verifySettlement(evidence, req) {
      calls.verify += 1;
      if (over.verifySettlement) return over.verifySettlement(evidence, req);
      return { verified: true, checks: { transfer: true }, reason: 'readback' };
    },
    validateOutput: over.validateOutput || ((body) => ({ ok: true, output: body, digest: PLAN_DIGEST })),
  };
  ports.claims = over.claims || {
    reserveEffect: (key) => {
      calls.reserved.push(key);
      return 'claimed';
    },
    claimTransaction: () => 'claimed',
  };
  return { ports, calls };
}

const newOp = (auth = authority(), goal = 'paid marketing plan') => createOperation({ goal, action: 'pay', authority: auth });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// A rejection nobody consumes ends the host process by default, which is what the first two cases
// are about: the kernel may refuse a promise as not a claim, but it may not crash the host for it.
function captureUnhandled() {
  const seen = [];
  const onRejection = (reason) => { seen.push(reason); };
  process.on('unhandledRejection', onRejection);
  return { seen, stop: () => { process.off('unhandledRejection', onRejection); } };
}

// =====================================================================================
// Group R3-A — a claims store that answers with a promise (advisor fix 1)
// =====================================================================================

test('R3-01 a claims store whose reserveEffect answers with a rejected promise leaves no unhandled rejection behind', async () => {
  const cap = captureUnhandled();
  const { ports, calls } = fakePorts({
    claims: {
      reserveEffect: async () => { throw new Error(PRIVATE_MARKER); },
      claimTransaction: () => 'claimed',
    },
  });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  await sleep(20);
  cap.stop();
  assert.equal(calls.send, 0, 'nothing may be sent without a reservation');
  assert.equal(cap.seen.length, 0, `unhandled rejection escaped the contract: ${cap.seen.map(String).join(' | ')} (status ${res.status})`);
});

test('R3-02 a claimTransaction that answers with a rejected promise after the send leaves no unhandled rejection behind', async () => {
  const cap = captureUnhandled();
  const { ports, calls } = fakePorts({
    claims: {
      reserveEffect: () => 'claimed',
      claimTransaction: async () => { throw new Error(PRIVATE_MARKER); },
    },
  });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  await sleep(20);
  cap.stop();
  assert.equal(calls.send, 1, 'the send is the case: the claim is taken after the payment went out');
  assert.notEqual(res.status, 'verified');
  assert.equal(cap.seen.length, 0, `unhandled rejection escaped the contract: ${cap.seen.map(String).join(' | ')} (status ${res.status})`);
});

// =====================================================================================
// Group R3-B — the judged budget is the armed budget (advisor fix 2)
// =====================================================================================

test('R3-03 the verify budget judged when the run options were built is the budget armed at verification', async () => {
  const io = { now: () => CLOCK_MS, verifyTimeoutMs: 1000 };
  const { ports } = fakePorts({
    // Host configuration that changes while the payment is in flight, as a reloaded settings object does.
    discover: async (req) => {
      io.verifyTimeoutMs = 2 ** 31;
      return { status: 402, paymentRequired: paymentRequired(req.url) };
    },
    verifySettlement: async () => {
      await sleep(20);
      return { verified: true, checks: { transfer: true }, reason: 'readback' };
    },
  });
  let res = null;
  try {
    res = await kernel.createX402Payment(spec(), ports).run(newOp(), io);
  } catch {
    return; // refused is acceptable; the ceiling is judged on the copy
  }
  assert.equal(res.status, 'verified', `a settled payment was sealed ${res.status}: ${res.receipt?.verification?.reason}`);
});

test('R3-04 the same time-of-check to time-of-use through a getter: 1000 ms when copied, 2^31 ms when the timer is armed', async () => {
  let reads = 0;
  const io = {
    now: () => CLOCK_MS,
    get verifyTimeoutMs() {
      reads += 1;
      return reads === 1 ? 1000 : 2 ** 31;
    },
  };
  const { ports } = fakePorts({
    verifySettlement: async () => {
      await sleep(20);
      return { verified: true, checks: { transfer: true }, reason: 'readback' };
    },
  });
  let res = null;
  try {
    res = await kernel.createX402Payment(spec(), ports).run(newOp(), io);
  } catch {
    return;
  }
  assert.equal(res.status, 'verified', `got ${res.status} after ${reads} reads of verifyTimeoutMs: ${res.receipt?.verification?.reason}`);
});

// =====================================================================================
// Group R3-C — what the validator said, which is a declared limit and not a defect
// =====================================================================================

test('R3-05 a validator output with a nested proxy is not handed back as a plain body', {
  todo: "declared as a limit instead of repaired: the top-level plainness check is what refuses a list, an accessor or a proxy as the body itself, and values nested inside the body are handed back as the validator returned them. The recursive check is 0.1.5 work, and `isPlainData` would cut legitimate JSON bodies deeper than eight levels after the payment went out. The comment now says so (advisor R3-05, fix 4).",
}, async () => {
  const inner = new Proxy({}, {
    get() { throw new Error(PRIVATE_MARKER); },
    ownKeys() { throw new Error(PRIVATE_MARKER); },
  });
  const { ports } = fakePorts({ validateOutput: () => ({ ok: true, output: { title: 'Plan', inner }, digest: PLAN_DIGEST }) });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  const handed = res.output && res.output.inner;
  assert.equal(handed !== undefined && types.isProxy(handed), false, `status ${res.status}: a proxy reached the host as part of a plain body`);
});

test('R3-06 a validator output with a nested accessor is not handed back as a plain body', {
  todo: "same declared limit as R3-05: plainness is checked at the top level only and nested descriptors are not inspected. The comment above `readDelivery` now says exactly that (advisor R3-06, fix 4).",
}, async () => {
  let calls = 0;
  const nested = {};
  Object.defineProperty(nested, 'x', { enumerable: true, get() { calls += 1; return calls; } });
  const { ports } = fakePorts({ validateOutput: () => ({ ok: true, output: { title: 'Plan', nested }, digest: PLAN_DIGEST }) });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  const descriptor = res.output && res.output.nested && Object.getOwnPropertyDescriptor(res.output.nested, 'x');
  assert.equal(Boolean(descriptor && descriptor.get), false, `status ${res.status}: an accessor reached the host inside the body`);
});

test('R3-07 the output handed back is the body whose digest went on the receipt', {
  todo: "the digest is the validator's word: this module checks its shape, records it, and neither recomputes it nor compares it with `output`, because the body may be a form the kernel never serialized. The comment above `readDelivery` now says so (advisor R3-07, fix 5).",
}, async () => {
  const { ports } = fakePorts({ validateOutput: () => ({ ok: true, output: { forged: true }, digest: PLAN_DIGEST }) });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  if (res.status !== 'verified') return;
  const outDigest = createHash('sha256').update(JSON.stringify(res.output), 'utf8').digest('hex');
  assert.equal(outDigest, PLAN_DIGEST, 'a verified receipt carries a digest that is not the digest of the output handed back');
});

test('R3-10 EFFECT_KEY_VERSION is the version actually hashed: a host can recompute the reserved key', {
  todo: "unreachable by construction and never to be asserted: the idempotency key the effect key is built from is deliberately not exported, so a host that wants to reconstruct a key has to store the key its claims store received. That is a decision about what leaves the process, not a defect; the release note no longer promises a recomputation (advisor R3-10, fix 6).",
}, async () => {
  const { ports, calls } = fakePorts();
  await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  assert.equal(calls.reserved.length, 1);
  const { operationIdempotencyKey } = require('../src/operation.js');
  if (typeof operationIdempotencyKey !== 'function') {
    assert.fail('the idempotency key the effect key is built from is not exported, so a host cannot recompute the key from the exported version alone');
  }
});

// =====================================================================================
// Group R3-D — what the round found already true
// =====================================================================================

test('R3-08 a contradicting settlement payer written by the server carries no unbounded text into the receipt', async () => {
  const LONG = `${SECRET_SHAPED}${'X'.repeat(100_000)}`;
  const { ports } = fakePorts({ settlement: { payer: LONG } });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  const text = JSON.stringify(res.receipt);
  assert.notEqual(res.status, 'verified');
  assert.equal(text.includes(SECRET_SHAPED), false, `server-written payer reached the receipt (${text.length} chars, status ${res.status})`);
});

test('R3-09 the exported control catalog is a frozen copy: tampering neither throws through nor widens the gate', async () => {
  const names = kernel.SETTLEMENT_CONTROL_NAMES;
  assert.equal(Object.isFrozen(names), true);
  assert.throws(() => {
    'use strict';
    names.push('evil');
  });
  try {
    names[0] = 'evil';
  } catch {
  }
  const { ports } = fakePorts({ verifySettlement: async () => ({ verified: true, checks: { evil: true }, reason: 'readback' }) });
  const res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS });
  assert.notEqual(res.status, 'verified');
  assert.deepEqual([...names].sort(), ['authorization', 'exactAmount', 'invocation', 'payer', 'prepared', 'source', 'transfer']);
});

test('R3-11 a perform budget above the timer ceiling is refused before any port, like the verify budget', async () => {
  const { ports, calls } = fakePorts({
    sendPaid: async () => {
      await sleep(30);
      return {
        status: 200,
        settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
        readBody: async () => PLAN,
      };
    },
  });
  let res = null;
  let error = null;
  // Arming a 2^31 ms delay is what makes node warn about the overflow; the case is the overflow.
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    res = await kernel.createX402Payment(spec(), ports).run(newOp(), { now: () => CLOCK_MS, performTimeoutMs: 2 ** 31 });
  } catch (thrown) {
    error = thrown;
  } finally {
    process.emitWarning = emitWarning;
  }
  if (error !== null) {
    assert.equal(error.code, 'VESPI_X402_INVALID_IO', 'the budget is refused with the public code of this module');
    assert.equal(calls.send, 0, 'a refused budget means nothing went on the wire');
    return;
  }
  await sleep(50);
  assert.equal(calls.send, 0, `the payment went to the wire under a 1 ms engine budget and ended ${res.status}: ${res.receipt?.detail || res.receipt?.verification?.reason}`);
});

test('R3-12 two operations with the same goal both pay, and the same operation rebuilt with its id is a duplicate', async () => {
  const claims = kernel.createMemoryPaymentClaims();
  const a = fakePorts({ claims, settlement: { transaction: 'b'.repeat(64) } });
  const b = fakePorts({ claims, settlement: { transaction: 'c'.repeat(64) } });
  const opA = newOp();
  const opB = newOp();
  assert.notEqual(opA.id, opB.id);
  const ra = await kernel.createX402Payment(spec(), a.ports).run(opA, { now: () => CLOCK_MS });
  const rb = await kernel.createX402Payment(spec(), b.ports).run(opB, { now: () => CLOCK_MS });
  assert.equal(ra.status, 'verified', ra.receipt?.detail);
  assert.equal(rb.status, 'verified', rb.receipt?.detail);
  const rebuilt = createOperation({ goal: 'paid marketing plan', action: 'pay', authority: authority() });
  rebuilt.id = opA.id;
  const c = fakePorts({ claims });
  const rc = await kernel.createX402Payment(spec(), c.ports).run(rebuilt, { now: () => CLOCK_MS });
  assert.equal(c.calls.send, 0, `a rebuilt retry of the same operation was sent again (${rc.status})`);
});