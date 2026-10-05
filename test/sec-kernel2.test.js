'use strict';

// Second pass of the security review. Three findings the first pass left open, all of them the
// same rule the kernel already states: free text a port or a reader wrote does not travel into a
// receipt, into the evidence file, or into a record read out of the tree.
//   H1b  operation.js reads the `error` a port RETURNS, and it sealed it whole. H1 closed the thrown
//        channel and left this one open.
//   H2c  the record walk read a `.json` of any size. A 5 MB record was loaded whole.
//   H3b  readWithBounds copied the reader's `error.message` into `readback.reason`, and that reason
//        is written to disk with the evidence.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const { createOperation, runOperation, STATES } = require('../src/operation.js');
const { grantSpend } = require('../src/authority.js');
const receipt = require('../src/receipt.js');
const collectorModule = import('../scripts/collect-testnet-evidence.mjs');

const SECRET = 'fetch failed: https://horizon-testnet.stellar.org/?apiKey=SUPERSECRETKEY';
const HASH = 'a'.repeat(64);
// T1-D2 holds the tests free of absolute paths of this machine, so the one the refusal case uses is
// built from the platform instead of written down.
const DRIVE = process.platform === 'win32' ? 'C:' : '';

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

function returningPort(result) {
  return {
    id: 'returning-port',
    required: () => ({ spend: [{ asset: 'USDC:test', amount: '100000', to: 'RECEIVER' }] }),
    perform: async () => result,
  };
}

function run(result) {
  return runOperation(
    createOperation({ goal: 'port that returns', authority: grantSpend('USDC:test', '500000') }),
    returningPort(result),
    { verify: async () => ({ verified: false, checks: {}, reason: 'no' }) },
  );
}

// H1b: the sibling of H1. `perform` may answer `{ ok: false, error }` instead of throwing, and that
// string reached `detail` sealed, so verifyReceipt blessed a credential that was inside the chain of
// trust rather than outside it. Same rule as the thrown text: a free sentence never travels, only a
// token shaped like a code, and the fixed phrase of the site is what the receipt says.
test('H1b the error a port RETURNS does not reach the receipt', async () => {
  const res = await run({ ok: false, error: SECRET });
  const text = collectText(res.receipt);
  assert.equal(text.includes('SUPERSECRETKEY'), false, 'the returned error text reached the receipt');
  assert.equal(text.includes('apiKey'), false);
  assert.equal(res.status, STATES.FAILED);
  assert.equal(receipt.verifyReceipt(res.receipt).ok, true, 'the receipt was sealed even so');
});

test('H1b the returned error is closed on the settlement-unknown channel too', async () => {
  const res = await run({ ok: false, error: SECRET, settlementUnknown: true, evidence: { txHash: 'tx-unknown' } });
  assert.equal(collectText(res.receipt).includes('SUPERSECRETKEY'), false);
  assert.equal(res.status, STATES.NOT_VERIFIED);
  assert.equal(receipt.verifyReceipt(res.receipt).ok, true);
});

test('H1b a code-shaped token from the port still names the failure', async () => {
  const res = await run({ ok: false, error: 'INSUFFICIENT_FUNDS' });
  assert.match(res.receipt.detail, /INSUFFICIENT_FUNDS/, 'a host-chosen code token is a signal, not a sentence');
  assert.equal(receipt.verifyReceipt(res.receipt).ok, true);
});

test('H1b a url, a path and a long sentence are all refused the same way', async () => {
  for (const text of [
    `${DRIVE}/Users/owner/.ssh/id_ed25519`,
    'fetch failed for https://api.example.com/v1/pay',
    'x'.repeat(200),
    'lowercase sentence from the host',
  ]) {
    const res = await run({ ok: false, error: text });
    assert.equal(collectText(res.receipt).includes(text), false, `free text travelled into the receipt: ${text.slice(0, 24)}`);
    assert.match(res.receipt.detail, /^[a-z ]+$/, `the detail is not a fixed phrase: ${res.receipt.detail}`);
  }
});

test('H1b an error object from the port is read for its code and nothing else', async () => {
  const res = await run({ ok: false, error: Object.assign(new Error(SECRET), { code: 'PAYMENT_REJECTED' }) });
  assert.equal(collectText(res.receipt).includes('SUPERSECRETKEY'), false);
  assert.match(res.receipt.detail, /PAYMENT_REJECTED/);
});

