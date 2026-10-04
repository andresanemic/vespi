#!/usr/bin/env node

// Collects the testnet evidence file from two independent sources and keeps them apart.
//
//   1. Local run records committed in this repository (receipts, run notes, adapter code).
//      These supply `expected`: what the run declared it intended to do.
//   2. Horizon readbacks. These supply `historical_response`: what the network says now.
//
// An expectation is never copied from a Horizon response. Doing that would compare the
// chain with itself and would call the result verification. `expectationProvenance`
// enforces the separation and the collector refuses to write a file that breaks it.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_EVIDENCE = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const EVIDENCE_FILE_NAME = 'docs/testnet-evidence.json';
const HORIZON = 'https://horizon-testnet.stellar.org';
const READ_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 750;
const LOCAL_RECORD_CLASSIFICATION = 'local_run_record';

const X402_LIVE_HASH = 'abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5';

// One entry per transaction whose run record lives in this repository. A transaction
// whose run record lives in another repository is not here on purpose: without a local
// record there is nothing to compare the chain against, and inventing the expectation
// would make the verification circular.
export const LOCAL_EXPECTATIONS = Object.freeze({
  [X402_LIVE_HASH]: {
    expected: {
      operation: 'invoke_host_function',
      memo: null,
      asset: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
      amount: '0.0100000',
      recipient: 'GD7MPNDYJO6YOQJ2NTSWDN2QDPZWORG2J7L7SCVIXU3IGVOMJNGZUV6J',
    },
    expectedFrom: {
      classification: LOCAL_RECORD_CLASSIFICATION,
      recorded_at: '2026-10-02T18:06:33.958Z',
      record: 'demo/x402/receipts/live-testnet-2026-10-02.json',
      citations: [
        { file: 'demo/x402/receipts/live-testnet-2026-10-02.json', line: 27, contains: X402_LIVE_HASH },
        { file: 'demo/x402/receipts/live-testnet-2026-10-02.json', line: 18, contains: 'USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' },
        { file: 'demo/x402/receipts/live-testnet-2026-10-02.json', line: 19, contains: '"maxAmount": "100000"' },
        { file: 'demo/x402/receipts/live-testnet-2026-10-02.json', line: 20, contains: 'GD7MPNDYJO6YOQJ2NTSWDN2QDPZWORG2J7L7SCVIXU3IGVOMJNGZUV6J' },
        { file: 'demo/x402/capability.js', line: 15, contains: "const PRICE_ATOMIC = '100000'" },
        { file: 'demo/x402/capability.js', line: 285, contains: 'amount: PRICE_ATOMIC, to: recipient' },
        { file: 'demo/x402/capability.js', line: 335, contains: 'sorobanData' },
        { file: 'demo/x402/run.js', line: 13, contains: "const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'" },
        { file: 'demo/x402/amount.js', line: 1, contains: 'const SCALE = 10_000_000n' },
        { file: 'experiments/002-x402-slice1/RUN.md', line: 32, contains: 'invoke_host_function' },
      ],
      derivations: {
        operation: 'Soroban token transfer. experiments/002-x402-slice1/RUN.md records that official x402/Stellar settles through Soroban (`invoke_host_function`) and that the transfer shows up in `asset_balance_changes`; demo/x402/capability.js:335 rebuilds the payload of this same adapter with sorobanData, so the same settlement shape applies to this run.',
        memo: 'No local record declares a memo for this run. The declared effect (capability.js:285) carries asset, amount and recipient and no memo, and the receipt has no memo field, so the expectation is null: no memo. If the readback shows a memo, verification fails on it rather than being adjusted.',
        asset: 'code USDC and its issuer come from the adapter (capability.js:14 asset contract, run.js:13 issuer) and the receipt asset string. `type: credit_alphanum4` is Horizon\'s name for an asset code of four characters, applied to the locally declared code USDC; it is a naming rule, not a value read from the network. The asset contract CBIELTK... is the Soroban contract the receipt records, not the classic issuer.',
        amount: 'The receipt records 100000 atomic units of USDC as the exercised effect (line 19) and the adapter declares the same PRICE_ATOMIC (capability.js:15). demo/x402/amount.js:1 states the scale of 10000000, so 100000 atomic is 0.0100000.',
        recipient: 'The receipt records the exercised recipient (line 20); it is the payTo the adapter was configured with and the only recipient the kernel was authorized to pay.',
      },
    },
  },
});

