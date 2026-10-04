'use strict';
// Adversarial tests for the final review round of the x402 branch (R2-01..R2-12), written from the
// attacker's side and then held in the branch suite.
//
// What this round attacks is not a new surface but two invariants the earlier rounds already
// declared, applied case by case instead of structurally: "a port answer is read once" and "no text
// written by a port travels into a sealed receipt". The rest is blocking: cases where the engine
// refuses more than it should because one grant, one store or one answer ended a loop that a single
// entry was allowed to close.
//
// The reference bridge cases (R2-11, R2-12) execute demo/x402/ports.js with the SDK stubbed. The
// coordinator's decision on this round was to trim that surface: the demo runner went back to the
// base version, nothing loads ports.js any more, and a pending reference that was never executed with
// the real SDK cannot be a test. Those two cases stay here as `todo` so the claim is not lost.
//
// Synthetic data and synthetic ports, no network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const kernel = require('../src/x402.js');
const { createOperation } = require('../src/operation.js');

const RAW_URL = 'https://example.test/pay';
const CANONICAL_URL = new URL(RAW_URL).toString();
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

function paymentRequired(url) {
  return { x402Version: 2, resource: { url }, accepts: [offer()] };
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
  const calls = { discover: 0, prepare: 0, inspect: 0, send: 0, verifySettlement: 0 };
  const ports = {
    http: {
      async discover(request) {
        calls.discover += 1;
        if (over.discover) return over.discover(request);
        return { status: 402, paymentRequired: paymentRequired(request.url) };
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
      return { ok: true, output: body, digest: PLAN_DIGEST };
    },
  };
  ports.claims = over.claims || {
    reserveEffect: () => 'claimed',
    claimTransaction: () => 'claimed',
  };
  return { ports, calls };
}

function newOp(auth = authority(), goal = 'paid marketing plan') {
  return createOperation({ goal, action: 'pay', authority: auth });
}

async function runOnce(ports, io = {}, auth = authority()) {
  return kernel.createX402Payment(spec(), ports).run(newOp(auth), { now: () => CLOCK_MS, ...io });
}

// =====================================================================================
// Group R2-A — no text written by a port travels into a sealed receipt
// =====================================================================================

test('R2-01 a secret-shaped settlement control name does not travel into the sealed receipt', async () => {
  // The settlement verdict is admitted whole, so its control names are the seam between what a host
  // writes and what a sealed receipt carries. The identifier shape still admits a 64-character token
  // with the shape of a Stellar seed, and it was sealed as `settlement_<name>`.
  const { ports } = fakePorts({
    verifySettlement: async () => ({ verified: true, checks: { transfer: true, [SECRET_SHAPED]: true }, reason: 'readback' }),
  });
  const res = await runOnce(ports);
  assert.equal(
    JSON.stringify(res.receipt).includes(SECRET_SHAPED),
    false,
    'port-written identifier text reached the receipt',
  );
});

// =====================================================================================
// Group R2-B — the engine must not block more than it should
// =====================================================================================

test('R2-02 an expired old grant next to a live renewed grant for the same recipient still pays', async () => {
  // One expired entry was enough to end the whole loop, so renewing a permission could not unblock a
  // payment the person had already renewed. Coverage is a per-entry question.
  const auth = {
    spend: [grant({ expiresAt: '2039-01-01T00:00:00.000Z' }), grant({ expiresAt: '2041-01-01T00:00:00.000Z' })],
  };
  const { ports, calls } = fakePorts();
  const res = await runOnce(ports, {}, auth);
  assert.equal(res.status, 'verified', `got blocked: ${res.receipt?.detail}`);
  assert.equal(calls.send, 1);
});

test('R2-04 a plain claims store whose methods use `this` is called on its own receiver', async () => {
  // The kernel copied the two functions off the store and called them detached, so the simplest
  // durable store in the world, a plain object with two methods, answered on the wrong `this`.
  const claims = {
    effects: new Set(),
    transactions: new Set(),
    reserveEffect(key) {
      if (this.effects.has(key)) return 'duplicate';
      this.effects.add(key);
      return 'claimed';
    },
    claimTransaction(network, txHash) {
      const key = `${network}:${txHash}`;
      if (this.transactions.has(key)) return 'duplicate';
      this.transactions.add(key);
      return 'claimed';
    },
  };
  const { ports, calls } = fakePorts({ claims });
  const res = await runOnce(ports);
  assert.equal(res.status, 'verified', `got failed: ${res.receipt?.detail}`);
  assert.equal(calls.send, 1);
});

test('R2-03 a discovery answer whose status getter throws does not leak the port message into the receipt', async () => {
  // `status` was read outside a guard, so the trap answered the read and the engine carried the
  // exception text, which is host-written text, into the receipt.
  const { ports, calls } = fakePorts({
    discover: async () => ({ get status() { throw new Error(PRIVATE_MARKER); }, paymentRequired: {} }),
  });
  const res = await runOnce(ports);
  assert.equal(calls.send, 0);
  assert.equal(
    JSON.stringify(res.receipt).includes(PRIVATE_MARKER),
    false,
    `receipt detail: ${res.receipt?.detail}`,
  );
});

// =====================================================================================
// Group R2-C — an answer is read once
// =====================================================================================

test('R2-06 the prepared authorization read three times cannot hand a non-string to inspection and send', async () => {
  // `prepared?.authorization` was read twice for the type and twice more for the value, so a getter
  // that answered a string to the check could hand an object to the inspector and to the wire.
  let reads = 0;
  const { ports } = fakePorts({
    prepare: async () => ({
      get authorization() {
        reads += 1;
        return reads < 3 ? AUTHORIZATION : { not: 'a string' };
      },
    }),
  });
  let seenByInspector = null;
  ports.inspectPrepared = async (auth) => {
    seenByInspector = auth;
    return inspection();
  };
  await runOnce(ports);
  assert.equal(
    typeof seenByInspector === 'string' || seenByInspector === null,
    true,
    `inspector received ${typeof seenByInspector}`,
  );
  assert.equal(reads <= 1, true, `the authorization was read ${reads} times`);
});

// =====================================================================================
// Group R2-D — the defences that must stay green
// =====================================================================================

test('R2-08 a __proto__ settlement control name neither pollutes nor verifies', async () => {
  const checks = JSON.parse('{"transfer":true,"__proto__":true}');
  const { ports } = fakePorts({ verifySettlement: async () => ({ verified: true, checks, reason: 'readback' }) });
  const res = await runOnce(ports);
  assert.equal(({}).polluted, undefined);
  assert.notEqual(res.status, 'verified');
  assert.equal(res.output, null);
});

test('R2-09 when the engine gives up during inspection nothing is sent afterwards', async () => {
  const { ports, calls } = fakePorts({
    inspectPrepared: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 60); });
      return inspection();
    },
  });
  const res = await runOnce(ports, { performTimeoutMs: 10 });
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  assert.equal(calls.send, 0, 'a send happened after the engine closed the run');
  assert.notEqual(res.status, 'verified');
});

