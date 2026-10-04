'use strict';

// F1c: expectations taken from run records that live in other repositories.
//
// Every transaction in docs/testnet-evidence.json was run by somebody. When the run
// record is committed in another repository, the expectation still comes from that
// record, never from the Horizon readback. A record may declare all five facts
// (operation, memo, asset, amount, recipient) or only some of them: what it does not
// declare stays undeclared and the case is reported as partially verified. A record
// that contradicts the chain is reported as a discrepancy and never adjusted.
//
// The fixtures below are reduced copies of real run records: TEMIS tramos/3,
// TEMIS tramos/4 and the x402 corrida receipts. Each one keeps the real hashes,
// digests, ledgers and line content of the record it was cut from.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const collectorModule = import('../scripts/collect-testnet-evidence.mjs');
const verifierModule = import('../scripts/verify-testnet-evidence.mjs');

const REPO_ROOT = path.join(__dirname, '..');
const CAPTURED_AT = '2040-01-01T00:00:00.000Z';

const ANCHOR_HASH = 'c4c3e3a0857b85b57f9cd4f71c55951f998491f9e876f1148cbe9f352962f48e';
const ANCHOR_DIGEST = 'e38cb619e179de4ce24f5adfb18e029c3dc840841dd48f3a832e53287980cd71';
const FOREIGN_HASH = 'f214ae28eb076ab0d0d1c8ff3a7bb4d1cd7d8f5aa2ae1ff0f39a4b0e0b2c1e5a';
const ANCLA = 'GDWWBZGPISWYOOKFWXU42MVSSZSXVTTVZW6RMVVFF4GKJ6PXIHOX342H';
const AJENA = 'GBLGGBD744UYUO6VPGTNQHAR67YJ6LDH57PNNBLPVUQDUUDVGVB7Z4W2';

const RACE_A = 'eaa79b261b4c8ef0dc4717a73fe72593d02c733e47afd121cfaa87e557fda451';
const RACE_B = '72c4e3db6e42ef352263d1a2a382d2343020d071ac7a981848d057d05fff18b2';
const RACE_ANCLA = 'GBUJ2OIMWU2XMRBDYBATO76CWXY3VZMYR3RUIO22IGOYUHUHDPYNRLW5';
const RACE_A_DIGEST = 'ecad7344cc1520045e22b3e83c30906fcc4b401d55d7ec2a8c5584dc9d6c3511';
const RACE_B_DIGEST = 'eb01e10e5c141e2ab249d07db86613d9d3eddaa69170d63b111557b22eea27ec';

const OP_CLASSIC = 'a7b8393c5295acfc445b857a026c016646f56ceb53193ece2ce09eebbf40830f';
const OP_CONTRACT = '44e0f75295004850dee7f6894d2111124d4c1a4d4e528bb777122878937a7542';
const OP_PAYER = 'GAOAXETPOHNQS6CQB6XHRYRMLEDJDUCCRD7H7OHEW6JPSVU7BXNT66PQ';
const OP_RECIPIENT = 'GCH676SYEYEYR6ZXFY75AB5C3YM7CPSJB4VZEDHCA7JO3UPTDD7X6YPA';
const OP_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const IDEM_HASH = '5495a053cfde91f2ac2dd4eece581fc628072416cf9007d6ca78ab3becf4273a';
const IDEM_PAYER = 'GAF2UQ2CJFFVISDHMZLPSQ7PVHOEQWVZCKUD6HRJDIR7D5GAW3XCQT6Q';
const IDEM_RECIPIENT = 'GC2TSKRK7FBZIBQ3RHCUKHNA23FCWW4Z5QIQRHY3G4QNFOQIFLVLNRS4';

const X402_HASH = 'e43e1ed80675d2b7d174167765beeec1f6b5226b8bd2950fa8231e9bb31a9f91';
const X402_RECIPIENT = 'GD7MPNDYJO6YOQJ2NTSWDN2QDPZWORG2J7L7SCVIXU3IGVOMJNGZUV6J';
const X402_PAYER = 'GAB3TBOXYG5T2OXF42NQJRMJEUJ7E7GTDT3P7QYYTKBIZEYJUQ6NQBN4';

