'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const collectorModule = import('../scripts/collect-testnet-evidence.mjs');

const REPO_ROOT = path.join(__dirname, '..');
const CAPTURED_AT = '2040-01-01T00:00:00.000Z';

const LOCAL_HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

function localRecord() {
  return {
    expected: {
      operation: 'payment',
      memo: null,
      asset: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GISSUER' },
      amount: '0.0100000',
      recipient: 'GRECIPIENT',
    },
    expectedFrom: {
      classification: 'local_run_record',
      citations: [{ file: 'docs/RELEASE_0.1.4_KERNEL.md', line: 40, contains: 'local-record' }],
    },
  };
}

function evidence(entries) {
  return { summary: { transactions_found: entries.length }, transactions: entries };
}

function paymentResponse(patch = {}) {
  return {
    transaction: { successful: true, memo: null, hash: LOCAL_HASH, ...patch },
    operations: [{ type: 'payment', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER', amount: '0.0100000', to: 'GRECIPIENT', ...patch }],
  };
}

async function loadCollector() {
  const collector = await collectorModule;
  return {
    collectEvidence: collector.collectEvidence,
    expectationProvenance: collector.expectationProvenance,
    assertExpectationProvenance: collector.assertExpectationProvenance,
    LOCAL_EXPECTATIONS: collector.LOCAL_EXPECTATIONS,
  };
}

test('F1b-C1: a local run record supplies expected facts and the Horizon readback is stored with its capture time', async () => {
  const { collectEvidence } = await loadCollector();
  const reads = [];
  const result = await collectEvidence({
    evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }]),
    readTransaction: async (hash) => { reads.push(hash); return paymentResponse(); },
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
  });

  assert.deepEqual(reads, [LOCAL_HASH]);
  const [entry] = result.transactions;
  assert.deepEqual(entry.expected, localRecord().expected);
  assert.equal(entry.expectedFrom.classification, 'local_run_record');
  assert.equal(entry.expectedFrom.citations[0].file, 'docs/RELEASE_0.1.4_KERNEL.md');
  assert.equal(entry.historical_response.classification, 'historical_readback');
  assert.equal(entry.historical_response.captured_at, CAPTURED_AT);
  assert.equal(entry.readback.status, 'read');
  assert.equal(entry.readback.attempts, 1);
});

test('F1b-C2: a readback that disagrees with the local record never rewrites the expectation', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }]),
    readTransaction: async () => paymentResponse({ amount: '9.0000000', memo: 'someone-elses-memo' }),
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
  });

  const [entry] = result.transactions;
  assert.deepEqual(entry.expected, localRecord().expected, 'the expectation must stay what the local record declared');
  assert.equal(entry.expected.amount, '0.0100000');
  assert.equal(entry.expected.memo, null);
  const operation = entry.historical_response.operations[0];
  assert.equal(operation.amount, '9.0000000', 'the raw readback keeps what the network said');
  assert.equal(entry.readback.status, 'read');
});

test('F1b-C3: a transaction with no local run record keeps no expectation and says why', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([{
      hash: OTHER_HASH,
      run: 'TEMIS tramo 3, corrida 1',
      expected: { operation: 'payment', memo: null, asset: { type: 'native' }, amount: '5.0000000', recipient: 'GOTHER' },
    }]),
    readTransaction: async () => paymentResponse(),
    localExpectations: {},
    capturedAt: CAPTURED_AT,
  });

  const [entry] = result.transactions;
  assert.equal(Object.hasOwn(entry, 'expected'), false, 'an expectation with no local record behind it must not survive collection');
  assert.equal(entry.expectedFrom, null);
  assert.match(entry.expectedFromReason, /TEMIS tramo 3, corrida 1/);
  assert.equal(entry.historical_response.classification, 'historical_readback');
});

test('F1b-C4: a malformed response is reported and never becomes an expectation', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }, { hash: OTHER_HASH, run: 'other run' }]),
    readTransaction: async (hash) => (hash === LOCAL_HASH ? { transaction: { successful: true } } : paymentResponse()),
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
  });

  const [first, second] = result.transactions;
  assert.equal(first.readback.status, 'malformed');
  assert.match(first.readback.reason, /operations/i);
  assert.equal(first.historical_response, null);
  assert.deepEqual(first.expected, localRecord().expected, 'a malformed readback leaves the local expectation untouched');
  assert.equal(second.readback.status, 'read');
});

test('F1b-C5: a failing network read stops after the retry bound and the other cases still collect', async () => {
  const { collectEvidence } = await loadCollector();
  let attempts = 0;
  const result = await collectEvidence({
    evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }, { hash: OTHER_HASH, run: 'other run' }]),
    readTransaction: async (hash) => {
      if (hash === LOCAL_HASH) { attempts += 1; throw new Error('Horizon 503'); }
      return paymentResponse();
    },
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
    maxAttempts: 3,
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(attempts, 3, 'the readback retry bound must be finite');
  const [first, second] = result.transactions;
  assert.equal(first.readback.status, 'failed');
  // The reader's own text stopped travelling in H3b: a reader that throws `Horizon 503 for
  // https://...?apiKey=SECRET` wrote that secret into the evidence file, because the reason is
  // written to disk with the evidence. The bound is still what this case checks.
  assert.equal(first.readback.reason, 'the horizon read failed at every attempt');
  assert.equal(JSON.stringify(result).includes('Horizon 503'), false, 'the reader message reached the evidence');
  assert.equal(first.historical_response, null);
  assert.deepEqual(first.expected, localRecord().expected);
  assert.equal(second.readback.status, 'read');
});