export function localExpectation(hash, registry = LOCAL_EXPECTATIONS) {
  const key = typeof hash === 'string' ? hash.toLowerCase() : '';
  const found = Object.entries(registry).find(([candidate]) => candidate.toLowerCase() === key);
  return found ? found[1] : null;
}

function citationShape(citation) {
  return Boolean(citation)
    && typeof citation.file === 'string' && citation.file.length > 0
    && Number.isInteger(citation.line) && citation.line > 0
    && typeof citation.contains === 'string' && citation.contains.length > 0;
}

// Provenance of one checked-in expectation. It fails when the expectation has no local
// record behind it, when its citations are unusable, when a citation points at the
// evidence file itself (that is the chain-side record, not an independent one), or when
// the local record was written after the network readback (the signature of an
// expectation transcribed out of the response it is supposed to be compared with).
export function expectationProvenance(entry, evidenceFile = EVIDENCE_FILE_NAME) {
  const problems = [];
  if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'expected')) return { ok: true, problems };
  const source = entry.expectedFrom;
  if (!source || typeof source !== 'object') {
    problems.push(`${entry.hash}: expected facts without an expectedFrom local record citation`);
    return { ok: false, problems };
  }
  if (source.classification !== LOCAL_RECORD_CLASSIFICATION) {
    problems.push(`${entry.hash}: expectedFrom.classification must be ${LOCAL_RECORD_CLASSIFICATION}, found ${JSON.stringify(source.classification)}`);
  }
  const citations = Array.isArray(source.citations) ? source.citations : [];
  if (citations.length === 0) problems.push(`${entry.hash}: expectedFrom carries no citation`);
  for (const citation of citations) {
    if (!citationShape(citation)) problems.push(`${entry.hash}: citation must name a file, a line and a fragment to look for`);
    else if (citation.file.replace(/\\/g, '/') === evidenceFile.replace(/\\/g, '/')) problems.push(`${entry.hash}: a citation may not point at the evidence file being verified`);
  }
  const capturedAt = entry.historical_response?.captured_at;
  if (capturedAt && typeof source.recorded_at === 'string') {
    const recorded = Date.parse(source.recorded_at);
    const captured = Date.parse(capturedAt);
    if (Number.isNaN(recorded)) problems.push(`${entry.hash}: expectedFrom.recorded_at is not a timestamp`);
    else if (!Number.isNaN(captured) && recorded >= captured) problems.push(`${entry.hash}: the local record was written at or after the network readback, so the expectation was read back off the response`);
  }
  return { ok: problems.length === 0, problems };
}

export function assertExpectationProvenance(entries, evidenceFile = EVIDENCE_FILE_NAME) {
  const problems = (Array.isArray(entries) ? entries : []).flatMap((entry) => expectationProvenance(entry, evidenceFile).problems);
  if (problems.length) throw new Error(`evidence expectations fail local provenance: ${problems.join('; ')}`);
  return true;
}

function readbackShape(response) {
  if (!response || typeof response !== 'object') return 'readback is not an object';
  if (!response.transaction || typeof response.transaction !== 'object') return 'readback has no transaction record';
  if (!Array.isArray(response.operations)) return 'readback has no operations array';
  return null;
}

function withTimeout(promise, ms, label) {
  let timer;
  const expiry = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

async function defaultSleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readWithBounds(hash, readTransaction, { readTimeoutMs, maxAttempts, retryDelayMs, sleep }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(Promise.resolve().then(() => readTransaction(hash)), readTimeoutMs, `Horizon read of ${hash.slice(0, 8)}`);
      const malformed = readbackShape(response);
      if (malformed) return { status: 'malformed', attempts: attempt, reason: malformed, response: null };
      return { status: 'read', attempts: attempt, response };
    } catch (error) {
      lastError = error;
      const timedOut = /timed out after/.test(error?.message ?? '');
      if (attempt < maxAttempts) await sleep(retryDelayMs);
      if (timedOut) return { status: 'timeout', attempts: attempt, reason: error.message, response: null };
    }
  }
  return { status: 'failed', attempts: maxAttempts, reason: lastError?.message ?? 'unknown read failure', response: null };
}