const UNKNOWN_HASH = 'd'.repeat(64);

// Reduced copy of TEMIS tramos/3/corrida-exp-murckqaa.json (the anchor run) and of its
// adversarial line, the one the record marks with a nota.
const FIXTURE_ANCHORS = `{
  "fecha": "2026-10-02T19:21:52.847Z",
  "red": "stellar:testnet",
  "expediente_id": "exp-murckqaa",
  "cuenta_ancla": "${ANCLA}",
  "cuenta_ajena": "${AJENA}",
  "anclajes": [
    {
      "digest": "${ANCHOR_DIGEST}",
      "evento": "acuerdo",
      "hito": null,
      "version": 1,
      "hash": "${ANCHOR_HASH}",
      "ledger": 4989043,
      "nota": null
    },
    {
      "digest": "f7a1c6d2b3e4908a7562134fedcba9876543210ffeeddccbbaa00998877665544",
      "evento": "hito_abierto",
      "hito": "h1",
      "version": 1,
      "hash": "${FOREIGN_HASH}",
      "ledger": 4989058,
      "nota": "cuenta_no_autorizada esperada"
    }
  ],
  "cotejo_con_la_copia": {
    "coincide": true,
    "diferencias": []
  }
}
`;

// Reduced copy of TEMIS tramos/4/carrera.json (concurrent anchors, two writers).
const FIXTURE_RACE = `{
  "fecha": "2026-10-03T05:01:40.165Z",
  "red": "stellar:testnet",
  "rondas": 1,
  "todas_ok": true,
  "resultados": [
    {
      "ronda": 1,
      "expediente": "carrera-murx9j0e-1",
      "cuenta_ancla": "${RACE_ANCLA}",
      "escritura_A": {
        "digest": "${RACE_A_DIGEST}",
        "hash": "${RACE_A}",
        "ledger": 4996000,
        "intentos": 2,
        "orden_en_red": {
          "ledger": 4996000,
          "indice": 2
        }
      },
      "escritura_B": {
        "digest": "${RACE_B_DIGEST}",
        "hash": "${RACE_B}",
        "ledger": 4995994,
        "intentos": 1,
        "orden_en_red": {
          "ledger": 4995994,
          "indice": 1
        }
      },
      "mismo_ledger": false,
      "ganadora_esperada": "B",
      "ok": true
    }
  ]
}
`;

// Reduced copy of TEMIS tramos/4/tipo-operacion.json (same transfer, two operation types).
const FIXTURE_OPERATION = `{
  "fecha": "2026-10-03T04:57:19.182Z",
  "red": "stellar:testnet",
  "importe_atomico": "100000",
  "pagador": "${OP_PAYER}",
  "receptor": "${OP_RECIPIENT}",
  "lectura": {
    "clasica": {
      "hash": "${OP_CLASSIC}",
      "ledger": 4995969,
      "operaciones": [
        {
          "tipo": "payment",
          "funcion": null
        }
      ],
      "eventos": [
        {
          "tipo": "contract",
          "contrato": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
          "topics": [
            "transfer",
            "${OP_PAYER}",
            "${OP_RECIPIENT}",
            "USDC:${OP_ISSUER}"
          ],
          "datos": "100000"
        }
      ]
    },
    "contrato": {
      "hash": "${OP_CONTRACT}",
      "ledger": 4995970,
      "operaciones": [
        {
          "tipo": "invoke_host_function",
          "funcion": "HostFunctionTypeHostFunctionTypeInvokeContract"
        }
      ],
      "eventos": [
        {
          "tipo": "contract",
          "contrato": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
          "topics": [
            "transfer",
            "${OP_PAYER}",
            "${OP_RECIPIENT}",
            "USDC:${OP_ISSUER}"
          ],
          "datos": "100000"
        }
      ]
    }
  },
  "evento_transfer_identico": true,
  "tipos_distintos": true
}
`;

