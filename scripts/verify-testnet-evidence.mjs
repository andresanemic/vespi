#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_EVIDENCE = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const HORIZON = 'https://horizon-testnet.stellar.org';
const EXPECTED_FIELDS = ['operation', 'memo', 'asset', 'amount', 'recipient'];
const READ_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 750;

function validHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}

function validateShape(evidence) {
  const transactions = evidence?.transactions;
  if (!Array.isArray(transactions)) throw new Error('evidence.transactions must be an array');
  const hashes = transactions.map((entry) => entry?.hash);
  if (hashes.some((hash) => !validHash(hash))) throw new Error('every transaction hash must be 64 hexadecimal characters');
  if (new Set(hashes.map((hash) => hash.toLowerCase())).size !== hashes.length) throw new Error('transaction hashes must be unique');
  return transactions;
}

function expectedShape(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  return EXPECTED_FIELDS.every((field) => Object.hasOwn(expected, field));
}

function sameAsset(operation, expected) {
  if (!expected || typeof expected !== 'object') return false;
  if (operation.asset_type !== expected.type) return false;
  if (expected.type === 'native') return true;
  return operation.asset_code === expected.code && operation.asset_issuer === expected.issuer;
}

// A classic operation carries its own asset, amount and recipient. A Soroban operation
// (invoke_host_function) carries none of them: the transfer appears in its
// asset_balance_changes. The local record experiments/002-x402-slice1/RUN.md records that
// the x402 Stellar settlement settles that way, so reading only the operation record made
// every real payment unverifiable. Amount and recipient are then checked inside the
// balance changes that already match the expected asset.
function assetEffects(operation) {
  const changes = Array.isArray(operation?.asset_balance_changes) ? operation.asset_balance_changes.filter(Boolean) : [];
  return changes.length > 0 ? changes : [operation];
}

export function verifyTransactionEvidence(response, expected, capturedAt = new Date().toISOString()) {
  const transaction = response?.transaction;
  const operations = response?.operations;
  if (!transaction || typeof transaction !== 'object' || !Array.isArray(operations)) {
    return { ok: false, field: 'response', reason: 'transaction response and operation records are required' };
  }
  const historical_response = {
    classification: 'historical_readback',
    captured_at: capturedAt,
    transaction,
    operations,
  };
  const fail = (field, reason) => ({ ok: false, field, reason, historical_response });
  if (!expectedShape(expected)) return fail('expected', 'case must declare operation, memo, asset, amount, and recipient');
  if (transaction.successful !== true) return fail('successful', 'transaction is not successful');
  const operation = operations.find((candidate) => candidate?.type === expected.operation);
  if (!operation) return fail('operation', 'operation type does not match expected value');
  if ((transaction.memo ?? null) !== expected.memo) return fail('memo', 'memo does not match expected value');
  const effects = assetEffects(operation).filter((effect) => sameAsset(effect, expected.asset));
  if (effects.length === 0) return fail('asset', 'asset does not match expected value');
  if (!effects.some((effect) => effect.amount === expected.amount)) return fail('amount', 'amount does not match expected value');
  if (!effects.some((effect) => effect.to === expected.recipient)) return fail('recipient', 'recipient does not match expected value');
  return { ok: true, historical_response };
}

export async function verifyEvidence(entries, fetchTransaction, capturedAt = new Date().toISOString()) {
  if (typeof fetchTransaction !== 'function') throw new TypeError('fetchTransaction must be a function');
  const missing = entries.filter((entry) => !expectedShape(entry?.expected));
  if (missing.length) throw new Error(`${missing.length} evidence case(s) lack expected operation, memo, asset, amount, and recipient`);
  return Promise.all(entries.map(async (entry) => {
    const result = verifyTransactionEvidence(await fetchTransaction(entry.hash), entry.expected, capturedAt);
    return { hash: entry.hash, ...result };
  }));
}

