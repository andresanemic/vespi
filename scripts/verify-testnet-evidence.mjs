#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_EVIDENCE = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const HORIZON = 'https://horizon-testnet.stellar.org';
// The five facts a full expectation must carry.
const EXPECTED_FIELDS = ['operation', 'memo', 'asset', 'amount', 'recipient'];
// A partial declaration: some of those five, plus whatever else the run record stated that
// the chain can be asked about (the ledger it landed at, the account that sent it, the
// payer, how many credits it produced).
const DECLARED_FIELDS = EXPECTED_FIELDS;
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
// Every transfer the readback shows, flattened: a classic operation is its own effect,
// a Soroban operation carries its transfers in asset_balance_changes.
function declaredEffects(operations) {
  const effects = [];
  for (const operation of operations ?? []) {
    if (!operation || typeof operation !== 'object') continue;
    const changes = Array.isArray(operation.asset_balance_changes) ? operation.asset_balance_changes.filter(Boolean) : [];
    if (changes.length > 0) {
      for (const change of changes) effects.push({ ...change, effect_source: 'balance_change' });
      continue;
    }
    if (typeof operation.to === 'string' || typeof operation.amount === 'string') effects.push({ ...operation, effect_source: 'operation' });
  }
  return effects;
}

// A MEMO_HASH travels as the base64 of the same 32 bytes the record anchored, so the
// comparison is made on those bytes and not on the text Horizon happened to print.
function memoCheck(declared, transaction) {
  const actual = transaction?.memo ?? null;
  if (declared === null || declared === undefined) return { ok: actual === null, detail: `no memo declared, readback says ${actual ?? 'no memo'}` };
  if (declared.kind === 'memo_hash') {
    if (!/^[a-f0-9]{64}$/i.test(String(declared.digest ?? ''))) return { ok: false, detail: 'the declared memo hash is not a 32 byte digest' };
    const expected = Buffer.from(declared.digest, 'hex').toString('base64');
    return { ok: actual === expected, detail: `MEMO_HASH ${declared.digest} reads back as ${actual ?? 'no memo'}` };
  }
  if (declared.kind === 'text') return { ok: actual === declared.value, detail: `text memo ${JSON.stringify(declared.value)} reads back as ${JSON.stringify(actual)}` };
  return { ok: false, detail: `the declared memo has no recognized kind: ${JSON.stringify(declared.kind)}` };
}

function assetMatches(effect, declared) {
  if (!declared || typeof declared !== 'object') return false;
  if (declared.type && effect.asset_type !== declared.type) return false;
  if (declared.code && effect.asset_code !== declared.code) return false;
  if (declared.issuer && effect.asset_issuer !== declared.issuer) return false;
  return Boolean(declared.code || declared.issuer || declared.type);
}

