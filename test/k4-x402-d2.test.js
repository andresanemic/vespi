'use strict';
// D2 — the claims register is a port the host has to pass, and the effect it deduplicates carries the
// identity of the operation.
//
// Two defects were found together, and they are the same defect seen from both sides. The x402
// contract accepted an absent `claims` port and fell back on one store shared by every payment in the
// process: the host never decided where deduplication lives, and two unrelated operations were coupled
// through a set nobody could inspect. And the effect key hashed the operation's idempotency key, which
// is derived from goal, action and requirements and carries no identity of its own: two different
// operations with the same meta, action and requirements were the same effect, and the second was
// DUPLICATE_EFFECT until the process died.
//
// What is asserted here: a contract without an explicit claims store is not built at all; a malformed
// store, an accessor or a proxy is refused instead of called; two distinct operations pay twice; the
// same operation, rebuilt with its own identity, is refused as a duplicate; an operation whose identity
// cannot be read never reaches the wire; and the idempotency key handed to the provider is a hint that
// is still the operation key of today.
//
// Synthetic data, synthetic ports, no network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { types: utilTypes } = require('node:util');

const { createOperation } = require('../src/operation.js');

const RAW_URL = 'https://example.test/pay';
const CANONICAL_URL = new URL(RAW_URL).toString();
const CLOCK_MS = Date.parse('2040-01-01T00:00:00.000Z');
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
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
    effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
    checks: { prepared: true, authorization: true },
    reason: 'prepared transaction matches declared effect',
    ...over,
  };
}

// A host store whose answers are observable, so a test can see what was reserved and what was claimed
// without reading the kernel. Every counter here is a simulated port counter: no state is shared
// between two tests unless a test shares a store on purpose.
// Every default settlement carries its own hash: two ports that answer the same transaction hash would
// collide in the shared store and the second payment would be refused for a transaction it never sent.
let settlementSeq = 0;