// Reduced copy of TEMIS tramos/4/idempotencia.json (one payment, delivered once).
const FIXTURE_IDEMPOTENCE = `{
  "fecha": "2026-10-03T05:12:42.416Z",
  "facilitador": "https://x402.org/facilitator",
  "pagador": "${IDEM_PAYER}",
  "receptor": "${IDEM_RECIPIENT}",
  "llamadas_al_facilitador_con_la_tabla": 1,
  "abonos_en_la_red_con_la_tabla": 1,
  "cobra_una_vez": true,
  "pasos": [
    {
      "nombre": "1. primera liquidacion",
      "estado": "liquidado",
      "nueva": true,
      "resultado": {
        "tx": "${IDEM_HASH}",
        "red": "stellar:testnet",
        "pagador": "${IDEM_PAYER}"
      },
      "llamadas_al_facilitador": 1
    },
    {
      "nombre": "6. abonos de USDC a la receptora en Horizon",
      "abonos": 1,
      "importes": [
        "0.0100000"
      ]
    }
  ]
}
`;

// Reduced copy of the x402 corrida-2 receipt (the payment the run exercised).
const FIXTURE_X402 = `{
  "status": "verified",
  "receipt": {
    "status": "verified",
    "capability": "x402-marketing-plan",
    "authority": {
      "grants": [
        {
          "asset": "USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
          "maxAmount": "500000",
          "to": "${X402_RECIPIENT}"
        }
      ],
      "exercised": [
        {
          "asset": "USDC:CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
          "maxAmount": "100000",
          "to": "${X402_RECIPIENT}"
        }
      ],
      "approval": "preauthorized"
    },
    "outcome": "verified",
    "evidence": {
      "txHash": "${X402_HASH}",
      "payer": "${X402_PAYER}",
      "network": "stellar:testnet"
    },
    "verification": {
      "verified": true,
      "checks": {
        "contract": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        "function": "transfer",
        "exactAmount": true,
        "amountAtomic": "100000"
      },
      "reason": "settlement matches exact declared effect"
    },
    "at": "2026-10-02T17:48:28.478Z"
  }
}
`;

async function root(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vespi-f1c-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, 'utf8');
  }
  return dir;
}

function evidence(entries) {
  return { summary: { transactions_found: entries.length }, transactions: entries };
}

function readTransactionFor(hash) {
  return async () => ({ transaction: { successful: true, hash }, operations: [] });
}

function base64Hex(hex) {
  return Buffer.from(hex, 'hex').toString('base64');
}

async function collect(entries, roots, extra = {}) {
  const collector = await collectorModule;
  return collector.collectEvidence({
    evidence: evidence(entries),
    readTransaction: readTransactionFor('x'),
    runRecordRoots: roots,
    capturedAt: CAPTURED_AT,
    ...extra,
  });
}

async function declarationFor(entry, roots) {
  const result = await collect([entry], roots);
  return result.transactions[0];
}

test('F1c-R1: a TEMIS anchor run declares the digest it anchored and the account that anchored it, and leaves payment fields undeclared', async () => {
  const dir = await root({ 'tramos/3/corrida-exp-murckqaa.json': FIXTURE_ANCHORS });
  const entry = await declarationFor({ hash: ANCHOR_HASH, run: 'TEMIS tramo 3, corrida 2' }, [{ repository: 'TEMIS', directory: dir }]);

  assert.deepEqual(entry.declared, {
    memo: { kind: 'memo_hash', digest: ANCHOR_DIGEST },
    extras: { ledger: 4989043, source_account: ANCLA, successful: true },
  });
  assert.deepEqual(entry.expectedFrom.undeclared_fields.sort(), ['amount', 'asset', 'operation', 'recipient']);
  assert.equal(entry.expectedFrom.repository, 'TEMIS');
  assert.equal(entry.expectedFrom.record, 'tramos/3/corrida-exp-murckqaa.json');
  assert.equal(entry.expectedFrom.format, 'temis_anchor_run');
  assert.equal(entry.expectedFrom.recorded_at, '2026-10-02T19:21:52.847Z');
  assert.equal(Object.hasOwn(entry, 'expected'), false, 'an anchor run does not declare a payment, so it must not claim one');
  for (const citation of entry.expectedFrom.citations) {
    assert.equal(citation.repository, 'TEMIS');
    const text = await readFile(path.join(dir, citation.file), 'utf8');
    const line = text.split(/\r?\n/)[citation.line - 1];
    assert.ok(line.includes(citation.contains), `${citation.file}:${citation.line} must contain ${citation.contains}`);
  }
});