test('F1b-C6: a hanging readback is bounded by the read timeout', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([{ hash: OTHER_HASH, run: 'other run' }]),
    readTransaction: () => new Promise(() => {}),
    localExpectations: {},
    capturedAt: CAPTURED_AT,
    readTimeoutMs: 20,
    maxAttempts: 1,
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(result.transactions[0].readback.status, 'timeout');
  assert.equal(result.transactions[0].historical_response, null);
});

test('F1b-C7: collection never calls the global fetch when a reader is injected', async () => {
  const { collectEvidence } = await loadCollector();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('no network in tests'); };
  try {
    const result = await collectEvidence({
      evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }]),
      readTransaction: async () => paymentResponse(),
      localExpectations: { [LOCAL_HASH]: localRecord() },
      capturedAt: CAPTURED_AT,
    });
    assert.equal(result.transactions[0].readback.status, 'read');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test('F1b-C8: the summary states how many cases carry a local expectation and how many do not', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([{ hash: LOCAL_HASH, run: 'local run' }, { hash: OTHER_HASH, run: 'other run' }]),
    readTransaction: async () => paymentResponse(),
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
  });

  assert.equal(result.summary.local_expectation, 1);
  assert.equal(result.summary.no_local_expectation, 1);
  assert.equal(result.summary.readback_read, 2);
  assert.equal(result.summary.readback_failed, 0);
  assert.equal(result.summary.local_record_source, 'repository run records, never the Horizon response');
});

test('F1b-C9: the summary counts the readbacks the network itself calls successful', async () => {
  const { collectEvidence } = await loadCollector();
  const result = await collectEvidence({
    evidence: evidence([
      { hash: LOCAL_HASH, run: 'local run' },
      { hash: OTHER_HASH, run: 'other run' },
      { hash: 'c'.repeat(64), run: 'third run' },
    ]),
    readTransaction: async (hash) => paymentResponse(hash === 'c'.repeat(64) ? { successful: false } : {}),
    localExpectations: { [LOCAL_HASH]: localRecord() },
    capturedAt: CAPTURED_AT,
  });

  assert.equal(result.summary.readback_successful, 2, 'an observed count from the readbacks, not an expectation');
  assert.equal(result.summary.local_expectation, 1);
});

test('F1b-P1: the provenance checker rejects an expectation read back off its own response', async () => {
  const { assertExpectationProvenance, expectationProvenance } = await loadCollector();
  const readback = paymentResponse();
  const forged = {
    hash: LOCAL_HASH,
    expected: {
      operation: 'payment',
      memo: readback.transaction.memo,
      asset: { type: readback.operations[0].asset_type, code: readback.operations[0].asset_code, issuer: readback.operations[0].asset_issuer },
      amount: readback.operations[0].amount,
      recipient: readback.operations[0].to,
    },
    expectedFrom: {
      classification: 'horizon_readback',
      recorded_at: '2040-01-02T00:00:00.000Z',
      citations: [{ file: 'docs/testnet-evidence.json', line: 19, contains: 'hash' }],
    },
    historical_response: { classification: 'historical_readback', captured_at: CAPTURED_AT, ...readback },
  };

  const report = expectationProvenance(forged);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => /classification must be local_run_record/.test(problem)), report.problems.join(' | '));
  assert.ok(report.problems.some((problem) => /may not point at the evidence file/.test(problem)), report.problems.join(' | '));
  assert.ok(report.problems.some((problem) => /at or after the network readback/.test(problem)), report.problems.join(' | '));
  assert.throws(() => assertExpectationProvenance([forged]), /expectedFrom|historical_response/i);
});

test('F1b-P2: an expectation without a local citation is rejected even when it matches the readback', async () => {
  const { assertExpectationProvenance } = await loadCollector();
  const entry = {
    hash: LOCAL_HASH,
    expected: { operation: 'payment', memo: null, asset: { type: 'native' }, amount: '1.0000000', recipient: 'GRECIPIENT' },
    historical_response: { classification: 'historical_readback', captured_at: CAPTURED_AT, ...paymentResponse() },
  };
  assert.throws(() => assertExpectationProvenance([entry]), /expectedFrom/);
});

test('F1b-P3: every checked-in expectation cites a local record, and each citation resolves to a real line', async () => {
  const { assertExpectationProvenance, LOCAL_EXPECTATIONS } = await loadCollector();
  const file = JSON.parse(await readFile(path.join(REPO_ROOT, 'docs/testnet-evidence.json'), 'utf8'));
  assertExpectationProvenance(file.transactions);

  const declared = file.transactions.filter((entry) => Object.hasOwn(entry, 'expected'));
  const published = declared.map((entry) => entry.hash);
  for (const hash of Object.keys(LOCAL_EXPECTATIONS)) {
    assert.ok(published.includes(hash), `every expectation in the registry must be published in the evidence file: ${hash}`);
  }

  for (const record of Object.values(LOCAL_EXPECTATIONS)) {
    assert.ok(Array.isArray(record.expectedFrom?.citations) && record.expectedFrom.citations.length > 0, 'a local expectation needs at least one citation');
    for (const citation of record.expectedFrom.citations) {
      const text = await readFile(path.join(REPO_ROOT, citation.file), 'utf8');
      const line = text.split(/\r?\n/)[citation.line - 1];
      assert.equal(typeof line, 'string', `${citation.file}:${citation.line} must exist`);
      assert.ok(line.includes(citation.contains), `${citation.file}:${citation.line} must contain ${JSON.stringify(citation.contains)}`);
    }
  }
});