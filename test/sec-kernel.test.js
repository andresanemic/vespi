'use strict';

// Security review findings H1 to H7 on the kernel itself, reproduced before each fix.
// The pattern the kernel already applies elsewhere is the specification here: a raw SDK
// message, a url or a body a port wrote does not travel into a receipt (x402.js) and the reason
// of a refusal is a fixed phrase (emergency.js).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const receipt = require('../src/receipt.js');
const delegation = require('../src/delegation.js');
const collectorModule = import('../scripts/collect-testnet-evidence.mjs');

const SECRET = 'fetch failed: https://horizon-testnet.stellar.org/?apiKey=SUPERSECRETKEY';

function throwingPort(message) {
  return () => { throw new Error(message); };
}

function spendOperation() {
  return createOperation({
    goal: 'port that throws',
    authority: grantSpend('USDC:test', '500000'),
  });
}

function collectText(value) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (node && typeof node === 'object') { for (const key of Object.keys(node)) walk(node[key]); return; }
    if (typeof node === 'string') out.push(node);
  };
  walk(value);
  return out.join('\n');
}

// H1: the text a port threw must not reach receipt.detail, and it must not reach it sealed
// inside the digest, so verifyReceipt cannot bless it either.
test('H1 el texto que lanzo un puerto no queda en el recibo', async () => {
  const cap = {
    id: 'throwing-port',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: throwingPort(SECRET),
  };
  const res = await runOperation(spendOperation(), cap, { verify: async () => ({ verified: false, checks: {}, reason: 'no' }) });
  const text = collectText(res.receipt);
  assert.equal(text.includes('SUPERSECRETKEY'), false, 'the receipt detail carries the port error text');
  assert.equal(text.includes('apiKey'), false);
  const verdict = receipt.verifyReceipt(res.receipt);
  assert.equal(verdict.ok, true, 'the receipt was sealed even so');
});

test('H1 el verificador que lanza tampoco escribe su texto en el reason', async () => {
  const cap = {
    id: 'throwing-port',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => ({ ok: true, evidence: { tx: 'X' } }),
  };
  const res = await runOperation(spendOperation(), cap, { verify: throwingPort(SECRET) });
  assert.equal(collectText(res.receipt).includes('SUPERSECRETKEY'), false);
  assert.equal(res.receipt.verification.reason.includes('SUPERSECRETKEY'), false);
});

test('H1 la puerta humana que lanza tampoco escribe su texto en el recibo', async () => {
  const cap = {
    id: 'throwing-port',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '5000', to: 'RECEIVER' }] }),
    perform: async () => ({ ok: true, evidence: { tx: 'X' } }),
  };
  const op = createOperation({ goal: 'gate that throws', authority: grantSpend('USDC:test', '1000') });
  const res = await runOperation(op, cap, { ask: throwingPort(SECRET), verify: async () => ({ verified: false, checks: {}, reason: 'no' }) });
  assert.equal(collectText(res.receipt).includes('SUPERSECRETKEY'), false);
  assert.equal(res.status, STATES.NEEDS_DECISION);
});

// H2: a link planted inside a declared record root must not take the collector outside it.
test('H2 un enlace dentro de la raiz declarada no saca al collector de la raiz', async (t) => {
  const collector = await collectorModule;
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-h2-outside-'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-h2-root-'));
  t.after(async () => {
    await fs.rm(outside, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(outside, 'opencode.json'), JSON.stringify({ token: 'OUTSIDE_TOKEN' }));
  await fs.writeFile(path.join(root, 'inside.json'), JSON.stringify({ note: 'inside' }));
  // A directory junction is the portable way to plant a link on Windows without elevation.
  const link = path.join(root, 'private');
  const made = await fs.symlink(outside, link, 'junction').then(() => true, () => false);
  if (!made) return t.skip('this runner cannot plant a directory link');

  const result = await collector.collectEvidence({
    evidence: { transactions: [] },
    readTransaction: async () => { throw new Error('no network'); },
    runRecordRoots: [{ repository: 'kernel', directory: root }],
  });
  const files = result.summary.run_record_roots[0].files.map((file) => file.file).join('\n');
  assert.equal(files.includes('opencode.json'), false, 'a file outside the declared root was collected');
  assert.equal(collectText(result).includes('OUTSIDE_TOKEN'), false);
});