test('F1c-R2: an anchor the record marks as coming from an unauthorized account expects that account, not the anchor account', async () => {
  const dir = await root({ 'tramos/3/corrida-exp-murckqaa.json': FIXTURE_ANCHORS });
  const entry = await declarationFor({ hash: FOREIGN_HASH, run: 'TEMIS tramo 3, corrida 2' }, [{ repository: 'TEMIS', directory: dir }]);

  assert.equal(entry.declared.extras.source_account, AJENA, 'the nota names the foreign account as the one that anchored');
  const notas = entry.expectedFrom.citations.filter((citation) => citation.contains.includes('cuenta_no_autorizada'));
  assert.ok(notas.length > 0, 'the derivation must cite the nota that says so');
  assert.ok(entry.expectedFrom.citations.some((citation) => citation.contains === AJENA), 'and the account it names');
});

test('F1c-R3: concurrent anchors keep each writer its own ledger, digest and declared position in the network', async () => {
  const dir = await root({ 'tramos/4/carrera.json': FIXTURE_RACE });
  const entry = await declarationFor({ hash: RACE_B, run: 'TEMIS tramo 4, anclajes concurrentes' }, [{ repository: 'TEMIS', directory: dir }]);

  assert.deepEqual(entry.declared, {
    memo: { kind: 'memo_hash', digest: RACE_B_DIGEST },
    extras: { ledger: 4995994, source_account: RACE_ANCLA, successful: true, network_order: { ledger: 4995994, index: 1 } },
  });
  assert.equal(entry.expectedFrom.format, 'temis_concurrency_race');
  assert.ok(entry.expectedFrom.citations.some((citation) => citation.contains.includes('"indice": 1') || citation.contains === '"indice": 1'));
});

test('F1c-R4: the operation-type run declares all five facts for both payments, in atomic units converted with the scale the kernel declares', async () => {
  const dir = await root({ 'tramos/4/tipo-operacion.json': FIXTURE_OPERATION });
  const classic = await declarationFor({ hash: OP_CLASSIC, run: 'TEMIS tramo 4' }, [{ repository: 'TEMIS', directory: dir }]);
  const contract = await declarationFor({ hash: OP_CONTRACT, run: 'TEMIS tramo 4' }, [{ repository: 'TEMIS', directory: dir }]);

  const wanted = {
    memo: null,
    asset: { type: 'credit_alphanum4', code: 'USDC', issuer: OP_ISSUER },
    amount: '0.0100000',
    recipient: OP_RECIPIENT,
  };
  assert.deepEqual(classic.expected, { operation: 'payment', ...wanted });
  assert.deepEqual(contract.expected, { operation: 'invoke_host_function', ...wanted });
  assert.equal(classic.expectedFrom.repository, 'TEMIS');
  assert.equal(classic.expectedFrom.format, 'temis_operation_type');
  assert.ok(classic.expectedFrom.declared_fields.length === 0);
  assert.match(classic.expectedFrom.derivations.amount, /10_000_000|scale/i);
});