// Checks a partial declaration, fact by fact, against the readback. It never returns true:
// a run record that did not declare all five facts cannot verify a transaction, and one
// that contradicts the chain is reported as a discrepancy instead of being adjusted.
export function verifyDeclaredFacts(response, declared, capturedAt = new Date().toISOString()) {
  const transaction = response?.transaction;
  const operations = response?.operations;
  if (!transaction || typeof transaction !== 'object' || !Array.isArray(operations)) {
    return { ok: null, matched: [], discrepancies: [], checked: [], undeclared_fields: DECLARED_FIELDS.slice(), not_checked: [], reason: 'transaction response and operation records are required' };
  }
  const historical_response = { classification: 'historical_readback', captured_at: capturedAt, transaction, operations };
  const facts = declared && typeof declared === 'object' ? declared : {};
  const extras = facts.extras && typeof facts.extras === 'object' ? facts.extras : {};
  const effects = declaredEffects(operations);
  const checked = [];
  const matched = [];
  const discrepancies = [];
  const not_checked = [];
  const record = (field, outcome, detail) => {
    checked.push({ field, ok: outcome.ok, detail });
    if (outcome.ok) matched.push(field);
    else discrepancies.push({ field, detail });
  };

  if (Object.hasOwn(facts, 'operation')) {
    const found = operations.some((operation) => operation?.type === facts.operation);
    record('operation', { ok: found }, `declared ${facts.operation}, readback has ${[...new Set(operations.map((operation) => operation?.type))].join(', ') || 'no operation'}`);
  }
  if (Object.hasOwn(facts, 'memo')) record('memo', memoCheck(facts.memo, transaction), '');
  if (Object.hasOwn(facts, 'asset')) {
    const found = effects.some((effect) => assetMatches(effect, facts.asset));
    record('asset', { ok: found }, `declared ${JSON.stringify(facts.asset)}, readback shows ${[...new Set(effects.map((effect) => `${effect.asset_type ?? 'unknown'}:${effect.asset_code ?? ''}`))].join(', ') || 'no transfer'}`);
  }
  if (Object.hasOwn(facts, 'amount')) {
    const scoped = Object.hasOwn(facts, 'asset') ? effects.filter((effect) => assetMatches(effect, facts.asset)) : effects;
    const found = scoped.some((effect) => effect.amount === facts.amount);
    record('amount', { ok: found }, `declared ${facts.amount}, readback shows ${scoped.map((effect) => effect.amount).join(', ') || 'no transfer'}`);
  }
  if (Object.hasOwn(facts, 'recipient')) {
    const scoped = Object.hasOwn(facts, 'asset') ? effects.filter((effect) => assetMatches(effect, facts.asset)) : effects;
    const found = scoped.some((effect) => effect.to === facts.recipient);
    record('recipient', { ok: found }, `declared ${facts.recipient}, readback shows ${scoped.map((effect) => effect.to).join(', ') || 'no transfer'}`);
  }
  if (Number.isInteger(extras.ledger)) record('ledger', { ok: transaction.ledger === extras.ledger }, `declared ledger ${extras.ledger}, readback says ${transaction.ledger}`);
  if (typeof extras.source_account === 'string') record('source_account', { ok: transaction.source_account === extras.source_account }, `declared ${extras.source_account}, readback says ${transaction.source_account}`);
  if (typeof extras.successful === 'boolean') record('successful', { ok: transaction.successful === extras.successful }, `declared successful ${extras.successful}, readback says ${transaction.successful}`);
  if (typeof extras.payer === 'string') {
    const found = effects.some((effect) => effect.from === extras.payer);
    record('payer', { ok: found }, `declared payer ${extras.payer}, readback shows ${[...new Set(effects.map((effect) => effect.from).filter(Boolean))].join(', ') || 'no transfer'}`);
  }
  if (Number.isInteger(extras.transfer_count)) {
    const scoped = Object.hasOwn(facts, 'recipient') ? effects.filter((effect) => effect.to === facts.recipient) : effects;
    record('transfer_count', { ok: scoped.length === extras.transfer_count }, `declared ${extras.transfer_count} transfer(s), readback shows ${scoped.length}`);
  }
  if (extras.network_order && typeof extras.network_order === 'object') {
    const { ledger, index } = extras.network_order;
    if (Number.isInteger(ledger)) record('network_order.ledger', { ok: transaction.ledger === ledger }, `declared position at ledger ${ledger}, readback says ${transaction.ledger}`);
    if (Number.isInteger(index)) not_checked.push({ field: 'network_order.index', reason: 'the position of a transaction inside a ledger is not part of the read of that transaction, so the declared index is published and left unchecked' });
  }

  const undeclared = DECLARED_FIELDS.filter((field) => !Object.hasOwn(facts, field));
  return {
    ok: null,
    checked,
    matched,
    discrepancies,
    undeclared_fields: undeclared,
    not_checked,
    reason: `the run record declared ${DECLARED_FIELDS.length - undeclared.length} of the ${DECLARED_FIELDS.length} facts (${DECLARED_FIELDS.join(', ')}); it left ${undeclared.join(', ') || 'nothing'} undeclared, which is not invented`,
    historical_response,
  };
}