// H3: a hash that is not 64 hex must not reach Horizon at all.
test('H3 un hash malformado no emite ninguna peticion', async () => {
  const collector = await collectorModule;
  const asked = [];
  for (const bad of ['../../', 'x?limit=200&cursor=', '']) {
    const result = await collector.collectEvidence({
      evidence: { transactions: [{ hash: bad }] },
      readTransaction: async (hash) => { asked.push(hash); throw new Error('no network'); },
    });
    const entry = result.transactions[0];
    assert.equal(entry.readback.status, 'malformed', `hash ${JSON.stringify(bad)} was not marked malformed`);
    assert.equal(entry.readback.reason.includes(bad) || asked.includes(bad), false);
  }
  assert.deepEqual(asked, [], 'a malformed hash reached the reader');
});

// H5: two bodies that differ only in a __proto__ key must not collide.
test('H5 un recibo con clave __proto__ no comparte digest con uno limpio', () => {
  const clean = { status: 'verified', capability: 'c', outcome: { status: 'verified' } };
  const forged = { status: 'verified', capability: 'c', outcome: { status: 'verified' } };
  Object.defineProperty(forged, '__proto__', {
    value: { injected: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const cleanDigest = receipt.computeDigest({ ...clean });
  const forgedDigest = receipt.computeDigest({ ...forged });
  assert.notEqual(cleanDigest, forgedDigest, 'a __proto__ key is invisible to the digest');

  const sealedClean = { ...clean, digest: cleanDigest };
  const sealedForged = { ...forged, digest: forgedDigest };
  assert.equal(receipt.verifyReceipt(sealedClean).ok, true);
  assert.equal(receipt.verifyReceipt(sealedForged).ok, true);
});

// H5: a receipt without that key keeps the digest it always had. These three values were
// measured before the fix, so a change here is a change to the trust chain of every receipt
// already written, not a fix.
test('H5 el digest de un cuerpo sin __proto__ no cambia', () => {
  const body = {
    status: 'verified',
    capability: 'c',
    operation: { id: 'o', goal: 'g' },
    outcome: { status: 'verified', exercised: [{ asset: 'USDC:test', amount: '100000', to: 'R' }] },
    evidence: { tx: 'X' },
    verification: { verified: true, checks: { mock: true }, reason: 'mock ok' },
  };
  assert.equal(receipt.computeDigest(body), 'b7c87c3d6b76dbd1b950152a7f7e2f3cf5a0f993560735401b18f2a54db57af5');
  assert.equal(
    receipt.computeDigest({ ...body, anchor: { status: 'pending', network: 'stellar:testnet' } }),
    'b7c87c3d6b76dbd1b950152a7f7e2f3cf5a0f993560735401b18f2a54db57af5',
  );
  assert.equal(
    receipt.computeDigest({ list: [{ b: 2, a: 1 }, 'x', null, true] }),
    '08a05fcf9624a8db9b8d5f0c41f66b2173d0f165a0c9d6d1d1b9e64c842558a7',
  );
});

// H6: verifyReceipt must answer from a closed list of reasons, never from the thrown message.
test('H6 verifyReceipt devuelve una razon de la lista cerrada', () => {
  const withBigInt = { digest: 'x', amount: 1n };
  const verdict = receipt.verifyReceipt(withBigInt);
  assert.equal(verdict.ok, false);
  assert.equal(
    /BigInt|serialize/i.test(verdict.reason),
    false,
    `the exception message traveled into reason: ${verdict.reason}`,
  );
  assert.match(verdict.reason, /^[a-z ]+$/);
});

test('H6 un toString hostil no se ejecuta al verificar', () => {
  let touched = false;
  const hostile = {
    digest: 'x',
    get weird() { return { toString() { touched = true; throw new Error('ran toString'); } }; },
  };
  const verdict = receipt.verifyReceipt(hostile);
  assert.equal(verdict.ok, false);
  assert.equal(touched, false, 'a hostile toString ran inside verifyReceipt');
});

// H7: a delegate output too deep to serialize must be refused, not thrown out of recordResult.
test('H7 una salida que no se serializa deja outputDigest null y no lanza', () => {
  let d = delegation.createDelegation({
    task: 'deep output', medium: {}, delegate: 'worker', orchestrator: 'vespi',
    deadlineMs: 60_000, now: () => Date.now(),
  });
  const started = delegation.recordStart(d, { readTask: true, firstStep: 'deep' });
  assert.equal(started.relaunch, false);
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 200_000; i += 1) { cursor.next = {}; cursor = cursor.next; }
  let threw = null;
  try {
    d = delegation.recordResult(d, { output: deep, touched: [], spark: null });
  } catch (err) {
    threw = err;
  }
  assert.equal(threw, null, `recordResult threw ${threw && threw.name}: ${threw && threw.message}`);
  assert.equal(d.outputDigest, null);
});