test('F1c-R5: the idempotence run declares amount, recipient and payer but not the operation, and says the payment happened once', async () => {
  const dir = await root({ 'tramos/4/idempotencia.json': FIXTURE_IDEMPOTENCE });
  const entry = await declarationFor({ hash: IDEM_HASH, run: 'TEMIS tramo 4, idempotencia del pago x402' }, [{ repository: 'TEMIS', directory: dir }]);

  assert.deepEqual(entry.declared, {
    asset: { code: 'USDC' },
    amount: '0.0100000',
    recipient: IDEM_RECIPIENT,
    extras: { payer: IDEM_PAYER, transfer_count: 1 },
  });
  assert.deepEqual(entry.expectedFrom.undeclared_fields.sort(), ['memo', 'operation']);
  assert.match(entry.expectedFrom.undeclared_reason, /operation/i);
});

test('F1c-R6: an x402 corrida receipt declares the payment it exercised and cites the adapter that settles it through Soroban', async () => {
  const dir = await root({ 'corrida-2-verified.json': FIXTURE_X402 });
  const entry = await declarationFor({ hash: X402_HASH, run: 'Vespi x402, corridas 1 a 3' }, [{ repository: 'vespi-x402', directory: dir }]);

  assert.deepEqual(entry.expected, {
    operation: 'invoke_host_function',
    memo: null,
    asset: { type: 'credit_alphanum4', code: 'USDC', issuer: OP_ISSUER },
    amount: '0.0100000',
    recipient: X402_RECIPIENT,
  });
  assert.equal(entry.expectedFrom.repository, 'vespi-x402');
  assert.equal(entry.expectedFrom.format, 'x402_receipt_run');
  const kernelCitations = entry.expectedFrom.citations.filter((citation) => citation.repository === 'vespi-kernel');
  assert.ok(kernelCitations.length > 0, 'the operation and memo come from the kernel adapter, so they must cite it');
  for (const citation of kernelCitations) {
    const text = await readFile(path.join(REPO_ROOT, citation.file), 'utf8');
    const line = text.split(/\r?\n/)[citation.line - 1];
    assert.equal(typeof line, 'string', `${citation.file}:${citation.line} must exist in this repository`);
    assert.ok(line.includes(citation.contains), `${citation.file}:${citation.line} must contain ${citation.contains}`);
  }
});

test('F1c-A1: a file that mentions a hash without declaring a run is not a run record', async () => {
  const dir = await root({
    'notas.md': `# apuntes\n\nse vio ${ANCHOR_HASH} en la red\n`,
    'tramos/3/corrida-exp-murckqaa.json': FIXTURE_ANCHORS,
  });
  const collector = await collectorModule;
  const loaded = await collector.loadRunRecords([{ repository: 'TEMIS', directory: dir }]);

  assert.ok(loaded.files.every((file) => file.format !== null), 'every file that was read reports the format it matched, or none');
  assert.deepEqual(loaded.declarations.get(ANCHOR_HASH).expectedFrom.format, 'temis_anchor_run');
  const ignored = await declarationFor({ hash: UNKNOWN_HASH, run: 'sin registro' }, [{ repository: 'TEMIS', directory: dir }]);
  assert.equal(ignored.expectedFrom, null);
  assert.match(ignored.expectedFromReason, /no run record|no se encontro/i);
});

test('F1c-A2: two repositories declaring the same hash differently produce no expectation at all', async () => {
  const temis = await root({ 'tramos/4/tipo-operacion.json': FIXTURE_OPERATION });
  const other = await root({ 'otro/corrida.json': FIXTURE_OPERATION.replace(OP_RECIPIENT, 'GOTHERRECIPIENT0000000000000000000000000000000000000000AAA') });
  const entry = await declarationFor({ hash: OP_CLASSIC, run: 'conflicto' }, [
    { repository: 'TEMIS', directory: temis },
    { repository: 'otro-repo', directory: other },
  ]);

  assert.equal(Object.hasOwn(entry, 'expected'), false, 'a conflict must not be resolved by picking one side');
  assert.equal(Object.hasOwn(entry, 'declared'), false);
  assert.equal(entry.expectedFromConflict.length, 2);
  assert.deepEqual(entry.expectedFromConflict.map((conflict) => conflict.repository).sort(), ['TEMIS', 'otro-repo']);
});