test('R2-10 the human-gate path still pays after the pre-send authority revalidation', async () => {
  // The pre-send revalidation must not confuse "no grant named this recipient" with "the person said
  // yes at the gate": an empty spend list is the healthy shape of an ask-first payment.
  const { ports, calls } = fakePorts();
  const res = await kernel.createX402Payment(spec(), ports).run(newOp({ spend: [] }), {
    now: () => CLOCK_MS,
    ask: async () => ({ approved: true, by: 'person' }),
  });
  assert.equal(calls.send, 1, `got ${res.status}: ${res.receipt?.detail}`);
  assert.equal(res.status, 'verified');
});

// =====================================================================================
// Group R2-E — the two the reviewer left as documented risks, kept as failing claims
// =====================================================================================

test('R2-05 a payment refused before the wire can be retried once the grant is renewed', {
  todo: "risk, not a fix of this round: the effect key is reserved before the preparation and nothing releases it, so a refusal before the send burns the key until the process restarts. Releasing a reservation is a design decision (a crash could have sent anyway), not a hardening fix.",
}, async () => {
  const claims = kernel.createMemoryPaymentClaims();
  let clock = CLOCK_MS;
  const expiring = new Date(CLOCK_MS + 1000).toISOString();
  const first = fakePorts({
    claims,
    inspectPrepared: async () => {
      clock = CLOCK_MS + 5000;
      return inspection();
    },
  });
  const before = await kernel.createX402Payment(spec(), first.ports).run(
    newOp(authority({ spend: [grant({ expiresAt: expiring })] })),
    { now: () => clock },
  );
  assert.equal(first.calls.send, 0, 'the first run must not send');
  assert.equal(before.receipt.authority.exercised.length, 0, 'nothing exercised on the first run');
  const second = fakePorts({ claims });
  const renewed = authority({ spend: [grant({ expiresAt: new Date(CLOCK_MS + 86_400_000).toISOString() })] });
  const after = await kernel.createX402Payment(spec(), second.ports).run(newOp(renewed), { now: () => clock });
  assert.equal(second.calls.send, 1, `retry after a refusal that never sent was blocked: ${after.receipt?.detail}`);
});

test('R2-07 a verify budget above the timer ceiling does not turn a settled payment into not_verified', {
  todo: "risk, not a fix of this round: `verifyTimeoutMs` is only checked for being a positive finite number, so a budget above 2^31-1 ms overflows the timer and fires immediately. The same shape of read exists in operation.js, which is base code this branch does not touch.",
}, async () => {
  const { ports } = fakePorts({
    verifySettlement: async () => {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      return { verified: true, checks: { transfer: true }, reason: 'readback' };
    },
  });
  const res = await runOnce(ports, { verifyTimeoutMs: 2 ** 31 });
  assert.equal(res.status, 'verified', `got ${res.status}: ${res.receipt?.verification?.reason}`);
});

// =====================================================================================
// Group R2-F — the reference bridge, pending and not executed
// =====================================================================================

test('R2-11 the reference bridge verifies one payment end to end with the SDK stubbed', {
  todo: "withdrawn on the coordinator's decision for this round: demo/x402/ports.js went back to being a pending reference, nothing loads it, and the demo runner went to the base version. A bridge nobody runs cannot be asserted to verify a payment, and the shadow that made its verifier call itself is not worth repairing in a file no execution path reaches.",
}, async () => {
  // The original body needed the bridge evaluated with the SDK stubbed and counted the ledger
  // readbacks. It is kept as the claim it is: unproven. See test/k4-x402-advisor.test.js for what is
  // now asserted about that file, which is only its declared shape.
  const { ports, calls } = fakePorts();
  const res = await runOnce(ports);
  assert.equal(res.status, 'verified');
  assert.equal(calls.verifySettlement, 1);
});

test('R2-12 two concurrent runs over one bridge port set never report a send that did not happen', {
  todo: "withdrawn with R2-11 for the same reason: the case needs the bridge executed twice over the same port set, and the bridge is no longer executed. Its one substantive claim, that there is no I/O between preparing and sending, is a property of the ports and not of the kernel, and it was never a kernel guarantee.",
}, async () => {
  assert.equal(CANONICAL_URL.includes('example.test'), true);
});