export async function verifyEvidenceSet(entries, fetchTransaction, capturedAt = new Date().toISOString()) {
  if (typeof fetchTransaction !== 'function') throw new TypeError('fetchTransaction must be a function');
  const results = [];
  for (const entry of entries ?? []) {
    const hash = entry?.hash;
    const partial = !expectedShape(entry?.expected) && Boolean(entry?.declared) && typeof entry.declared === 'object';
    if (!expectedShape(entry?.expected)) {
      let historical_response = null;
      let readbackReason = null;
      let response = null;
      try {
        response = await fetchTransaction(hash);
        if (response?.transaction && typeof response.transaction === 'object' && Array.isArray(response.operations)) {
          historical_response = { classification: 'historical_readback', captured_at: capturedAt, transaction: response.transaction, operations: response.operations };
        } else {
          readbackReason = 'Horizon response did not contain a transaction record and operations';
        }
      } catch (error) {
        readbackReason = error?.message ?? 'readback failed';
      }
      if (readbackReason || !partial) {
        results.push({
          hash,
          ok: null,
          field: readbackReason ? 'readback' : 'expected',
          reason: readbackReason ?? 'no local run record declared the expected operation, memo, asset, amount, and recipient',
          historical_response,
        });
        continue;
      }
      const verified = verifyDeclaredFacts(response, entry.declared, capturedAt);
      results.push({
        hash,
        ok: null,
        field: 'partial',
        matched: verified.matched,
        discrepancies: verified.discrepancies,
        undeclared_fields: verified.undeclared_fields,
        not_checked: verified.not_checked,
        reason: verified.reason,
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
  const partialDeclared = entries.filter((entry) => !expectedShape(entry.expected) && entry.declared).length;
  const capturedAt = new Date().toISOString();
  const results = await verifyEvidenceSet(entries, (hash) => readHorizonTransaction(hash), capturedAt);
  const verified = results.filter((result) => result.ok === true);
  const failed = results.filter((result) => result.ok === false);
  const unverified = results.filter((result) => result.ok === null);
  const partial = unverified.filter((result) => result.field === 'partial');
  const discrepancies = partial.filter((result) => (result.discrepancies ?? []).length > 0);
  for (const result of results) {
    const detail = result.ok === true
      ? 'verified'
      : result.ok === false
        ? `mismatch: ${result.field}`
        : result.field === 'partial'
          ? `${(result.discrepancies ?? []).length > 0 ? 'DISCREPANCIA' : 'partially verified'}: ${(result.matched ?? []).length} declared fact(s) confirmed, ${(result.discrepancies ?? []).length} contradicted, ${(result.undeclared_fields ?? []).length} undeclared`
          : `not semantically verified (${result.field})`;
    process.stdout.write(`${result.hash}: ${detail}\n`);
    for (const discrepancy of result.discrepancies ?? []) {
      process.stdout.write(`  DISCREPANCIA ${discrepancy.field}: the run record declared ${discrepancy.detail}\n`);
    }
    for (const unchecked of result.not_checked ?? []) {
      process.stdout.write(`  declared but unchecked ${unchecked.field}: ${unchecked.reason}\n`);
    }
  }
  const resultByHash = new Map(results.map((result) => [result.hash, result]));
  evidence.transactions = entries.map((entry) => {
    const result = resultByHash.get(entry.hash);
    const verification = result.ok === null
      ? result.field === 'partial'
        ? {
          ok: null,
          status: (result.discrepancies ?? []).length > 0 ? 'discrepancia' : 'partially_verified',
          field: 'partial',
          confirmed_facts: result.matched ?? [],
          contradicted_facts: result.discrepancies ?? [],
          undeclared_facts: result.undeclared_fields ?? [],
          declared_but_unchecked: result.not_checked ?? [],
          reason: result.reason,
        }
        : { ok: null, status: 'not_semantically_verified', field: result.field, reason: result.reason }
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
      partially_verified: partial.length - discrepancies.length,
      discrepancy: discrepancies.length,
      not_semantically_verified: unverified.length - partial.length,
      declared_locally: declared,
      declared_partially: partialDeclared,
      expectation_source: 'local run records in this repository and in the repositories named per case, never the Horizon response',
    },
    readback_read: results.filter((result) => result.historical_response).length,
    readback_unread: results.filter((result) => !result.historical_response).length,
  };
  await writeFile(filename, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const counts = evidence.summary.semantic_verification;
  process.stdout.write(`semantically verified ${counts.verified} of ${entries.length}; ${counts.mismatch} mismatch, ${counts.partially_verified} partially verified, ${counts.discrepancy} with a discrepancy, ${counts.not_semantically_verified} without a local run record; readbacks saved for ${evidence.summary.readback_read}\n`);
  if (discrepancies.length) process.stdout.write(`${discrepancies.length} case(s) where the run record contradicts the chain: listed above, left as they are\n`);
  if (failed.length) throw new Error(`${failed.length} transaction evidence case(s) failed semantic verification; historical responses were saved for review`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