test('F1c-A3: a run record root with no repository name is refused instead of producing unattributed citations', async () => {
  const dir = await root({ 'tramos/4/tipo-operacion.json': FIXTURE_OPERATION });
  const collector = await collectorModule;
  await assert.rejects(
    collector.collectEvidence({
      evidence: evidence([{ hash: OP_CLASSIC, run: 'sin repositorio' }]),
      readTransaction: readTransactionFor('x'),
      runRecordRoots: [{ repository: '', directory: dir }],
      capturedAt: CAPTURED_AT,
    }),
    /repository/i,
  );
});

test('F1c-A4: a record directory that does not exist is refused rather than read as empty', async () => {
  const collector = await collectorModule;
  await assert.rejects(
    collector.collectEvidence({
      evidence: evidence([{ hash: OP_CLASSIC, run: 'ruta inexistente' }]),
      readTransaction: readTransactionFor('x'),
      runRecordRoots: [{ repository: 'TEMIS', directory: path.join(os.tmpdir(), 'vespi-no-existe-f1c') }],
      capturedAt: CAPTURED_AT,
    }),
    /ENOENT|no existe|not found/i,
  );
});

test('F1c-A5: a hash with no record in any root stays unverified and keeps the reason', async () => {
  const dir = await root({ 'tramos/4/tipo-operacion.json': FIXTURE_OPERATION });
  const entry = await declarationFor({ hash: UNKNOWN_HASH, run: 'sin registro' }, [{ repository: 'TEMIS', directory: dir }]);

  assert.equal(entry.expectedFrom, null);
  assert.equal(entry.declared, undefined);
  assert.match(entry.expectedFromReason, /no run record/i);
});

test('F1c-A6: the provenance checker refuses a partial declaration that claims more fields than it declares', async () => {
  const collector = await collectorModule;
  const entry = {
    hash: ANCHOR_HASH,
    declared: { memo: { kind: 'memo_hash', digest: ANCHOR_DIGEST }, extras: { ledger: 4989043 } },
    expectedFrom: {
      classification: 'local_run_record',
      repository: 'TEMIS',
      record: 'tramos/3/corrida-exp-murckqaa.json',
      citations: [{ repository: 'TEMIS', file: 'tramos/3/corrida-exp-murckqaa.json', line: 12, contains: ANCHOR_DIGEST }],
      declared_fields: ['memo', 'operation', 'asset', 'amount', 'recipient'],
      undeclared_fields: [],
    },
  };
  const report = collector.expectationProvenance(entry);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => /declared_fields|undeclared_fields/.test(problem)), report.problems.join(' | '));
});

test('F1c-A7: the provenance checker refuses a citation with no repository and no file line', async () => {
  const collector = await collectorModule;
  const entry = {
    hash: ANCHOR_HASH,
    declared: { extras: { ledger: 4989043 } },
    expectedFrom: {
      classification: 'local_run_record',
      repository: '',
      record: 'tramos/3/corrida-exp-murckqaa.json',
      citations: [{ file: 'tramos/3/corrida-exp-murckqaa.json', line: 0, contains: ANCHOR_DIGEST }],
      declared_fields: [],
      undeclared_fields: ['operation', 'memo', 'asset', 'amount', 'recipient'],
    },
  };
  const report = collector.expectationProvenance(entry);
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => /repository/i.test(problem)), report.problems.join(' | '));
  assert.ok(report.problems.some((problem) => /file, a line/i.test(problem)), report.problems.join(' | '));
});