// H3b: readWithBounds copied the reader's message into the reason, and the reason is written to the
// evidence file. A reader that throws a url with a key in it put the key in the evidence.
test('H3b a reader that throws a credential leaves none in the evidence', async () => {
  const collector = await collectorModule;
  const result = await collector.collectEvidence({
    evidence: { transactions: [{ hash: HASH, run: 'leaky reader' }] },
    readTransaction: async () => { throw new Error(SECRET); },
    localExpectations: {},
    maxAttempts: 2,
    retryDelayMs: 0,
    sleep: async () => {},
  });
  const entry = result.transactions[0];
  assert.equal(entry.readback.status, 'failed');
  assert.equal(collectText(result).includes('SUPERSECRETKEY'), false, 'the reader message was written to the evidence');
  assert.equal(entry.readback.reason.includes('apiKey'), false);
  assert.match(entry.readback.reason, /^[a-z ]+$/, `the reason is not a fixed phrase: ${entry.readback.reason}`);
});

test('H3b the timeout reason is a fixed phrase too', async () => {
  const collector = await collectorModule;
  const result = await collector.collectEvidence({
    evidence: { transactions: [{ hash: HASH, run: 'hanging reader' }] },
    readTransaction: async () => { throw new Error(SECRET); },
    localExpectations: {},
    maxAttempts: 3,
    retryDelayMs: 0,
    sleep: async () => {},
    readTimeoutMs: 1_000,
  });
  assert.equal(result.transactions[0].readback.status, 'failed');
  assert.match(result.transactions[0].readback.reason, /^[a-z ]+$/);
});

// H2c: a record root is a boundary of what the collector will read, and size was not part of it. A
// 5 MB `.json` was loaded whole before anything looked at it. The bound is read from the file's own
// stat, before the bytes are in memory, and the rejection is written into the summary: a record that
// was skipped is a fact about the collection, not a silence.
test('H2c a record over the size bound is refused before it is read', async (t) => {
  const collector = await collectorModule;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-h2c-root-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, 'small.json'), JSON.stringify({ note: 'inside' }));
  // Not valid JSON on purpose: if the bound did not hold, this file would be read and parsed.
  await fs.writeFile(path.join(root, 'huge.json'), `{"note":"${'x'.repeat(1024 * 1024 + 64)}"`);

  const result = await collector.collectEvidence({
    evidence: { transactions: [] },
    readTransaction: async () => { throw new Error('no network'); },
    runRecordRoots: [{ repository: 'kernel', directory: root }],
  });
  const listed = result.summary.run_record_roots[0].files.map((file) => file.file);
  assert.equal(listed.includes('huge.json'), false, 'a record over the bound was read as a record');
  assert.equal(listed.includes('small.json'), true, 'the bound refused a record that was inside it');
  const refused = result.summary.run_record_roots[0].refused;
  assert.equal(Array.isArray(refused), true, 'the refusal is not recorded in the summary');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].file, 'huge.json');
  assert.equal(refused[0].reason, 'the record is larger than the 1 MiB bound and was not read');
  assert.ok(refused[0].bytes > 1024 * 1024, 'the refusal states the size it refused');
});

test('H2c the size bound is one mebibyte and a record just under it is read', async (t) => {
  const collector = await collectorModule;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-h2c-edge-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const record = { expected: { memo: null }, expectedFrom: { classification: 'local_run_record', citations: [] } };
  const padding = 1024 * 1024 - Buffer.byteLength(JSON.stringify(record)) - 32;
  await fs.writeFile(path.join(root, 'edge.json'), JSON.stringify({ ...record, note: 'y'.repeat(padding) }));

  const result = await collector.collectEvidence({
    evidence: { transactions: [] },
    readTransaction: async () => { throw new Error('no network'); },
    runRecordRoots: [{ repository: 'kernel', directory: root }],
  });
  const listed = result.summary.run_record_roots[0].files.map((file) => file.file);
  assert.equal(listed.includes('edge.json'), true, 'a record under the bound was refused');
  assert.deepEqual(result.summary.run_record_roots[0].refused, []);
});