// Same comparison per case, but for an evidence file that mixes cases with a local
// expectation and cases without one. A case with no locally declared expectation reports
// ok: null, field 'expected': it is not verified and it did not fail either, because
// there is nothing independent to compare the chain against. Its readback is still kept.
// A readback that could not be fetched reports ok: null, field 'readback'.
export async function verifyEvidenceSet(entries, fetchTransaction, capturedAt = new Date().toISOString()) {
  if (typeof fetchTransaction !== 'function') throw new TypeError('fetchTransaction must be a function');
  const results = [];
  for (const entry of entries ?? []) {
    const hash = entry?.hash;
    if (!expectedShape(entry?.expected)) {
      let historical_response = null;
      let readbackReason = null;
      try {
        const response = await fetchTransaction(hash);
        if (response?.transaction && typeof response.transaction === 'object' && Array.isArray(response.operations)) {
          historical_response = { classification: 'historical_readback', captured_at: capturedAt, transaction: response.transaction, operations: response.operations };
        } else {
          readbackReason = 'Horizon response did not contain a transaction record and operations';
        }
      } catch (error) {
        readbackReason = error?.message ?? 'readback failed';
      }
      results.push({
        hash,
        ok: null,
        field: readbackReason ? 'readback' : 'expected',
        reason: readbackReason ?? 'no local run record declared the expected operation, memo, asset, amount, and recipient',
        historical_response,
      });
      continue;
    }
    let response = null;
    try {
      response = await fetchTransaction(hash);
    } catch (error) {
      results.push({ hash, ok: null, field: 'readback', reason: error?.message ?? 'readback failed', historical_response: null });
      continue;
    }
    results.push({ hash, ...verifyTransactionEvidence(response, entry.expected, capturedAt) });
  }
  return results;
}

async function json(fetcher, url, timeoutMs = READ_TIMEOUT_MS) {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Horizon ${response.status} for ${url}`);
  return response.json();
}

async function readHorizonTransaction(hash, fetcher = fetch, attemptsLeft = MAX_ATTEMPTS) {
  try {
    const transaction = await json(fetcher, `${HORIZON}/transactions/${hash}`);
    const page = await json(fetcher, `${HORIZON}/transactions/${hash}/operations?limit=200`);
    return { transaction, operations: page?._embedded?.records ?? [] };
  } catch (error) {
    if (attemptsLeft <= 1) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return readHorizonTransaction(hash, fetcher, attemptsLeft - 1);
  }
}

async function main(argv) {
  const offline = argv.includes('--offline');
  const filename = argv.find((arg) => !arg.startsWith('--')) || DEFAULT_EVIDENCE;
  const evidence = JSON.parse(await readFile(filename, 'utf8'));
  const entries = validateShape(evidence);

  if (offline) {
    process.stdout.write(`shape ok: ${entries.length} unique transaction hashes listed (not checked against the network or expected transaction facts)\n`);
    return;
  }

  const declared = entries.filter((entry) => expectedShape(entry.expected)).length;
  const capturedAt = new Date().toISOString();
  const results = await verifyEvidenceSet(entries, (hash) => readHorizonTransaction(hash), capturedAt);
  const verified = results.filter((result) => result.ok === true);
  const failed = results.filter((result) => result.ok === false);
  const unverified = results.filter((result) => result.ok === null);
  for (const result of results) {
    const detail = result.ok === true ? 'verified' : result.ok === false ? `mismatch: ${result.field}` : `not semantically verified (${result.field})`;
    process.stdout.write(`${result.hash}: ${detail}\n`);
  }
  const resultByHash = new Map(results.map((result) => [result.hash, result]));
  evidence.transactions = entries.map((entry) => {
    const result = resultByHash.get(entry.hash);
    const verification = result.ok === null
      ? { ok: null, status: 'not_semantically_verified', field: result.field, reason: result.reason }
      : { ok: result.ok, status: result.ok ? 'verified' : 'mismatch', ...(result.field ? { field: result.field, reason: result.reason } : {}) };
    return { ...entry, historical_response: result.historical_response ?? null, verification };
  });
  evidence.summary = {
    ...(evidence.summary ?? {}),
    verified_at: capturedAt,
    semantic_verification: {
      total: entries.length,
      verified: verified.length,
      mismatch: failed.length,
      not_semantically_verified: unverified.length,
      declared_locally: declared,
      expectation_source: 'local run records in this repository, never the Horizon response',
    },
    readback_read: results.filter((result) => result.historical_response).length,
    readback_unread: results.filter((result) => !result.historical_response).length,
  };
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`semantically verified ${verified.length} of ${entries.length}: ${failed.length} mismatch, ${unverified.length} without a local expectation; readbacks saved for ${evidence.summary.readback_read}\n`);
  if (failed.length) throw new Error(`${failed.length} transaction evidence case(s) failed semantic verification; historical responses were saved for review`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
