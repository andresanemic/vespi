'use strict';

// H-X — what the real use of Casa Firme showed about the x402 contract, applied to the kernel.
//
// Casa Firme reproduces each of its findings against the kernel in its own suite
// (`test/dev/hallazgos-kernel.test.js`). This file transfers the reproduction of the one that is a
// defect and keeps the rest as what they are: observations, or questions that belong to the owner.
//
// What is asserted here:
//
//   Group A (defect, reproduced and fixed): `validateOutput` was called without `await` while the
//     other five ports were awaited. An `async` port — the natural choice when five neighbours are
//     async — was read as a promise and discarded, so the payment ended in DELIVERY_REJECTED with a
//     reason that blamed the delivery instead of the port. The port is awaited now, and these tests
//     pin that, including a port that rejects, a thenable whose `then` is a trap, a promise that
//     never settles and a port called twice.
//
//   Group B (the closed settlement control catalog, exported by the owner's decision): the gap was
//     real — a host that writes the settlement port has no way to learn the vocabulary — and the
//     vocabulary is now exported as a frozen copy, `SETTLEMENT_CONTROL_NAMES`, so a host can check
//     its own names without reading this repository. HX-08, HX-10 and HX-14 hold that the export is
//     the gate: every name it carries is admitted, nothing else is, and reading or writing the copy
//     cannot widen the closed set.

//   Group C (owner decisions still open, kept as todos): the reason a control name was refused, the
//     version of the effect key as a field of the receipt, the effect key itself as something a
//     receipt can be reconciled against, and a public catalog of codes. HX-15 belongs here and is
//     not a todo: the coordinator decided that the version of the canonical effect key is exported
//     instead, which is the half a host keeping keys outside the process can use.
//
// Out of scope by instruction: the identity of the operation in `createOperation` (hallazgo 4). That
// is `operation.js`, shared core, verified elsewhere; it is described in the report and not touched.
//
// Synthetic data, synthetic ports, no network, no credentials, no real payment and no ledger.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const { createOperation } = require('../src/operation.js');

