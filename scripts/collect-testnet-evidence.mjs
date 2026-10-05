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

import { readFile, writeFile, readdir, realpath, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_EVIDENCE = fileURLToPath(new URL('../docs/testnet-evidence.json', import.meta.url));
const EVIDENCE_FILE_NAME = 'docs/testnet-evidence.json';
const HORIZON = 'https://horizon-testnet.stellar.org';
const READ_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 750;
const LOCAL_RECORD_CLASSIFICATION = 'local_run_record';
// A record root is a boundary of what will be read, and size was not part of it: the walk stopped
// a link and checked the real path, then loaded whatever `.json` it found with `readFile`. A 5 MB
// record was read whole before a byte of it was judged (R1 finding H2c, the half of H2 the fix did
// not touch). The bound is asked of the file's own size, before the bytes exist in memory, so a
// record cannot cost more to refuse than to read. One mebibyte sits far above what these roots hold
// today: the largest `.json` under `demo/` or `experiments/` is a 63 KB package lock, and the largest
// file any format recognises as a record is 2 KB.
const MAX_RUN_RECORD_MIB = 1;
const MAX_RUN_RECORD_BYTES = MAX_RUN_RECORD_MIB * 1024 * 1024;
const OVERSIZED_REASON = `the record is larger than the ${MAX_RUN_RECORD_MIB} MiB bound and was not read`;

const KERNEL_REPOSITORY = 'vespi-kernel';

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
      repository: KERNEL_REPOSITORY,
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

// The five facts a semantic verification compares. A run record may declare all of them
// (a payment) or only some of them (an anchor writes a digest, not an amount). What a
// record does not declare stays undeclared: it is reported, never filled in.
export const DECLARED_FACTS = Object.freeze(['operation', 'memo', 'asset', 'amount', 'recipient']);

const DISPLAY_DECIMALS = 7;

// The scale the kernel's own adapter declares for atomic amounts of the demo token, and
// the adapter lines that say how an x402 payment is built. A record that declares an
// atomic amount is read with this scale, cited to this repository, never taken from the
// readback.
const ATOMIC_SCALE_CITATION = Object.freeze({ repository: KERNEL_REPOSITORY, file: 'demo/x402/amount.js', line: 1, contains: 'const SCALE = 10_000_000n' });
const X402_ADAPTER_CITATIONS = Object.freeze({
  price: { repository: KERNEL_REPOSITORY, file: 'demo/x402/capability.js', line: 15, contains: "const PRICE_ATOMIC = '100000'" },
  effect: { repository: KERNEL_REPOSITORY, file: 'demo/x402/capability.js', line: 285, contains: 'amount: PRICE_ATOMIC, to: recipient' },
  soroban: { repository: KERNEL_REPOSITORY, file: 'demo/x402/capability.js', line: 335, contains: 'sorobanData' },
  issuer: { repository: KERNEL_REPOSITORY, file: 'demo/x402/run.js', line: 13, contains: "const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'" },
  settlement: { repository: KERNEL_REPOSITORY, file: 'experiments/002-x402-slice1/RUN.md', line: 32, contains: 'invoke_host_function' },
});
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

// Atomic units to the display form Horizon reports, using the scale the kernel declares.
export function atomicToDisplay(atomic) {
  const value = BigInt(String(atomic));
  const divisor = 10n ** BigInt(DISPLAY_DECIMALS);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(DISPLAY_DECIMALS, '0');
  return `${whole}.${fraction}`;
}

// A citation is only worth writing if the line it names really contains the fragment, so
// every citation is looked up in the text of the record it comes from. A fragment that is
// not there is an error, never a citation.
function locator(text) {
  const lines = text.split(/\r?\n/);
  return {
    lineOf(fragment, near = null) {
      const found = [];
      lines.forEach((line, index) => { if (line.includes(fragment)) found.push(index + 1); });
      if (found.length === 0) return null;
      if (near === null) return found[0];
      return found.reduce((best, candidate) => (Math.abs(candidate - near) < Math.abs(best - near) ? candidate : best), found[0]);
    },
  };
}

function citationReader(repository, file, at) {
  return (fragment, near = null) => {
    const line = at.lineOf(fragment, near);
    if (line === null) throw new Error(`${repository}:${file} does not contain ${JSON.stringify(fragment)}`);
    return { repository, file, line, contains: fragment };
  };
}

function declaredKeys(declared) {
  return DECLARED_FACTS.filter((field) => field !== 'extras' && Object.hasOwn(declared, field));
}

function undeclaredFor(declared) {
  return DECLARED_FACTS.filter((field) => !Object.hasOwn(declared, field));
}

function partialDeclaration({ repository, file, format, recordedAt, declared, citations, derivations, reason }) {
  return {
    hash: null,
    expectedFrom: {
      classification: LOCAL_RECORD_CLASSIFICATION,
      repository,
      record: file,
      format,
      recorded_at: recordedAt,
      citations,
      declared_fields: declaredKeys(declared),
      undeclared_fields: undeclaredFor(declared),
      undeclared_reason: reason,
      derivations: derivations ?? {},
    },
    expected: null,
    declared,
  };
}

function fullDeclaration({ repository, file, format, recordedAt, expected, citations, derivations }) {
  return {
    hash: null,
    expectedFrom: {
      classification: LOCAL_RECORD_CLASSIFICATION,
      repository,
      record: file,
      format,
      recorded_at: recordedAt,
      citations,
      declared_fields: [],
      undeclared_fields: [],
      derivations: derivations ?? {},
    },
    expected,
    declared: null,
  };
}

// A record of an anchor: a digest anchored at a ledger by an account. It declares the
// memo hash, the ledger and the account, and nothing about an asset, an amount or a
// recipient, because anchoring is not a payment.
const ANCHOR_RUN = {
  name: 'temis_anchor_run',
  detect: (record) => Array.isArray(record?.anclajes) && typeof record.cuenta_ancla === 'string',
  read({ record, repository, file, cite }) {
    const declarations = [];
    for (const anchor of record.anclajes) {
      if (!isHash(anchor?.hash) || !isHash(anchor.digest) || !Number.isInteger(anchor.ledger)) continue;
      const near = cite(anchor.hash).line;
      const unauthorized = typeof anchor.nota === 'string' && anchor.nota.includes('cuenta_no_autorizada');
      const source = unauthorized ? record.cuenta_ajena : record.cuenta_ancla;
      if (typeof source !== 'string') continue;
      const citations = [
        cite(anchor.hash, near),
        cite(anchor.digest, near),
        cite(`"ledger": ${anchor.ledger}`, near),
        cite(`"${source}"`),
        ...(unauthorized ? [cite(anchor.nota, near), cite(`"${record.cuenta_ajena}"`)] : []),
      ];
      declarations.push({
        ...partialDeclaration({
          repository,
          file,
          format: ANCHOR_RUN.name,
          recordedAt: record.fecha,
          declared: {
            memo: { kind: 'memo_hash', digest: anchor.digest.toLowerCase() },
            extras: { ledger: anchor.ledger, source_account: source, successful: true },
          },
          citations,
          derivations: {
            memo: 'The record stores the digest it anchored. Stellar anchors a digest in a MEMO_HASH, and Horizon returns a MEMO_HASH as the base64 of the same 32 bytes, so the expectation is that base64 form.',
            source_account: unauthorized
              ? 'The nota on this line says the anchor was expected from an unauthorized account, so the account the record names for that case (cuenta_ajena) is the one expected to have submitted it.'
              : 'Every line of the run was anchored by the anchor account the record names at the top of the file.',
            successful: 'The record stores the ledger number the network gave this hash. A hash only belongs to a ledger if the ledger included it, so the run declared a successful submission.',
            undeclared: 'The record does not declare an operation type, an asset, an amount or a recipient for this line, and none is invented: an anchor is not a payment.',
          },
          reason: 'the record stores the anchored digest, the ledger and the anchoring account for this line; it declares no operation type, no asset, no amount and no recipient',
        }),
        hash: anchor.hash.toLowerCase(),
      });
    }
    return declarations;
  },
};

// Two writers competing for the same key. Each one declares its own digest, its ledger
// and the position it landed at inside that ledger.
const CONCURRENCY_RACE = {
  name: 'temis_concurrency_race',
  detect: (record) => Array.isArray(record?.resultados) && record.resultados.some((row) => row?.escritura_A?.hash || row?.escritura_B?.hash),
  read({ record, repository, file, cite }) {
    const declarations = [];
    for (const row of record.resultados) {
      for (const side of ['escritura_A', 'escritura_B']) {
        const write = row?.[side];
        if (!isHash(write?.hash) || !isHash(write.digest) || !Number.isInteger(write.ledger)) continue;
        const near = cite(write.hash).line;
        const citations = [
          cite(write.hash, near),
          cite(write.digest, near),
          cite(`"ledger": ${write.ledger}`, near),
          cite(`"${row.cuenta_ancla}"`),
        ];
        const order = write.orden_en_red;
        if (Number.isInteger(order?.indice)) citations.push(cite(`"indice": ${order.indice}`, near));
        const extras = { ledger: write.ledger, source_account: row.cuenta_ancla, successful: true };
        if (Number.isInteger(order?.indice)) extras.network_order = { ledger: order.ledger ?? write.ledger, index: order.indice };
        declarations.push({
          ...partialDeclaration({
            repository,
            file,
            format: CONCURRENCY_RACE.name,
            recordedAt: record.fecha,
            declared: { memo: { kind: 'memo_hash', digest: write.digest.toLowerCase() }, extras },
            citations,
            derivations: {
              memo: 'The record stores the digest this writer anchored. A MEMO_HASH travels as the base64 of the same 32 bytes.',
              network_order: 'The record declares the ledger and the position inside it where this write landed. The ledger is checked against the readback; the position inside the ledger is not observable from the read of a single transaction, so it is declared and left unchecked.',
              source_account: 'Each round names the anchor account both writers used.',
              successful: 'The record stores the ledger the network gave this hash, which means the ledger included it.',
              undeclared: 'The record declares no operation type, no asset, no amount and no recipient for this write.',
            },
            reason: 'the record declares the anchored digest, the ledger, the position inside that ledger and the anchoring account; it declares no operation type, no asset, no amount and no recipient',
          }),
          hash: write.hash.toLowerCase(),
        });
      }
    }
    return declarations;
  },
};

// The same transfer settled two ways: one classic payment and one Soroban invocation.
// The record declares the operation of each, the payer, the recipient and the amount in
// atomic units, so both cases carry all five facts.
const OPERATION_TYPE = {
  name: 'temis_operation_type',
  detect: (record) => Boolean(record?.lectura) && typeof record?.lectura === 'object' && typeof record.importe_atomico === 'string',
  read({ record, repository, file, cite }) {
    const declarations = [];
    for (const [label, reading] of Object.entries(record.lectura)) {
      if (!isHash(reading?.hash)) continue;
      const operation = reading.operaciones?.[0]?.tipo;
      if (typeof operation !== 'string') continue;
      const transfer = (reading.eventos ?? []).find((event) => Array.isArray(event.topics) && event.topics[0] === 'transfer' && typeof event.topics[3] === 'string');
      const [code, issuer] = String(transfer?.topics?.[3] ?? '').split(':');
      if (!code || !isHash(reading.hash)) continue;
      const near = cite(reading.hash).line;
      const citations = [
        cite(reading.hash, near),
        cite(`"tipo": "${operation}"`, near),
        cite(`"${record.receptor}"`),
        cite(`"importe_atomico": "${record.importe_atomico}"`),
        cite(`"${code}:${issuer}"`),
        ATOMIC_SCALE_CITATION,
      ];
      declarations.push({
        ...fullDeclaration({
          repository,
          file,
          format: OPERATION_TYPE.name,
          recordedAt: record.fecha,
          expected: {
            operation,
            memo: null,
            asset: { type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12', code, issuer },
            amount: atomicToDisplay(record.importe_atomico),
            recipient: record.receptor,
          },
          citations,
          derivations: {
            operation: `The record stores the operations of the ${label} reading and its first entry is "${operation}".`,
            memo: 'The record declares no memo for this payment, so the expectation is null. If the readback carries a memo, verification fails on it.',
            asset: `The record stores the transfer event of the ${label} reading with the topic "${code}:${issuer}". credit_alphanum4 is Horizon's name for a four character asset code, a naming rule applied to the locally declared code, not a value read from the network.`,
            amount: `The record declares ${record.importe_atomico} atomic units. The kernel's own adapter declares the scale of 10000000 (demo/x402/amount.js), so that is ${atomicToDisplay(record.importe_atomico)} in the display form the readback reports.`,
            recipient: 'The record names the receptor of this run; it is the only account the payment was authorized to reach.',
          },
        }),
        hash: reading.hash.toLowerCase(),
      });
    }
    return declarations;
  },
};

// One payment, delivered once. The record observes the credit it caused and how many
// credits there were, but it does not say which operation type carried it.
const PAYMENT_IDEMPOTENCE = {
  name: 'temis_payment_idempotence',
  detect: (record) => Array.isArray(record?.pasos) && record.pasos.some((step) => isHash(step?.resultado?.tx)),
  read({ record, repository, file, cite }) {
    const declarations = [];
    const step = record.pasos.find((candidate) => Array.isArray(candidate?.importes) && typeof candidate.importes[0] === 'string');
    const credits = step?.abonos ?? record.abonos_en_la_red_con_la_tabla;
    const named = typeof step?.nombre === 'string' ? step.nombre.match(/abonos de ([A-Z0-9]{3,12})\b/) : null;
    const hash = record.pasos.find((candidate) => isHash(candidate?.resultado?.tx))?.resultado.tx;
    if (!isHash(hash) || typeof step?.importes?.[0] !== 'string' || !Number.isInteger(credits)) return declarations;
    const near = cite(hash).line;
    const citations = [
      cite(hash, near),
      cite(`"${record.receptor}"`),
      cite(`"${record.pagador}"`),
      cite(step.nombre),
      cite(`"${step.importes[0]}"`, cite(step.nombre).line),
    ];
    const declared = {
      ...(named ? { asset: { code: named[1] } } : {}),
      amount: step.importes[0],
      recipient: record.receptor,
      extras: { payer: record.pagador, transfer_count: credits },
    };
    declarations.push({
      ...partialDeclaration({
        repository,
        file,
        format: PAYMENT_IDEMPOTENCE.name,
        recordedAt: record.fecha,
        declared,
        citations,
        derivations: {
          asset: named ? `The step that counted the credits in Horizon is named "${step.nombre}", so the code it counts is ${named[1]}. The record does not name the issuer, so only the code is expected.` : 'The record does not name the asset of the credit.',
          amount: 'The record stores the amounts it counted in Horizon for this payment.',
          recipient: 'The record names the receptor of this run.',
          payer: 'The record names the payer, which is the account the credit came from.',
          transfer_count: 'The record counts how many credits this payment produced in Horizon. One credit for one payment is what the idempotence claim rests on.',
          undeclared: 'The record observes the credit from the outside; it does not declare which operation type carried it and it declares no memo.',
        },
        reason: 'the record declares the amount, the recipient, the payer and the number of credits it produced; it declares no operation type and no memo',
      }),
      hash: hash.toLowerCase(),
    });
    return declarations;
  },
};

// The x402 demo receipt. It declares the asset contract, the maximum amount and the payTo
// of the grant it exercised, plus the payer and the amount in atomic units. The operation
// type and the absent memo come from the adapter in this repository that built the
// transaction, cited as such.
const X402_RECEIPT_RUN = {
  name: 'x402_receipt_run',
  detect: (record) => Boolean(record?.receipt?.evidence?.txHash) && Array.isArray(record.receipt?.authority?.exercised),
  read({ record, repository, file, cite }) {
    const receipt = record.receipt;
    const exercised = receipt.authority.exercised[0];
    const hash = receipt.evidence?.txHash;
    if (!isHash(hash) || typeof exercised?.maxAmount !== 'string' || typeof exercised.to !== 'string') return [];
    const code = String(exercised.asset ?? '').split(':')[0];
    if (!code) return [];
    const near = cite(hash).line;
    const citations = [
      cite(hash, near),
      cite(`"maxAmount": "${exercised.maxAmount}"`, near),
      cite(`"${exercised.to}"`, near),
      cite(`"${exercised.asset}"`, near),
      cite(`"${receipt.evidence.payer}"`),
      X402_ADAPTER_CITATIONS.price,
      X402_ADAPTER_CITATIONS.effect,
      X402_ADAPTER_CITATIONS.soroban,
      X402_ADAPTER_CITATIONS.issuer,
      X402_ADAPTER_CITATIONS.settlement,
      ATOMIC_SCALE_CITATION,
    ];
    return [{
      ...fullDeclaration({
        repository,
        file,
        format: X402_RECEIPT_RUN.name,
        recordedAt: receipt.at,
        expected: {
          operation: 'invoke_host_function',
          memo: null,
          asset: { type: 'credit_alphanum4', code, issuer: USDC_ISSUER },
          amount: atomicToDisplay(exercised.maxAmount),
          recipient: exercised.to,
        },
        citations,
        derivations: {
          operation: 'This receipt comes from the kernel\'s own x402 demo adapter. experiments/002-x402-slice1/RUN.md records that official x402/Stellar settles through Soroban, and demo/x402/capability.js rebuilds the payload of this adapter with sorobanData, so the operation type of this run is invoke_host_function.',
          memo: 'No local record declares a memo for this run: the declared effect (capability.js:285) carries asset, amount and recipient and no memo, and the receipt has no memo field. The expectation is null: no memo. If the readback shows a memo, verification fails on it.',
          asset: `The code ${code} is the asset the receipt exercised. The issuer is the one demo/x402/run.js:13 configures for this token; credit_alphanum4 is Horizon's name for a four character code. The contract in the receipt is the Soroban token contract, not the classic issuer.`,
          amount: `The receipt declares ${exercised.maxAmount} atomic units as the exercised effect and the adapter declares the same price (capability.js:15). The kernel declares the scale of 10000000 (demo/x402/amount.js), so that is ${atomicToDisplay(exercised.maxAmount)} in the display form the readback reports.`,
          recipient: 'The receipt declares the payTo of the grant this run exercised.',
        },
      }),
      hash: hash.toLowerCase(),
    }];
  },
};

export const RUN_RECORD_FORMATS = Object.freeze([ANCHOR_RUN, CONCURRENCY_RACE, OPERATION_TYPE, PAYMENT_IDEMPOTENCE, X402_RECEIPT_RUN]);

// A record root is a boundary, not a starting point. `stat` follows a link and `readdir` without
// `withFileTypes` hands back plain names, so a link planted anywhere under the root (`runrecords/
// private -> anywhere`) made this walk out of the tree the declaration named and read whatever
// `.json` it found there, token included, into the evidence file (R1 finding H2). Two rules now
// hold it: a link is never followed, because `readdir(withFileTypes)` reports it with lstat
// semantics and `isFile`/`isDirectory` are false for it; and every accepted file has its real path
// checked against the real path of the root it was declared under, so a mount or a junction that
// resolves elsewhere is left out too.
async function jsonFiles(directory, boundary, seen) {
  // `boundary` is the real path of the root this walk started from and never changes: it is the
  // boundary every accepted file is measured against. `seen` holds the real path of each directory
  // already walked, so two paths that resolve to one directory are not walked twice.
  const root = boundary ?? await realpath(directory);
  let here;
  try {
    here = await realpath(directory);
  } catch {
    return [];
  }
  const visited = seen ?? new Set();
  if (visited.has(here)) return [];
  visited.add(here);
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await jsonFiles(full, root, visited));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      let resolved;
      try {
        resolved = await realpath(full);
      } catch {
        continue;
      }
      if (!withinRoot(resolved, root)) continue;
      found.push(full);
    }
  }
  return found.sort();
}