export async function collectEvidence({
  evidence,
  readTransaction,
  localExpectations = LOCAL_EXPECTATIONS,
  capturedAt = new Date().toISOString(),
  readTimeoutMs = READ_TIMEOUT_MS,
  maxAttempts = MAX_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
  sleep = defaultSleep,
}) {
  if (!evidence || typeof evidence !== 'object') throw new TypeError('evidence must be an object');
  if (!Array.isArray(evidence.transactions)) throw new Error('evidence.transactions must be an array');
  if (typeof readTransaction !== 'function') throw new TypeError('readTransaction must be a function');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
  if (!Number.isInteger(readTimeoutMs) || readTimeoutMs < 1) throw new RangeError('readTimeoutMs must be a positive integer');

  const transactions = [];
  for (const entry of evidence.transactions) {
    const hash = entry?.hash;
    const record = localExpectation(hash, localExpectations);
    const base = { ...entry };
    delete base.expected;
    delete base.expectedFrom;
    delete base.expectedFromReason;
    delete base.historical_response;
    delete base.readback;

    const read = await readWithBounds(hash, readTransaction, { readTimeoutMs, maxAttempts, retryDelayMs, sleep });
    const collected = { ...base };
    if (record) {
      collected.expected = record.expected;
      collected.expectedFrom = record.expectedFrom;
    } else {
      collected.expectedFrom = null;
      collected.expectedFromReason = `no run record for this transaction in this repository (run: ${entry?.run ?? 'unlabeled'}); the expectation is not declared locally and was not copied from the Horizon readback`;
    }
    collected.historical_response = read.response
      ? { classification: 'historical_readback', captured_at: capturedAt, transaction: read.response.transaction, operations: read.response.operations }
      : null;
    collected.readback = { status: read.status, attempts: read.attempts, ...(read.reason ? { reason: read.reason } : {}) };
    transactions.push(collected);
  }

  const count = (status) => transactions.filter((entry) => entry.readback.status === status).length;
  const withExpectation = transactions.filter((entry) => Object.hasOwn(entry, 'expected')).length;
  return {
    ...evidence,
    summary: {
      ...(evidence.summary ?? {}),
      collected_at: capturedAt,
      transactions_found: transactions.length,
      local_expectation: withExpectation,
      no_local_expectation: transactions.length - withExpectation,
      readback_read: count('read'),
      readback_failed: count('failed') + count('malformed') + count('timeout'),
      local_record_source: 'repository run records, never the Horizon response',
    },
    transactions,
  };
}

async function horizonJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Horizon ${response.status} for ${url}`);
  return response.json();
}

async function readHorizonTransaction(hash, timeoutMs = READ_TIMEOUT_MS) {
  const transaction = await horizonJson(`${HORIZON}/transactions/${hash}`, timeoutMs);
  const page = await horizonJson(`${HORIZON}/transactions/${hash}/operations?limit=200`, timeoutMs);
  return { transaction, operations: page?._embedded?.records ?? [] };
}

async function main(argv) {
  const filename = argv.find((arg) => !arg.startsWith('--')) || DEFAULT_EVIDENCE;
  const evidence = JSON.parse(await readFile(filename, 'utf8'));
  const collected = await collectEvidence({ evidence, readTransaction: (hash) => readHorizonTransaction(hash) });
  assertExpectationProvenance(collected.transactions, path.relative(process.cwd(), filename).replace(/\\/g, '/'));
  await writeFile(filename, `${JSON.stringify(collected, null, 2)}\n`, 'utf8');
  for (const entry of collected.transactions) {
    const declared = Object.hasOwn(entry, 'expected') ? 'expected from local record' : 'no local record';
    process.stdout.write(`${entry.hash.slice(0, 12)}: readback ${entry.readback.status} (attempts ${entry.readback.attempts}), ${declared}\n`);
  }
  const { summary } = collected;
  process.stdout.write(`${summary.transactions_found} cases collected: ${summary.local_expectation} with a local expectation, ${summary.no_local_expectation} without one; ${summary.readback_read} readbacks read, ${summary.readback_failed} not read\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}