test('F1c-V1: every fact a record declares is checked against the readback, field by field', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const declared = {
    memo: { kind: 'memo_hash', digest: ANCHOR_DIGEST },
    extras: { ledger: 4989043, source_account: ANCLA, successful: true },
  };
  const response = {
    transaction: { successful: true, memo: base64Hex(ANCHOR_DIGEST), ledger: 4989043, source_account: ANCLA },
    operations: [{ type: 'bump_sequence' }],
  };

  const result = verifyDeclaredFacts(response, declared, CAPTURED_AT);
  assert.equal(result.ok, null, 'a partial declaration is never reported as verified');
  assert.deepEqual(result.matched.sort(), ['ledger', 'memo', 'source_account', 'successful']);
  assert.deepEqual(result.discrepancies, []);
  assert.deepEqual(result.undeclared_fields.sort(), ['amount', 'asset', 'operation', 'recipient']);
});

test('F1c-V2: a record that contradicts the chain is reported as a discrepancy and never adjusted', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const declared = { amount: '0.0100000', recipient: OP_RECIPIENT, extras: { ledger: 4989043 } };
  const response = {
    transaction: { successful: true, ledger: 4989049, source_account: ANCLA },
    operations: [{ type: 'payment', asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: OP_ISSUER, amount: '9.0000000', to: OP_RECIPIENT }],
  };

  const result = verifyDeclaredFacts(response, declared, CAPTURED_AT);
  assert.equal(result.ok, null, 'a partial case with a contradiction is not verified and not silently passed');
  assert.deepEqual(result.matched, ['recipient']);
  assert.deepEqual(result.discrepancies.map((discrepancy) => discrepancy.field).sort(), ['amount', 'ledger']);
  assert.deepEqual(declared.amount, '0.0100000', 'the declaration stays what the record said');
});

test('F1c-V3: an asset declared without an issuer is checked on its code alone', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const response = {
    transaction: { successful: true },
    operations: [{
      type: 'invoke_host_function',
      asset_balance_changes: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: OP_ISSUER, amount: '0.0100000', from: IDEM_PAYER, to: IDEM_RECIPIENT }],
    }],
  };
  const declared = { asset: { code: 'USDC' }, amount: '0.0100000', recipient: IDEM_RECIPIENT, extras: { payer: IDEM_PAYER, transfer_count: 1 } };

  const result = verifyDeclaredFacts(response, declared, CAPTURED_AT);
  assert.deepEqual(result.matched.sort(), ['amount', 'asset', 'payer', 'recipient', 'transfer_count']);
  assert.deepEqual(result.discrepancies, []);
});

test('F1c-V4: a transfer count that does not match the readback is a discrepancy', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const response = {
    transaction: { successful: true },
    operations: [{
      type: 'invoke_host_function',
      asset_balance_changes: [
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: OP_ISSUER, amount: '0.0100000', from: IDEM_PAYER, to: IDEM_RECIPIENT },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: OP_ISSUER, amount: '0.0100000', from: IDEM_PAYER, to: IDEM_RECIPIENT },
      ],
    }],
  };
  const result = verifyDeclaredFacts(response, { recipient: IDEM_RECIPIENT, extras: { transfer_count: 1 } }, CAPTURED_AT);
  assert.deepEqual(result.discrepancies.map((discrepancy) => discrepancy.field), ['transfer_count']);
  assert.match(result.discrepancies[0].detail, /2/);
});

test('F1c-V5: a memo hash declared as text is a discrepancy, not a match', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const response = { transaction: { successful: true, memo: base64Hex(ANCHOR_DIGEST) }, operations: [{ type: 'bump_sequence' }] };

  const asHash = verifyDeclaredFacts(response, { memo: { kind: 'memo_hash', digest: ANCHOR_DIGEST } }, CAPTURED_AT);
  assert.deepEqual(asHash.matched, ['memo']);

  const asText = verifyDeclaredFacts(response, { memo: { kind: 'text', value: base64Hex(ANCHOR_DIGEST) } }, CAPTURED_AT);
  assert.deepEqual(asText.discrepancies.map((discrepancy) => discrepancy.field), ['memo']);
});