const RAW_URL = 'https://example.test/pay';
const CANONICAL_URL = new URL(RAW_URL).toString();
const CLOCK_MS = Date.parse('2040-01-01T00:00:00.000Z');
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
const PLAN = { title: 'Queen Marketing Plan', summary: 'A 90-day plan.', deliverables: ['Landing page'], nextSteps: ['Launch week 1'] };
const PLAN_DIGEST = createHash('sha256').update(JSON.stringify(PLAN), 'utf8').digest('hex');
const TX = 'c'.repeat(64);
const EXPECTED_EFFECT = { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' };

function spec(over = {}) {
  return {
    id: 'x402-casafirme',
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

function operation(over = {}) {
  return createOperation({ goal: 'pay the plan', action: 'pay', authority: authority(), agent: 'agent-1', ...over });
}

// One store per payment, so two runs in this file cannot collide on a transaction hash, and every
// counter is a simulated port counter.
let settlementSeq = 0;

function fakePorts(over = {}) {
  const calls = { discover: 0, prepare: 0, inspect: 0, send: 0, verifySettlement: 0, validateOutput: 0, reserveEffect: 0, claimTransaction: 0 };
  const seen = { keys: [], transactions: [] };
  const ports = {
    calls,
    seen,
    http: {
      async discover(request) {
        calls.discover += 1;
        return {
          status: 402,
          paymentRequired: {
            x402Version: 2,
            resource: { url: request.url },
            accepts: [{
              scheme: 'exact', network: 'stellar:testnet', asset: 'TOKEN', payTo: 'RECIPIENT',
              amount: '100000', maxTimeoutSeconds: 300,
              extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
            }],
          },
        };
      },
      async sendPaid() {
        calls.send += 1;
        settlementSeq += 1;
        const tx = over.transaction || createHash('sha256').update(`SETTLEMENT-${settlementSeq}`, 'utf8').digest('hex');
        return {
          status: 200,
          settlement: { success: true, transaction: tx, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
          readBody: async () => PLAN,
        };
      },
    },
    signer: { async prepare() { calls.prepare += 1; return { authorization: AUTHORIZATION }; } },
    async inspectPrepared() {
      calls.inspect += 1;
      return {
        verified: true,
        authDigest: AUTH_DIGEST,
        effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
        checks: { prepared: true, authorization: true },
        reason: 'prepared transaction matches declared effect',
      };
    },
    async verifySettlement(evidence, request) {
      calls.verifySettlement += 1;
      if (over.verifySettlement) return over.verifySettlement(evidence, request);
      return { verified: true, checks: { transfer: true, payer: true }, reason: 'independent readback' };
    },
    validateOutput(body) {
      calls.validateOutput += 1;
      if (over.validateOutput) return over.validateOutput(body, calls.validateOutput);
      return { ok: true, output: body, digest: PLAN_DIGEST };
    },
    claims: {
      reserveEffect(key) {
        calls.reserveEffect += 1;
        seen.keys.push(key);
        return 'claimed';
      },
      claimTransaction(network, txHash) {
        calls.claimTransaction += 1;
        seen.transactions.push({ network, txHash });
        return 'claimed';
      },
    },
  };
  return ports;
}

async function runOnce(ports, over = {}, io = { now: () => CLOCK_MS }) {
  const kernel = require('../src/x402.js');
  return kernel.createX402Payment(spec(), ports).run(operation(), { ...io, ...over });
}

// Two runs that are comparable receipt by receipt: the same declared effect, the same settled
// transaction and the same operation identity, so the only thing left that can differ is how the
// validator port was written. The identity is fixed by hand because `createOperation` mints its own.
async function comparableRun(validateOutput) {
  const op = operation();
  op.id = 'op-comparable';
  const ports = fakePorts({ transaction: TX, validateOutput });
  return require('../src/x402.js').createX402Payment(spec(), ports).run(op, { now: () => CLOCK_MS });
}

function kernel() {
  return require('../src/x402.js');
}

// What a host that keeps effect keys outside the process (a register, a reconciliation table) has to
// be able to do: recompute the key this kernel reserved and compare it with a stored one. That is
// only possible if the version of the canonical content is a name the host can read, so the replica
// below is that host: it reads no private value of the module, only the exported version, the
// declaration this file wrote and the operation it built. The canonical form is sorted keys, which
// is what the module states about its own hash.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hostEffectKey(version, op, requirements) {
  const operationKey = sha256(JSON.stringify(canonicalize({ goal: op.goal, action: op.action, requirements })));
  return sha256(JSON.stringify(canonicalize({
    version,
    operation: op.id,
    operationKey,
    request: { url: CANONICAL_URL, method: 'GET' },
    expected: EXPECTED_EFFECT,
  })));
}

// =====================================================================================
// Group A — the delivery validator is a port like the other five, and it is awaited
// =====================================================================================

test('HX-01 an async validateOutput port is awaited, so the delivered body is covered', async () => {
  // The reproduction, brought over from Casa Firme's suite. Identical to a synchronous port except
  // that it promises: written that way because the five neighbouring ports are async.
  const asincrono = await runOnce(fakePorts({
    validateOutput: async (body) => ({ ok: true, output: body, digest: PLAN_DIGEST }),
  }));
  assert.equal(asincrono.receipt.verification.checks.settlement, true, 'the settlement did verify');
  assert.equal(asincrono.receipt.verification.checks.delivery, true, 'and so did the delivery');
  assert.equal(asincrono.receipt.status, 'verified');
  assert.equal(asincrono.output?.title, PLAN.title, 'the body the port validated is the one handed back');
  assert.doesNotMatch(asincrono.receipt.verification.reason, /DELIVERY_REJECTED/);
});

test('HX-02 the same port written synchronously verifies exactly the same way', async () => {
  // The compatibility half: awaiting a plain value changes nothing, so a host that wrote the port as
  // it is written today keeps the receipt it has today, digest included.
  const sincrono = await comparableRun((body) => ({ ok: true, output: body, digest: PLAN_DIGEST }));
  const asincrono = await comparableRun(async (body) => ({ ok: true, output: body, digest: PLAN_DIGEST }));
  assert.equal(sincrono.receipt.status, 'verified');
  assert.equal(asincrono.receipt.status, 'verified');
  assert.deepEqual(sincrono.receipt.evidence, asincrono.receipt.evidence, 'same evidence');
  assert.deepEqual(sincrono.receipt.verification.checks, asincrono.receipt.verification.checks, 'same checks');
  assert.equal(sincrono.receipt.digest, asincrono.receipt.digest, 'and the same sealed digest');
});

test('HX-03 a port that answers asynchronously with a refusal is a refusal, not a crash', async () => {
  const res = await runOnce(fakePorts({ validateOutput: async () => ({ ok: false }) }));
  assert.equal(res.receipt.status, 'not_verified');
  assert.equal(res.receipt.verification.checks.delivery, false);
  assert.equal(res.receipt.verification.checks.settlement, true, 'the settlement still stands on its own');
  assert.match(res.receipt.verification.reason, /DELIVERY_REJECTED/);
  assert.equal(res.output, null, 'nothing is exposed that nobody validated');
});

test('HX-04 a port that rejects asynchronously is caught like a port that throws', async () => {
  const res = await runOnce(fakePorts({
    validateOutput: async () => { throw new Error('the validator exploded'); },
  }));
  assert.equal(res.receipt.status, 'not_verified');
  assert.equal(res.receipt.verification.checks.delivery, false);
  assert.match(res.receipt.verification.reason, /DELIVERY_REJECTED/);
  assert.doesNotMatch(JSON.stringify(res.receipt), /exploded/, 'no message a port wrote travels into the receipt');
  assert.equal(res.receipt.evidence.txHash !== undefined, true, 'the settlement evidence is still there for the person');
});

test('HX-05 a thenable whose `then` is a trap cannot slip past the guard', async () => {
  const trampa = {
    then() { throw new Error('the thenable exploded'); },
  };
  const res = await runOnce(fakePorts({ validateOutput: () => trampa }));
  assert.equal(res.receipt.verification.checks.delivery, false);
  assert.match(res.receipt.verification.reason, /DELIVERY_REJECTED/);
});

test('HX-06 a promise that never settles is stopped by the run budget, and sends nothing twice', async () => {
  const ports = fakePorts({ validateOutput: () => new Promise(() => {}) });
  const res = await runOnce(ports, {}, { now: () => CLOCK_MS, performTimeoutMs: 60 });
  assert.equal(ports.calls.send, 1, 'the effect was paid once');
  assert.equal(ports.calls.validateOutput, 1, 'the port is called once, not again on the way out');
  assert.equal(res.receipt.status, 'not_verified', 'an effect whose outcome nobody saw is not verified');
  assert.match(res.receipt.verification.reason, /unknown after timeout/);
});

test('HX-07 the validator is called exactly once per run', async () => {
  const ports = fakePorts({ validateOutput: async (body) => ({ ok: true, output: body, digest: PLAN_DIGEST }) });
  await runOnce(ports);
  assert.equal(ports.calls.validateOutput, 1);
});

// =====================================================================================
// Group B — the closed catalog of settlement controls, exported by the owner's decision
//
// The finding was right about the gap: a host that writes the `verifySettlement` port has to know
// which control names are admitted, and the only place to read them was this repository. The owner
// decided that a frozen copy is exported (`SETTLEMENT_CONTROL_NAMES`, HX-08), and the three tests
// that pin the exports of `src/x402.js` (D2-16, K4-A1, K4-G2) moved with the word: they allow that
// name and the exported key version, and nothing else. A copy is exported, not the set the gate
// reads, so what a host can read cannot become what the gate accepts (HX-14).
// =====================================================================================

test('HX-08 a host can ask which settlement control names this kernel admits', () => {
  const { SETTLEMENT_CONTROL_NAMES } = kernel();
  assert.equal(Array.isArray(SETTLEMENT_CONTROL_NAMES), true, 'a host can read it without the file');
  assert.equal(Object.isFrozen(SETTLEMENT_CONTROL_NAMES), true, 'and it is frozen: reading it cannot widen it');
  // The names the one settlement reader in this tree emits (demo/x402/settlement.js).
  assert.deepEqual([...SETTLEMENT_CONTROL_NAMES].sort(), [
    'authorization', 'exactAmount', 'invocation', 'payer', 'prepared', 'source', 'transfer',
  ]);
  assert.deepEqual(
    SETTLEMENT_CONTROL_NAMES.filter((name) => typeof name !== 'string' || name.length === 0),
    [],
    'every entry is a name a host could compare against, with no hole where one should be',
  );
});

test('HX-14 the exported names are the gate itself: reading them cannot widen it', async () => {
  const { SETTLEMENT_CONTROL_NAMES } = kernel();
  // Every name the export carries is admitted by the reader, and nothing else is. The export is a
  // copy of the catalog, so a host that trusted it would never be refused for a control of its own.
  for (const name of SETTLEMENT_CONTROL_NAMES) {
    const res = await runOnce(fakePorts({
      verifySettlement: async () => ({ verified: true, checks: { [name]: true }, reason: 'independent readback' }),
    }));
    assert.equal(res.receipt.verification.checks[`settlement_${name}`], true, `the export promises ${name}`);
  }
  // And a host that tries to widen it by writing to what it read gets nowhere.
  try {
    SETTLEMENT_CONTROL_NAMES.push('transaccion');
    SETTLEMENT_CONTROL_NAMES[0] = 'transaccion';
    Object.defineProperty(SETTLEMENT_CONTROL_NAMES, 2, { value: 'transaccion' });
  } catch {
    // A frozen copy refuses in strict mode; that is the same answer as the assertions below.
  }
  assert.equal(Object.isFrozen(SETTLEMENT_CONTROL_NAMES), true, 'the copy is still frozen');
  assert.deepEqual([...SETTLEMENT_CONTROL_NAMES].sort(), [
    'authorization', 'exactAmount', 'invocation', 'payer', 'prepared', 'source', 'transfer',
  ], 'and it still carries exactly the catalog');
  const inventado = await runOnce(fakePorts({
    verifySettlement: async () => ({ verified: true, checks: { transaccion: true }, reason: 'the transaction is in the ledger' }),
  }));
  assert.equal(inventado.receipt.status, 'not_verified', 'a name a host wrote for itself is still refused');
  assert.equal(
    inventado.receipt.verification.reason,
    'the settlement port did not verify the declared effect (VERIFIER_FAILED)',
  );
});

test('HX-15 the version of the effect key is exported, and it is the version in the hash', async () => {
  const { EFFECT_KEY_VERSION, createX402Payment } = kernel();
  assert.equal(Number.isInteger(EFFECT_KEY_VERSION), true, 'a host compares a stored key without guessing');
  assert.ok(EFFECT_KEY_VERSION >= 1, 'and the version is a number a host can keep in a register');
  const ports = fakePorts();
  const op = operation();
  const payment = createX402Payment(spec(), ports);
  // The requirements are the ones the payment declares for this operation: a host builds the key from
  // the same three public shapes (declaration, requirement, operation identity).
  const requirements = payment.required(op).spend;
  const res = await payment.run(op, { now: () => CLOCK_MS });
  assert.equal(res.receipt.status, 'verified', `got ${res.receipt?.verification?.reason}`);
  assert.equal(ports.seen.keys.length, 1, 'the store received one key');
  assert.equal(
    hostEffectKey(EFFECT_KEY_VERSION, op, requirements),
    ports.seen.keys[0],
    'a host recomputes the very key the store reserved, out of the process',
  );
  // A key of another version is a different key. A host on a stale version therefore does not
  // collide with a stored one either way: it cannot pay the same effect twice believing it did not.
  assert.notEqual(hostEffectKey(EFFECT_KEY_VERSION + 1, op, requirements), ports.seen.keys[0]);
  assert.notEqual(hostEffectKey(EFFECT_KEY_VERSION - 1, op, requirements), ports.seen.keys[0], 'a key stored before the version moved is not this one');
});

test('HX-09 the reason a control was refused names the control, not only the port', {
  todo: "deferred to 0.1.5 by the coordinator's decision: a port that reports a control outside the catalog is refused with `the settlement port did not verify the declared effect (VERIFIER_FAILED)`, which names the port and not the name. Naming the rejected control would carry host-written text into a sealed receipt, which is exactly what the closed catalog exists to prevent, so the fix is not free and it stays out. What 0.1.4 does is the alternative this reason already named: `SETTLEMENT_CONTROL_NAMES` is exported (HX-08), so a host checks its own vocabulary before it seals anything, and HX-10 keeps the gate green either way.",
}, async () => {
  const res = await runOnce(fakePorts({
    verifySettlement: async () => ({ verified: true, checks: { transaccion: true }, reason: 'the transaction is in the ledger' }),
  }));
  assert.match(res.receipt.verification.reason, /transaccion/);
});

// Not a todo: whatever is decided, this is the behaviour that has to survive. A control outside the
// closed catalog is refused, the verdict never reaches the receipt, and the settlement evidence stays
// with the person who reconciles.
test('HX-10 a control outside the closed catalog never reaches a sealed receipt', async () => {
  const SEED_SHAPED = 'S'.repeat(56);
  for (const control of ['transaccion', SEED_SHAPED, '__proto__', 'constructor', 'toString']) {
    const res = await runOnce(fakePorts({
      transaction: TX,
      verifySettlement: async () => ({ verified: true, checks: { [control]: true }, reason: 'the transaction is in the ledger' }),
    }));
    assert.equal(res.receipt.status, 'not_verified', `control: ${control.slice(0, 12)}`);
    assert.equal(res.receipt.verification.checks.settlement, false, `control: ${control.slice(0, 12)}`);
    assert.equal(res.receipt.verification.reason, 'the settlement port did not verify the declared effect (VERIFIER_FAILED)');
    assert.equal(Object.keys(res.receipt.verification.checks).some((key) => key.startsWith('settlement_')), false, `control: ${control.slice(0, 12)}`);
    assert.equal(res.receipt.evidence.txHash, TX, 'the settlement evidence stays for the person');
  }
  // A control of the catalog still verifies, so the gate is the catalog and not a broken port.
  const dentro = await runOnce(fakePorts({
    verifySettlement: async () => ({ verified: true, checks: { transfer: true, payer: true }, reason: 'independent readback' }),
  }));
  assert.equal(dentro.receipt.status, 'verified');
  assert.equal(dentro.receipt.verification.checks.settlement_transfer, true);
});

test('HX-11 the receipt says which version of the effect key deduplicated this payment', {
  todo: "deferred to 0.1.5 by the coordinator's decision: the effect key is at version 2 of its canonical content, so every key stored before is old and an old key never collides with a new one. The version itself is now a name a host can read, `EFFECT_KEY_VERSION` (HX-15), which is what a host keeping keys outside the process needed to compare them; putting `effectKeyVersion` on the receipt is the part left, and it means touching `receipt.js` and `operation.js` and changing the digest of every receipt a payment already seals.",
}, async () => {
  const ports = fakePorts();
  const res = await runOnce(ports);
  assert.equal(typeof res.receipt.effectKeyVersion, 'number');
});

test('HX-12 a host can obtain the effect key a receipt deduplicated on', {
  todo: "deferred to 0.1.5 by the coordinator's decision: a claims store receives the exact key through `reserveEffect`, so a durable store can persist what it reserved, and the version it is keyed under is exported (HX-15). What no host can do is recover the key from a receipt afterwards. Publishing the key (or a way to recompute it from a receipt) widens what leaves the process and what a receipt can be matched against; not publishing it keeps the key inside, and the memory-store limit stays as it is written in the module header.",
}, async () => {
  const ports = fakePorts();
  const res = await runOnce(ports);
  assert.equal(ports.seen.keys.length, 1, 'the store received one key');
  assert.equal(res.receipt.evidence.effectKey, ports.seen.keys[0]);
});

test('HX-13 a host can read the catalog of public codes instead of matching free text', {
  todo: "deferred to 0.1.5 by the coordinator's decision: every rejection travels in the reason with a code from a catalog that grows every round, and the constructor throws VESPI_X402_CLAIMS_REQUIRED, VESPI_X402_INVALID_SPEC, VESPI_X402_INVALID_PORT or VESPI_X402_INVALID_IO. A host has to hold those strings to branch on them, and Casa Firme translates them by hand. Exporting the code catalog would widen the same surface `SETTLEMENT_CONTROL_NAMES` widens (HX-08), and the reasons stay in the kernel's own words on purpose. The vocabulary 0.1.4 exports is the one a host writes, not the one a host reads.",
}, async () => {
  const { X402_CODES } = kernel();
  assert.equal(typeof X402_CODES, 'object');
});