// A shared prefix is not containment: 'C:/out' is not inside 'C:/outside'. `path.relative` answers
// the question the way `delegation.js:within` already answers it in this repository.
function withinRoot(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// A file is measured before it is opened. The size comes from a `stat` of the accepted real path,
// so the question is asked of the file the rules above already admitted and not of a name.
async function recordSize(full) {
  try {
    const info = await stat(full);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// Reads every run record under the given roots. Each root names the repository its
// records come from, so every citation says which repository it is a citation into, and
// optionally the directory inside that repository the records live in. A record file
// whose shape no format recognises is listed with no format: a file is never mined for
// facts because it happens to mention a hash.
// A record over the size bound is not read at all and is not left out in silence: it is
// reported as refused, with the size that refused it, because a record that was skipped is a
// fact about the collection and the summary is where the collection says what it did.
export async function loadRunRecords(roots = []) {
  const declarations = new Map();
  const files = [];
  const refused = [];
  for (const root of roots ?? []) {
    if (typeof root?.repository !== 'string' || root.repository.trim() === '') throw new TypeError('every run record root must name the repository its records come from');
    if (typeof root?.directory !== 'string' || root.directory === '') throw new TypeError('every run record root must name a directory');
    const prefix = typeof root.prefix === 'string' && root.prefix !== '' ? `${root.prefix.replace(/\\/g, '/').replace(/\/+$/, '')}/` : '';
    for (const full of await jsonFiles(root.directory)) {
      const relative = path.relative(root.directory, full).split(path.sep).join('/');
      const file = `${prefix}${relative}`;
      const bytes = await recordSize(full);
      if (bytes !== null && bytes > MAX_RUN_RECORD_BYTES) {
        refused.push({ repository: root.repository, file, bytes, reason: OVERSIZED_REASON });
        continue;
      }
      const text = await readFile(full, 'utf8');
      const record = JSON.parse(text);
      const format = RUN_RECORD_FORMATS.find((candidate) => { try { return candidate.detect(record); } catch { return false; } });
      files.push({ repository: root.repository, file, local_path: relative, format: format?.name ?? null });
      if (!format) continue;
      const declarationsForFile = format.read({ record, repository: root.repository, file, cite: citationReader(root.repository, file, locator(text)) });
      for (const declaration of declarationsForFile) {
        const key = declaration.hash;
        declarations.set(key, [...(declarations.get(key) ?? []), declaration]);
      }
    }
  }
  return { declarations, files, refused };
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
  const partial = !Object.hasOwn(entry ?? {}, 'expected') && Object.hasOwn(entry ?? {}, 'declared');
  if (!entry || typeof entry !== 'object' || (!Object.hasOwn(entry, 'expected') && !partial)) return { ok: true, problems };
  const source = entry.expectedFrom;
  if (!source || typeof source !== 'object') {
    problems.push(`${entry.hash}: ${partial ? 'declared facts' : 'expected facts'} without an expectedFrom local record citation`);
    return { ok: false, problems };
  }
  if (source.classification !== LOCAL_RECORD_CLASSIFICATION) {
    problems.push(`${entry.hash}: expectedFrom.classification must be ${LOCAL_RECORD_CLASSIFICATION}, found ${JSON.stringify(source.classification)}`);
  }
  if (Object.hasOwn(source, 'repository') && (typeof source.repository !== 'string' || source.repository.trim() === '')) {
    problems.push(`${entry.hash}: expectedFrom.repository must name the repository the run record comes from`);
  } else if (partial && typeof source.repository !== 'string') {
    problems.push(`${entry.hash}: a partial declaration must name the repository its run record comes from`);
  }
  const citations = Array.isArray(source.citations) ? source.citations : [];
  if (citations.length === 0) problems.push(`${entry.hash}: expectedFrom carries no citation`);
  for (const citation of citations) {
    if (!citationShape(citation)) problems.push(`${entry.hash}: citation must name a file, a line and a fragment to look for`);
    else if (Object.hasOwn(citation, 'repository') && (typeof citation.repository !== 'string' || citation.repository.trim() === '')) problems.push(`${entry.hash}: a citation that names a repository must name one`);
    else if (typeof citation.file === 'string' && citation.file.replace(/\\/g, '/') === evidenceFile.replace(/\\/g, '/')) problems.push(`${entry.hash}: a citation may not point at the evidence file being verified`);
  }
  if (partial) {
    const declared = Array.isArray(source.declared_fields) ? [...source.declared_fields].sort() : null;
    const undeclared = Array.isArray(source.undeclared_fields) ? [...source.undeclared_fields].sort() : null;
    const actual = declaredKeys(entry.declared).sort();
    if (declared === null || undeclared === null) problems.push(`${entry.hash}: a partial declaration must list declared_fields and undeclared_fields`);
    else {
      if (declared.join(',') !== actual.join(',')) problems.push(`${entry.hash}: declared_fields says ${declared.join(',') || 'nothing'} but the declaration holds ${actual.join(',') || 'nothing'}`);
      if (declared.length + undeclared.length !== DECLARED_FACTS.length) problems.push(`${entry.hash}: declared_fields and undeclared_fields must account for all ${DECLARED_FACTS.length} facts (${DECLARED_FACTS.join(', ')})`);
      for (const field of declared) if (undeclared.includes(field)) problems.push(`${entry.hash}: ${field} is declared and undeclared at the same time`);
      if (undeclared.length > 0 && (typeof source.undeclared_reason !== 'string' || source.undeclared_reason.trim() === '')) problems.push(`${entry.hash}: facts left undeclared must say why in undeclared_reason`);
    }
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

// What a failed read says. The reader's own message is not copied: a reader that throws
// `fetch failed: https://horizon-testnet.stellar.org/?apiKey=SUPERSECRETKEY` put the credential in
// the reason, and the reason is written to disk with the evidence (R1 finding H3b, the channel H3
// never chartered). The message is still read to tell a timeout from another failure, which is a
// shape test and travels nowhere; every reason below is one of two fixed phrases, plus the three
// `readbackShape` answers for a response that arrived and was malformed.
const READ_FAILED_REASON = 'the horizon read failed at every attempt';
const READ_TIMEOUT_REASON = 'the horizon read did not answer before the read timeout';

async function readWithBounds(hash, readTransaction, { readTimeoutMs, maxAttempts, retryDelayMs, sleep }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withTimeout(Promise.resolve().then(() => readTransaction(hash)), readTimeoutMs, `Horizon read of ${hash.slice(0, 8)}`);
      const malformed = readbackShape(response);
      if (malformed) return { status: 'malformed', attempts: attempt, reason: malformed, response: null };
      return { status: 'read', attempts: attempt, response };
    } catch (error) {
      const timedOut = /timed out after/.test(error?.message ?? '');
      if (attempt < maxAttempts) await sleep(retryDelayMs);
      if (timedOut) return { status: 'timeout', attempts: attempt, reason: READ_TIMEOUT_REASON, response: null };
    }
  }
  return { status: 'failed', attempts: maxAttempts, reason: READ_FAILED_REASON, response: null };
}

export async function collectEvidence({
  evidence,
  readTransaction,
  localExpectations = LOCAL_EXPECTATIONS,
  runRecordRoots = [],
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

  const { declarations: runDeclarations, files: recordFiles, refused: refusedRecords } = await loadRunRecords(runRecordRoots);
  const rootsSearched = (runRecordRoots ?? []).map((root) => root?.repository).filter((name) => typeof name === 'string' && name !== '');

  const transactions = [];
  for (const entry of evidence.transactions) {
    const hash = entry?.hash;
    // The hash is interpolated into a Horizon url, so it is a shape and not a string. `isHash` was
    // only ever applied to fields of a run record; the transaction list skipped it, and a hash of
    // "../../" resolved the url to `path=/` while "x?limit=200&cursor=" added a query nobody asked
    // for (R1 finding H3). Horizon is a literal constant, so this is not an SSRF and no credential
    // can move: what it buys is an outgoing request nobody intended and a corrupted readback. The
    // entry is kept and marked malformed rather than dropped, so the record of what was attempted
    // stays complete.
    const usableHash = isHash(hash);
    const record = usableHash ? localExpectation(hash, localExpectations) : null;
    const fromRoots = usableHash ? (runDeclarations.get(hash.toLowerCase()) ?? []) : [];
    const base = { ...entry };
    delete base.expected;
    delete base.declared;
    delete base.expectedFrom;
    delete base.expectedFromReason;
    delete base.expectedFromConflict;
    delete base.historical_response;
    delete base.readback;

    const read = usableHash
      ? await readWithBounds(hash, readTransaction, { readTimeoutMs, maxAttempts, retryDelayMs, sleep })
      : { status: 'malformed', attempts: 0, reason: 'the declared hash is not 64 hexadecimal characters, so no read was attempted', response: null };
    const collected = { ...base };
    if (record) {
      collected.expected = record.expected;
      collected.expectedFrom = record.expectedFrom;
    } else if (fromRoots.length === 1) {
      const [{ expected, declared, expectedFrom }] = fromRoots;
      if (expected) collected.expected = expected;
      if (declared) collected.declared = declared;
      collected.expectedFrom = expectedFrom;
    } else if (fromRoots.length > 1) {
      collected.expectedFrom = null;
      collected.expectedFromConflict = fromRoots.map((declaration) => ({
        repository: declaration.expectedFrom.repository,
        record: declaration.expectedFrom.record,
        format: declaration.expectedFrom.format,
      }));
      collected.expectedFromReason = `${fromRoots.length} run records in different repositories declare this transaction differently (${fromRoots.map((declaration) => declaration.expectedFrom.repository).join(', ')}); no expectation is declared, because picking one side would make the comparison a choice instead of a check`;
    } else {
      collected.expectedFrom = null;
      collected.expectedFromReason = rootsSearched.length > 0
        ? `no run record for this transaction in any of the ${rootsSearched.length} record repositories searched (${rootsSearched.join(', ')}); run: ${entry?.run ?? 'unlabeled'}. The expectation is not declared locally and was not copied from the Horizon readback`
        : `no run record for this transaction in this repository (run: ${entry?.run ?? 'unlabeled'}); the expectation is not declared locally and was not copied from the Horizon readback`;
    }
    collected.historical_response = read.response
      ? { classification: 'historical_readback', captured_at: capturedAt, transaction: read.response.transaction, operations: read.response.operations }
      : null;
    collected.readback = { status: read.status, attempts: read.attempts, ...(read.reason ? { reason: read.reason } : {}) };
    transactions.push(collected);
  }

  const count = (status) => transactions.filter((entry) => entry.readback.status === status).length;
  const withExpectation = transactions.filter((entry) => Object.hasOwn(entry, 'expected')).length;
  const withPartial = transactions.filter((entry) => Object.hasOwn(entry, 'declared')).length;
  return {
    ...evidence,
    summary: {
      ...(evidence.summary ?? {}),
      collected_at: capturedAt,
      transactions_found: transactions.length,
      local_expectation: withExpectation,
      local_partial_declaration: withPartial,
      no_local_expectation: transactions.length - withExpectation - withPartial,
      record_conflicts: transactions.filter((entry) => Array.isArray(entry.expectedFromConflict)).length,
      readback_read: count('read'),
      readback_failed: count('failed') + count('malformed') + count('timeout'),
      // What the readbacks report, counted from the readbacks. This is an observation of the
      // network, never an expectation: no case is verified by it.
      readback_successful: transactions.filter((entry) => entry.historical_response?.transaction?.successful === true).length,
      local_record_source: 'repository run records, never the Horizon response',
      ...(rootsSearched.length > 0 ? {
        run_record_roots: (runRecordRoots ?? []).map((root) => ({
          repository: root.repository,
          directory: root.directory,
          ...(root.prefix ? { prefix: root.prefix } : {}),
          files: recordFiles.filter((file) => file.repository === root.repository),
          formats: [...new Set(recordFiles.filter((file) => file.repository === root.repository).map((file) => file.format))],
          refused: refusedRecords.filter((file) => file.repository === root.repository),
        })),
      } : {}),
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

// --record-root NAME=DIR and --record-prefix NAME=PREFIX name a directory of run records
// and the directory inside its repository it corresponds to, so every citation says which
// repository it points into.
export function parseRecordRoots(argv) {
  const roots = [];
  const valuesOf = (flag) => argv.flatMap((argument, index) => {
    if (argument === flag) return [argv[index + 1]];
    return argument.startsWith(`${flag}=`) ? [argument.slice(flag.length + 1)] : [];
  });
  for (const value of valuesOf('--record-root')) {
    const separator = value.indexOf('=');
    const repository = value.slice(0, separator);
    const directory = value.slice(separator + 1);
    roots.push({ repository, directory, prefix: undefined });
  }
  for (const value of valuesOf('--record-prefix')) {
    const separator = value.indexOf('=');
    const repository = value.slice(0, separator);
    const target = roots.find((root) => root.repository === repository);
    if (!target) throw new Error(`--record-prefix=${repository} names no --record-root`);
    target.prefix = value.slice(separator + 1);
  }
  return roots;
}

async function main(argv) {
  const positional = argv.filter((argument, index) => {
    if (argument === '--record-root' || argument === '--record-prefix') return false;
    if (argv[index - 1] === '--record-root' || argv[index - 1] === '--record-prefix') return false;
    return !argument.startsWith('--');
  });
  const filename = positional[0] || DEFAULT_EVIDENCE;
  const evidence = JSON.parse(await readFile(filename, 'utf8'));
  const collected = await collectEvidence({
    evidence,
    readTransaction: (hash) => readHorizonTransaction(hash),
    runRecordRoots: parseRecordRoots(argv),
  });
  assertExpectationProvenance(collected.transactions, path.relative(process.cwd(), filename).replace(/\\/g, '/'));
  await writeFile(filename, `${JSON.stringify(collected, null, 2)}\n`, 'utf8');
  for (const entry of collected.transactions) {
    const declared = Object.hasOwn(entry, 'expected')
      ? `expected from ${entry.expectedFrom.repository ?? 'this repository'}`
      : Object.hasOwn(entry, 'declared')
        ? `declared ${entry.expectedFrom.declared_fields.length}/5 facts from ${entry.expectedFrom.repository}`
        : Array.isArray(entry.expectedFromConflict)
          ? `conflict between ${entry.expectedFromConflict.length} run records`
          : 'no run record';
    process.stdout.write(`${entry.hash.slice(0, 12)}: readback ${entry.readback.status} (attempts ${entry.readback.attempts}), ${declared}\n`);
  }
  const { summary } = collected;
  process.stdout.write(`${summary.transactions_found} cases collected: ${summary.local_expectation} with all five facts locally declared, ${summary.local_partial_declaration} with a partial declaration, ${summary.no_local_expectation} without one; ${summary.readback_read} readbacks read, ${summary.readback_failed} not read\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}