test('F1c-V6: the strict verifier is untouched by partial declarations', async () => {
  const { verifyTransactionEvidence } = await verifierModule;
  const result = verifyTransactionEvidence(
    { transaction: { successful: true, memo: null }, operations: [{ type: 'bump_sequence' }] },
    { operation: 'payment', memo: null, asset: { type: 'native' }, amount: '1.0000000', recipient: 'GRECIPIENT' },
    CAPTURED_AT,
  );
  assert.equal(result.ok, false);
  assert.equal(result.field, 'operation', 'a partial anchor case must never satisfy the strict five-fact check');
});

test('F1c-V7: a declared operation the readback does not contain is a discrepancy', async () => {
  const { verifyDeclaredFacts } = await verifierModule;
  const response = { transaction: { successful: true, memo: null }, operations: [{ type: 'payment', asset_type: 'native', amount: '0.0100000', to: OP_RECIPIENT }] };
  const result = verifyDeclaredFacts(response, { operation: 'invoke_host_function' }, CAPTURED_AT);
  assert.deepEqual(result.discrepancies.map((discrepancy) => discrepancy.field), ['operation']);
  assert.deepEqual(result.matched, []);
});

test('F1c-P1: every published case carries a record, and the undeclared fields are exactly what the record left out', async () => {
  const collector = await collectorModule;
  const file = JSON.parse(await readFile(path.join(REPO_ROOT, 'docs/testnet-evidence.json'), 'utf8'));
  collector.assertExpectationProvenance(file.transactions);

  const roots = new Map((file.summary?.run_record_roots ?? []).map((root) => [root.repository, root]));
  for (const entry of file.transactions) {
    const hasFull = Object.hasOwn(entry, 'expected');
    const hasPartial = Object.hasOwn(entry, 'declared');
    assert.ok(hasFull || hasPartial || entry.expectedFrom === null, `${entry.hash} must say where its facts came from, or that none do`);
    if (!hasPartial) continue;
    const source = entry.expectedFrom;
    assert.ok(roots.has(source.repository) || source.repository === 'vespi-kernel', `${entry.hash} must name a record root that the evidence file lists`);
    const fields = ['operation', 'memo', 'asset', 'amount', 'recipient'].filter((field) => field in entry.declared);
    assert.deepEqual([...source.declared_fields].sort(), fields.sort(), `${entry.hash} must declare exactly the fields it declares`);
    assert.equal(
      source.undeclared_fields.length + source.declared_fields.length,
      5,
      `${entry.hash} must account for all five facts, declared or not`,
    );
    for (const citation of source.citations) {
      assert.ok(typeof citation.contains === 'string' && citation.contains.length > 0, `${entry.hash} needs a fragment to look for`);
      const root = roots.get(citation.repository);
      if (!root) continue;
      const text = await readFile(path.join(root.directory, citation.file), 'utf8');
      const line = text.split(/\r?\n/)[citation.line - 1];
      assert.equal(typeof line, 'string', `${citation.repository}:${citation.file}:${citation.line} must exist`);
      assert.ok(line.includes(citation.contains), `${citation.repository}:${citation.file}:${citation.line} must contain ${JSON.stringify(citation.contains)}`);
    }
  }
});

test('F1c-P2: the published evidence counts every case in exactly one state and none is silently verified', async () => {
  const file = JSON.parse(await readFile(path.join(REPO_ROOT, 'docs/testnet-evidence.json'), 'utf8'));
  const counts = { verified: 0, partial: 0, discrepancy: 0, none: 0 };
  for (const entry of file.transactions) {
    const verification = entry.verification ?? {};
    if (verification.ok === true) counts.verified += 1;
    else if (verification.status === 'discrepancia') counts.discrepancy += 1;
    else if (verification.status === 'partially_verified') counts.partial += 1;
    else counts.none += 1;
    if (verification.ok === true) {
      assert.ok(Object.hasOwn(entry, 'expected'), `${entry.hash} cannot be verified without all five locally declared facts`);
    }
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(total, file.transactions.length);
  assert.ok(counts.none === 0, `every case must be verified, partially verified or carry a reason: ${JSON.stringify(counts)}`);
});