function fakePorts(over = {}) {
  const calls = { discover: 0, prepare: 0, inspect: 0, send: 0, verifySettlement: 0, claimTransaction: 0, reserveEffect: 0 };
  const seen = { keys: [], hints: [], transactions: [] };
  const ports = {
    calls,
    seen,
    http: {
      async discover(request) {
        calls.discover += 1;
        if (over.discover) return over.discover(request);
        return { status: 402, paymentRequired: paymentRequired({ resource: { url: request.url } }) };
      },
      async sendPaid(request) {
        calls.send += 1;
        seen.hints.push(request.idempotencyKey);
        if (over.sendPaid) return over.sendPaid(request);
        settlementSeq += 1;
        const tx = createHash('sha256').update(`SETTLEMENT-${settlementSeq}`, 'utf8').digest('hex');
        return {
          status: 200,
          settlement: { success: true, transaction: tx, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
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
    claims: {
      reserveEffect(key) {
        calls.reserveEffect += 1;
        seen.keys.push(key);
        if (over.claims) return over.claims.reserveEffect(key);
        if (over.reserveEffect) return over.reserveEffect(key);
        return 'claimed';
      },
      claimTransaction(network, txHash) {
        calls.claimTransaction += 1;
        seen.transactions.push({ network, txHash });
        if (over.claims) return over.claims.claimTransaction(network, txHash);
        if (over.claimTransaction) return over.claimTransaction(network, txHash);
        return 'claimed';
      },
    },
  };
  return ports;
}

function portsWithoutClaims(over = {}) {
  const ports = fakePorts(over);
  delete ports.claims;
  return ports;
}

function operation(over = {}) {
  return createOperation({ goal: 'paid marketing plan', action: 'pay', authority: authority(), agent: 'agent-1', ...over });
}

function runIo(over = {}) {
  return { now: () => CLOCK_MS, ...over };
}

function kernel() {
  return require('../src/x402.js');
}

// =====================================================================================
// Group D2-A — the claims store is a port the host passes, and nothing else
// =====================================================================================

test('D2-01 a contract with no claims port is not built: it fails closed with a public code', () => {
  const ports = portsWithoutClaims();
  let thrown = null;
  try {
    kernel().createX402Payment(spec(), ports);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, 'a payment with no store to deduplicate in is refused');
  assert.equal(thrown.code, 'VESPI_X402_CLAIMS_REQUIRED', 'the code is public, so a host does not read the text');
  assert.match(thrown.message, /claims/, 'the message names the port that is missing');
  assert.equal(ports.calls.discover, 0);
});

test('D2-02 a contract with no claims port is refused the same way whatever else is wrong', () => {
  for (const claims of [undefined, null]) {
    const ports = fakePorts();
    ports.claims = claims;
    assert.throws(
      () => kernel().createX402Payment(spec(), ports),
      (err) => err instanceof Error && err.code === 'VESPI_X402_CLAIMS_REQUIRED',
      `claims: ${String(claims)}`,
    );
  }
});

test('D2-03 the missing store is named before anything else about the ports is judged', () => {
  // One code per missing thing: a contract with no store and a broken signer is still a contract with
  // no store, and a host that fixed the signer first would be reading the wrong message.
  const ports = portsWithoutClaims();
  ports.signer = {};
  assert.throws(
    () => kernel().createX402Payment(spec(), ports),
    (err) => err instanceof Error && err.code === 'VESPI_X402_CLAIMS_REQUIRED',
  );
});

test('D2-04 a malformed claims store fails closed instead of being called', () => {
  const cases = [
    ['a text', 'shared'],
    ['false', false],
    ['zero', 0],
    ['an empty text', ''],
    ['an array', [{ reserveEffect: () => 'claimed', claimTransaction: () => 'claimed' }]],
    ['without reserveEffect', { claimTransaction: () => 'claimed' }],
    ['without claimTransaction', { reserveEffect: () => 'claimed' }],
    ['with a method that is not a function', { reserveEffect: 'claimed', claimTransaction: () => 'claimed' }],
  ];
  for (const [label, claims] of cases) {
    const ports = fakePorts();
    ports.claims = claims;
    assert.throws(
      () => kernel().createX402Payment(spec(), ports),
      (err) => err instanceof Error && err.code === 'VESPI_X402_INVALID_PORT',
      label,
    );
  }
});

test('D2-05 a claims store that answers through accessors or a proxy is refused before it is called', () => {
  let called = 0;
  const answering = {
    get reserveEffect() { called += 1; return () => 'claimed'; },
    get claimTransaction() { called += 1; return () => 'claimed'; },
  };
  const throwing = {
    get reserveEffect() { throw new Error(PRIVATE_MARKER); },
    claimTransaction: () => 'claimed',
  };
  const proxied = new Proxy({ reserveEffect: () => 'claimed', claimTransaction: () => 'claimed' }, {});
  for (const claims of [answering, throwing, proxied]) {
    const ports = fakePorts();
    ports.claims = claims;
    assert.throws(
      () => kernel().createX402Payment(spec(), ports),
      (err) => err instanceof Error && (err.code === 'VESPI_X402_INVALID_PORT' || err.code === 'VESPI_X402_CLAIMS_REQUIRED'),
      'an accessor or a proxy store is not a store',
    );
  }
  assert.equal(called, 0, 'an accessor must be refused by its descriptor, never invoked');
});

test('D2-06 a store whose methods throw on a proxy is refused and its message never travels', () => {
  const traps = {
    get() { throw new Error(PRIVATE_MARKER); },
    getPrototypeOf() { throw new Error(PRIVATE_MARKER); },
  };
  const ports = fakePorts();
  ports.claims = new Proxy({ reserveEffect: () => 'claimed', claimTransaction: () => 'claimed' }, traps);
  let thrown = null;
  try {
    kernel().createX402Payment(spec(), ports);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error);
  assert.equal(thrown.code, 'VESPI_X402_INVALID_PORT');
  assert.equal(thrown.message.includes(PRIVATE_MARKER), false, 'the trap text is host-written and does not travel');
});

test('D2-07 the memory factory is still exported and still an explicit choice', async () => {
  const store = kernel().createMemoryPaymentClaims();
  const first = await kernel().createX402Payment(spec(), fakePorts({ claims: store })).run(operation(), runIo());
  const second = await kernel().createX402Payment(spec(), fakePorts({ claims: store })).run(operation(), runIo());
  assert.equal(first.status, 'verified');
  // A second store starts empty: no process-wide set is left behind for anyone to inherit.
  const other = kernel().createMemoryPaymentClaims();
  const third = await kernel().createX402Payment(spec(), fakePorts({ claims: other })).run(operation(), runIo());
  assert.equal(third.status, 'verified');
  assert.equal(second.status, 'verified');
});

// =====================================================================================
// Group D2-B — the effect key carries the identity of the operation
// =====================================================================================

test('D2-08 two distinct operations with the same meta, action and requirements both pay', async () => {
  // The finding: the key was the operation idempotency key, which is derived from goal, action and
  // requirements, so two operations that wanted the same thing were one effect and the second was
  // DUPLICATE_EFFECT for the life of the process.
  const store = kernel().createMemoryPaymentClaims();
  const firstPorts = fakePorts({ claims: store });
  const secondPorts = fakePorts({ claims: store });
  const first = await kernel().createX402Payment(spec(), firstPorts).run(operation(), runIo());
  const second = await kernel().createX402Payment(spec(), secondPorts).run(operation(), runIo());
  assert.equal(first.status, 'verified', `first: ${first.receipt?.detail}`);
  assert.equal(second.status, 'verified', `second: ${second.receipt?.detail}`);
  assert.equal(firstPorts.calls.send, 1);
  assert.equal(secondPorts.calls.send, 1);
  assert.equal(firstPorts.seen.keys.length, 1);
  assert.notEqual(firstPorts.seen.keys[0], secondPorts.seen.keys[0], 'two operations, two effect keys');
});

test('D2-09 the same operation, rebuilt with the same identity, is a duplicate and sends nothing', async () => {
  // What a host does after a restart or after it reloads an operation from durable storage: it builds
  // the operation again, identity included, and runs it. That is the retry the key exists for.
  const store = kernel().createMemoryPaymentClaims();
  const first = operation();
  const retried = operation();
  retried.id = first.id;
  const firstPorts = fakePorts({ claims: store });
  const secondPorts = fakePorts({ claims: store });
  const before = await kernel().createX402Payment(spec(), firstPorts).run(first, runIo());
  const again = await kernel().createX402Payment(spec(), secondPorts).run(retried, runIo());
  assert.equal(before.status, 'verified', `first: ${before.receipt?.detail}`);
  assert.equal(again.status, 'blocked');
  assert.equal(again.receipt.reason, 'DUPLICATE_EFFECT');
  assert.deepEqual(again.receipt.authority.exercised, []);
  assert.equal(firstPorts.seen.keys[0], secondPorts.seen.keys[0], 'the same identity is the same effect');
  assert.equal(secondPorts.calls.prepare, 0, 'nothing is prepared for an effect already reserved');
  assert.equal(secondPorts.calls.send, 0);
});

test('D2-10 the effect key is the canonical effect plus the operation identity, and nothing else', async () => {
  // Pinned by a second implementation (python: json.dumps with sorted keys at every level, then
  // sha256), not by the function under test: .job/tmp/d2-vectors.py. Content:
  // {"expected":{...},"operation":"op-d2-vector","operationKey":"<hash of goal, action, requirements>",
  //  "request":{"method":"GET","url":"https://example.test/pay"},"version":2}
  const ports = fakePorts();
  const op = operation();
  op.id = 'op-d2-vector';
  const res = await kernel().createX402Payment(spec(), ports).run(op, runIo());
  assert.equal(res.status, 'verified', `got ${res.status}: ${res.receipt?.detail}`);
  assert.equal(ports.seen.keys.length, 1);
  assert.match(ports.seen.keys[0], /^[0-9a-f]{64}$/);
  assert.equal(ports.seen.keys[0], 'f91f14f7cdd1632337cbe9a9bfdda7f215e4a24dfa944cc2bed812c753c55099', 'the canonical effect hash with the identity, verified by a second implementation');
});

test('D2-11 the idempotency key sent to the provider is a hint, and it is still the operation key', async () => {
  const store = kernel().createMemoryPaymentClaims();
  const firstPorts = fakePorts({ claims: store });
  const secondPorts = fakePorts({ claims: store });
  await kernel().createX402Payment(spec(), firstPorts).run(operation(), runIo());
  await kernel().createX402Payment(spec(), secondPorts).run(operation(), runIo());
  const first = firstPorts.seen.hints[0];
  const second = secondPorts.seen.hints[0];
  assert.equal(typeof first, 'string');
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second, 'the hint is a function of the declared effect, not of the operation identity');
  assert.notEqual(first, firstPorts.seen.keys[0], 'the hint is not the effect key: it is a hint');
});

test('D2-12 a store that answers a promise is still not a claim', async () => {
  const ports = fakePorts();
  ports.claims = {
    reserveEffect: async () => 'claimed',
    claimTransaction: async () => 'claimed',
  };
  const res = await kernel().createX402Payment(spec(), ports).run(operation(), runIo());
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.reason, 'CLAIMS_CAPACITY');
  assert.equal(ports.calls.send, 0);
});

// =====================================================================================
// Group D2-C — an operation whose identity cannot be read never reaches the wire
// =====================================================================================

test('D2-13 an operation whose identity is missing or unusable is blocked and nothing is reserved', async () => {
  const broken = [
    ['no id', (op) => { delete op.id; }],
    ['an empty id', (op) => { op.id = ''; }],
    ['an id that is not text', (op) => { op.id = 17; }],
    ['an id longer than the text ceiling', (op) => { op.id = 'i'.repeat(600); }],
  ];
  for (const [label, damage] of broken) {
    const ports = fakePorts({ claims: kernel().createMemoryPaymentClaims() });
    const op = operation();
    damage(op);
    const res = await kernel().createX402Payment(spec(), ports).run(op, runIo());
    assert.equal(res.status, 'blocked', `${label}: got ${res.status}`);
    assert.equal(res.receipt.reason, 'OPERATION_IDENTITY', label);
    assert.deepEqual(res.receipt.authority.exercised, [], label);
    assert.equal(ports.calls.send, 0, `${label}: nothing goes out`);
    assert.equal(ports.calls.reserveEffect, 0, `${label}: no key was built out of an identity nobody could read`);
  }
});

test('D2-13b an identity that throws blocks the run and its text never reaches a receipt', async () => {
  // An operation whose identity throws cannot be sealed into a receipt either, because the receipt
  // names the operation it belongs to. The base engine answers that with its fallback receipt, and
  // this module is not touched to improve it: what matters here is that nothing went out and that the
  // trap's own text, which is host-written, is nowhere in what came back.
  const ports = fakePorts({ claims: kernel().createMemoryPaymentClaims() });
  const op = operation();
  Object.defineProperty(op, 'id', { enumerable: true, get() { throw new Error(PRIVATE_MARKER); } });
  const res = await kernel().createX402Payment(spec(), ports).run(op, runIo());
  assert.equal(res.status, 'blocked');
  assert.equal(ports.calls.send, 0);
  assert.equal(ports.calls.reserveEffect, 0);
  assert.equal(JSON.stringify(res.receipt).includes(PRIVATE_MARKER), false);
});

test('D2-14 an operation whose identity answers differently on a second read is read once before the key', async () => {
  // The kernel cannot tell a proxy or an accessor from the operation itself, and it does not try: it
  // reads the identity once, inside a guard, and that answer is the one the key is built from. The
  // limit is honest and belongs to the host: an operation whose identity lies is still an operation
  // the kernel pays for, under the identity it was given.
  const op = operation();
  const real = op.id;
  let reads = 0;
  let readsWhenReserved = -1;
  const lying = new Proxy(op, {
    get(target, key, receiver) {
      if (key === 'id') { reads += 1; return reads === 1 ? real : `${real}-other`; }
      return Reflect.get(target, key, receiver);
    },
  });
  const inner = kernel().createMemoryPaymentClaims();
  const ports = fakePorts({
    claims: inner,
    reserveEffect: () => 'claimed',
  });
  ports.claims.reserveEffect = (key) => {
    readsWhenReserved = reads;
    return inner.reserveEffect(key);
  };
  const res = await kernel().createX402Payment(spec(), ports).run(lying, runIo());
  assert.equal(res.status, 'verified', `got ${res.status}: ${res.receipt?.detail}`);
  assert.equal(ports.calls.send, 1);
  assert.equal(readsWhenReserved, 1, 'the identity is read once, so no second answer is left to decide the key');
});

test('D2-15 a claims store that throws while reserving is a run that cannot deduplicate', async () => {
  const ports = fakePorts();
  ports.claims = {
    reserveEffect() { throw new Error(PRIVATE_MARKER); },
    claimTransaction: () => 'claimed',
  };
  const res = await kernel().createX402Payment(spec(), ports).run(operation(), runIo());
  assert.equal(res.status, 'failed');
  assert.equal(res.receipt.detail, 'CLAIMS_CAPACITY');
  assert.equal(ports.calls.send, 0);
  assert.equal(JSON.stringify(res.receipt).includes(PRIVATE_MARKER), false, 'the store wrote it');
});

test('D2-16 the module still exports exactly the three names it exported before', () => {
  assert.deepEqual(Object.keys(kernel()).sort(), ['createMemoryPaymentClaims', 'createX402Payment', 'selectX402Terms']);
  assert.equal(utilTypes.isProxy(kernel()), false);
});