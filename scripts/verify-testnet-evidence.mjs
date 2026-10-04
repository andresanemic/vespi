#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_EVIDENCE = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const HORIZON = 'https://horizon-testnet.stellar.org';
const EXPECTED_FIELDS = ['operation', 'memo', 'asset', 'amount', 'recipient'];

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
  if (!sameAsset(operation, expected.asset)) return fail('asset', 'asset does not match expected value');
  if (operation.amount !== expected.amount) return fail('amount', 'amount does not match expected value');
  if (operation.to !== expected.recipient) return fail('recipient', 'recipient does not match expected value');
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

async function json(fetcher, url) {
  const response = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Horizon ${response.status} for ${url}`);
  return response.json();
}

async function readHorizonTransaction(hash, fetcher = fetch) {
  const transaction = await json(fetcher, `${HORIZON}/transactions/${hash}`);
  const page = await json(fetcher, `${HORIZON}/transactions/${hash}/operations?limit=200`);
  return { transaction, operations: page?._embedded?.records ?? [] };
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

  const missing = entries.filter((entry) => !expectedShape(entry.expected));
  if (missing.length) throw new Error(`${missing.length} evidence case(s) lack declared operation, memo, asset, amount, and recipient expectations`);
  const capturedAt = new Date().toISOString();
  const results = await verifyEvidence(entries, (hash) => readHorizonTransaction(hash), capturedAt);
  const failures = results.filter((result) => !result.ok);
  for (const result of results) {
    const detail = result.ok ? 'verified' : `mismatch: ${result.field}`;
    process.stdout.write(`${result.hash}: ${detail}\n`);
  }
  const responseByHash = new Map(results.map((result) => [result.hash, result.historical_response]));
  const resultByHash = new Map(results.map((result) => [result.hash, result]));
  evidence.transactions = entries.map((entry) => {
    const result = resultByHash.get(entry.hash);
    return { ...entry, historical_response: responseByHash.get(entry.hash), verification: { ok: result.ok, ...(result.field ? { field: result.field, reason: result.reason } : {}) } };
  });
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (failures.length) throw new Error(`${failures.length} transaction evidence case(s) failed semantic verification; historical responses were saved for review`);
  process.stdout.write(`verified ${results.length} successful transactions; historical Horizon responses saved\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
