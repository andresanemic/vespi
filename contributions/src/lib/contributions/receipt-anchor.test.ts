import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Account, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes } from './kernel/contributions.js';
import type { RegisteredReceipt, Registry } from './receipt-registry';

const { registerHooks } = await import('node:module' as string);
type Context = { parentURL?: string };
type Resolve = (specifier: string, context: Context) => { url: string };
const dir = new URL('./', import.meta.url).href;
registerHooks({ resolve(specifier: string, context: Context, next: Resolve) {
  if (specifier.startsWith('./') && context.parentURL?.startsWith(dir)) {
    const ts = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(ts)) return next(ts.href, context);
  }
  return next(specifier, context);
} });
const { createReceiptAnchor }: typeof import('./receipt-anchor') =
  await import(new URL('./receipt-anchor.ts', import.meta.url).href);
const { assignmentMessage }: typeof import('./contribution-assignment') =
  await import(new URL('./contribution-assignment.ts', import.meta.url).href);
const { yerkoSlidesReference }: typeof import('./yerko-event') =
  await import(new URL('./yerko-event.ts', import.meta.url).href);
const sponsor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 10));
const requester = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));
const contributor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13));
const start = Date.parse('2026-11-17T03:00:00.000Z');

function signedReceipt(fields: Record<string, unknown> = {}, signer = requester, memo?: string, source = signer,
  expiry = start / 1000 + 60) {
  const bytes = canonicalBytes({
    kind: 'REQUEST', role: 'requester', actor: source.publicKey(), statement: 'Request review', comment: null,
    chain: null, prev: null, subject: null, evidence: null, createdAt: new Date(start).toISOString(), ...fields,
  });
  const digest = createHash('sha256').update(bytes).digest('hex');
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), {
    fee: '150', networkPassphrase: Networks.TESTNET, timebounds: { minTime: 0, maxTime: expiry },
  }).addMemo(Memo.hash(memo ?? digest)).addOperation(Operation.bumpSequence({ bumpTo: '105' })).build();
  tx.sign(signer);
  const assignment = fields.kind === 'CONTRIBUTE' && typeof fields.chain === 'string'
    ? requester.sign(Buffer.from(assignmentMessage(fields.chain, source.publicKey()))).toString('hex') : undefined;
  return { bytes, xdr: tx.toXDR(), digest, assignment };
}

function fixture() {
  const records = new Map<string, RegisteredReceipt>();
  const heads = new Map<string, string>();
  const locks = new Map<string, string>();
  const observations = new Map<string, { successful: boolean; ledger: number; envelopeXdr: string; closedAt: string }>();
  const submitted: string[] = [];
  let now = start;
  let indexedTime = start / 1000;
  const registry: Registry = {
    async get(digest) { return records.get(digest) ?? null; },
    async pending(chain) { return records.get(locks.get(chain) ?? '') ?? null; },
    async reserve(intent) {
      if (records.has(intent.digest)) return 'exists';
      if (intent.chain) {
        if ((heads.get(intent.chain) ?? null) !== intent.prev || locks.has(intent.chain)) return 'conflict';
        locks.set(intent.chain, intent.digest);
      }
      records.set(intent.digest, { intent });
      return 'reserved';
    },
    async confirm(intent, index) {
      records.set(intent.digest, { intent, index });
      if (intent.chain) {
        heads.set(intent.chain, intent.digest);
        locks.delete(intent.chain);
      }
      return true;
    },
    async release(intent) {
      records.delete(intent.digest);
      if (intent.chain) locks.delete(intent.chain);
      return true;
    },
  };
  const ports: Parameters<typeof createReceiptAnchor>[0] = {
    registry, now: () => new Date(now), sponsor: () => sponsor,
    async send(xdr) {
      const inner = new Transaction(xdr, Networks.TESTNET);
      const outer = TransactionBuilder.buildFeeBumpTransaction(sponsor, inner.fee, inner, Networks.TESTNET);
      outer.sign(sponsor);
      const hash = outer.hash().toString('hex');
      submitted.push(hash);
      observations.set(hash, { successful: true, ledger: 100, envelopeXdr: outer.toXDR(), closedAt: new Date(start).toISOString() });
      return { ok: true };
    },
    async lookup(hash) { return observations.get(hash) ?? null; },
    async latestLedgerTime() { return indexedTime; },
    async getSurvey() { return null; },
    async getReport() { return null; },
  };
  return {
    ports, records, submitted, observations, run: createReceiptAnchor(ports),
    advance(time: number, ledger: number) { now = time; indexedTime = ledger; },
  };
}

test('the configured speaker alone can deliver the talk, and two attendees can attest to it', async () => {
  const f = fixture();
  const root = signedReceipt();
  assert.ok((await f.run(root)).ok);
  f.ports.yerko = { root: root.digest, account: contributor.publicKey(), closed: false };
  const delivery = { kind: 'CONTRIBUTE', role: 'contributor', chain: root.digest, prev: root.digest };
  assert.deepEqual(await f.run(signedReceipt(delivery, other)), { ok: false, reason: 'speaker-required' });
  assert.deepEqual(await f.run(signedReceipt(delivery, contributor)), { ok: false, reason: 'slides-required' });
  const signed = signedReceipt({ ...delivery, comment: yerkoSlidesReference }, contributor);
  assert.ok((await f.run(signed)).ok);
  const testimony = { kind: 'ATTEST', role: 'observer', chain: root.digest, subject: signed.digest };
  const one = signedReceipt(testimony, other);
  const two = signedReceipt(testimony, Keypair.random());
  assert.notEqual(one.digest, two.digest);
  assert.ok((await f.run(one)).ok);
  assert.ok((await f.run(two)).ok);
  f.ports.yerko.closed = true;
  assert.deepEqual(await f.run(signedReceipt(testimony, Keypair.random())), { ok: false, reason: 'event-closed' });
  assert.ok((await f.run(one)).ok);
});

test('altered bytes, memo or signature stop before reservation or submission', async () => {
  const f = fixture();
  const correct = signedReceipt();
  assert.deepEqual(await f.run({ ...correct, bytes: correct.bytes.replace('Request review', 'Other thing') }),
    { ok: false, reason: 'commitment-mismatch' });
  assert.deepEqual(await f.run(signedReceipt({}, requester, 'c'.repeat(64))),
    { ok: false, reason: 'commitment-mismatch' });
  assert.deepEqual(await f.run(signedReceipt({}, other, undefined, requester)),
    { ok: false, reason: 'commitment-mismatch' });
  assert.equal(f.records.size, 0);
  assert.equal(f.submitted.length, 0);
});

test('a duplicate and a retry after a failed index write never submit an anchor again', async () => {
  const f = fixture();
  const original = f.ports.registry.confirm;
  let writes = 0;
  f.ports.registry.confirm = async (...args) => {
    if (++writes === 1) throw new Error('connection interrupted');
    return original(...args);
  };
  const receipt = signedReceipt();
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'anchor-unavailable' });
  assert.equal(f.records.get(receipt.digest)?.index, undefined);
  const result = await f.run(receipt);
  assert.ok(result.ok);
  assert.equal(result.index.digest, receipt.digest);
  assert.equal(result.index.txHash, f.submitted[0]);
  assert.equal(result.index.rehearsal, true);
  assert.deepEqual(await f.run(receipt), result);
  assert.equal(f.submitted.length, 1);
});

test('competing children cannot fork a contribution and a witness must be independent', async () => {
  const f = fixture();
  const root = signedReceipt();
  assert.ok((await f.run(root)).ok);
  const fields = { kind: 'CONTRIBUTE', role: 'contributor', chain: root.digest, prev: root.digest };
  const a = signedReceipt(fields, contributor);
  const b = signedReceipt({ ...fields, statement: 'Another contribution' }, other);
  const results = await Promise.all([f.run(a), f.run(b)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.deepEqual(results.find(result => !result.ok), { ok: false, reason: 'chain-conflict' });
  const committed = results[0].ok ? a : b;
  const witness = { kind: 'ATTEST', role: 'observer', chain: root.digest, subject: committed.digest };
  assert.deepEqual(await f.run(signedReceipt(witness)), { ok: false, reason: 'invalid-chain-link' });
  assert.ok((await f.run(signedReceipt(witness, results[0].ok ? other : contributor))).ok);
  const secondObserver = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 14));
  assert.ok((await f.run(signedReceipt(witness, secondObserver))).ok);
});

test('an unknown submission is retained until Horizon passes the bound and still misses the hash', async () => {
  const f = fixture();
  const receipt = signedReceipt();
  let sends = 0;
  f.ports.send = async () => { sends++; return { ok: false, reason: 'horizon-error' }; };
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'anchor-pending' });
  assert.equal(f.records.size, 1);
  f.advance(start + 61_000, start / 1000 + 59);
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'anchor-pending' });
  f.advance(start + 62_000, start / 1000 + 61);
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'retry-with-fresh-transaction' });
  assert.equal(f.records.size, 0);
  assert.equal(sends, 1);
});

test('an observed hash whose envelope differs is never indexed', async () => {
  const f = fixture();
  const send = f.ports.send;
  f.ports.send = async (xdr, actor) => {
    const response = await send(xdr, actor);
    const hash = f.submitted[0];
    const observation = f.observations.get(hash);
    assert.ok(observation);
    observation.envelopeXdr = signedReceipt({ statement: 'wrong envelope' }).xdr;
    return response;
  };
  const receipt = signedReceipt();
  assert.equal((await f.run(receipt)).ok, false);
  assert.equal(f.records.get(receipt.digest)?.index, undefined);
});

test('a different child can recover a lock left by an expired unknown submission', async () => {
  const f = fixture();
  const root = signedReceipt();
  assert.ok((await f.run(root)).ok);
  const fields = { kind: 'CONTRIBUTE', role: 'contributor', chain: root.digest, prev: root.digest };
  const abandoned = signedReceipt(fields, contributor);
  const send = f.ports.send;
  f.ports.send = async () => ({ ok: false, reason: 'horizon-error' });
  assert.deepEqual(await f.run(abandoned), { ok: false, reason: 'anchor-pending' });
  f.advance(start + 62_000, start / 1000 + 61);
  f.ports.send = send;
  const next = signedReceipt({ ...fields, statement: 'Replacement' }, other, undefined, other, start / 1000 + 120);
  assert.ok((await f.run(next)).ok);
  assert.equal(f.records.has(abandoned.digest), false);
  assert.equal(f.submitted.length, 2);
});

test('attachments wait for their verification port before the first reservation', async () => {
  const f = fixture();
  const receipt = signedReceipt({ evidence: { uri: 'https://example.test/photo', sha256: 'a'.repeat(64) } });
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'evidence-unavailable' });
  assert.equal(f.records.size, 0);
  assert.equal(f.submitted.length, 0);
});

test('a definitive pre-submission refusal releases its chain slot immediately', async () => {
  const f = fixture();
  const receipt = signedReceipt();
  f.ports.send = async () => ({ ok: false, reason: 'budget-exhausted' });
  f.ports.lookup = async () => assert.fail('a pre-submission rejection needs no ledger lookup');
  assert.deepEqual(await f.run(receipt), { ok: false, reason: 'budget-exhausted' });
  assert.equal(f.records.size, 0);
});

test('a public request only accepts its first contribution with a matching requester assignment', async () => {
  const f = fixture();
  const root = signedReceipt();
  assert.ok((await f.run(root)).ok);
  const fields = { kind: 'CONTRIBUTE', role: 'contributor', chain: root.digest, prev: root.digest };
  const allowed = signedReceipt(fields, contributor);
  const wrong = signedReceipt(fields, other);
  assert.deepEqual(await f.run({ ...allowed, assignment: undefined }), { ok: false, reason: 'invalid-chain-link' });
  assert.deepEqual(await f.run({ ...wrong, assignment: allowed.assignment }), { ok: false, reason: 'invalid-chain-link' });
  assert.ok((await f.run(allowed)).ok);
  assert.equal(f.submitted.length, 2);
});

test('an anchored survey requires the stored commitment and actor and publishes only the fixed receipt', async () => {
  const f = fixture();
  const surveyId = 'abca0615-00d0-414c-aa12-68ac34535888';
  const commitment = 'a'.repeat(64);
  let storedCommitment = commitment;
  f.ports.cutoff = new Date(start - 1).toISOString();
  f.ports.getSurvey = async id => {
    assert.equal(id, surveyId);
    return {
      actor: contributor.publicKey(), commitment: storedCommitment, salt: 'c'.repeat(32),
      answer: { usefulness: 4, building: false, project: '', ambassadorInterest: false, nextTopic: '',
        email: 'private@example.test' },
      rehearsal: true, createdAt: new Date(start).toISOString(),
    };
  };
  const fields = { kind: 'SURVEY', role: 'respondent', statement: 'Respondí la encuesta', evidence: { commitment } };
  const signed = signedReceipt(fields, contributor);
  assert.deepEqual(await f.run({ ...signed, surveyId: undefined }), { ok: false, reason: 'invalid-survey-receipt' });
  assert.deepEqual(await f.run({ ...signedReceipt(fields, other), surveyId }), { ok: false, reason: 'invalid-survey-receipt' });
  assert.deepEqual(await f.run({ ...signedReceipt({ ...fields, comment: 'private@example.test' }, contributor), surveyId }),
    { ok: false, reason: 'invalid-survey-receipt' });
  const anchored = await f.run({ ...signed, surveyId });
  assert.ok(anchored.ok);
  assert.equal(anchored.index.rehearsal, true);
  const publicBytes = f.records.get(signed.digest)?.intent.bytes;
  assert.ok(publicBytes);
  assert.equal(publicBytes.includes('private@example.test'), false);
  assert.equal(publicBytes.includes('c'.repeat(32)), false);
  storedCommitment = 'e'.repeat(64);
  const repeat = signedReceipt({ ...fields, evidence: { commitment: storedCommitment } }, contributor);
  assert.deepEqual(await f.run({ ...repeat, surveyId }), { ok: false, reason: 'chain-conflict' });
  assert.equal(f.submitted.length, 1);
});

test('event survey signing stays open until the organizer sets a closing time', async () => {
  const f = fixture();
  const surveyId = 'abca0615-00d0-414c-aa12-68ac34535888';
  const commitment = 'a'.repeat(64);
  f.ports.getSurvey = async () => ({
    actor: contributor.publicKey(), commitment, salt: 'c'.repeat(32), rehearsal: false,
    answer: { usefulness: 4, building: false, project: '', ambassadorInterest: false, nextTopic: '', email: null },
    createdAt: new Date(start - 1).toISOString(),
  });
  const fields = { kind: 'SURVEY', role: 'respondent', statement: 'Respondí la encuesta', evidence: { commitment } };
  const signed = signedReceipt(fields, contributor);
  f.ports.surveyClosesAt = new Date(start - 360_000).toISOString();
  assert.deepEqual(await f.run({ ...signed, surveyId }), { ok: false, reason: 'survey-closed' });
  f.ports.surveyClosesAt = 'manual';
  const anchored = await f.run({ ...signed, surveyId });
  assert.ok(anchored.ok);
  assert.equal(anchored.index.rehearsal, false);
});

test('REPORT uses the confirmed answers and fallback totals, and only the organizer can anchor its snapshot', async () => {
  const { createSurveyReport, reportRequestMessage, surveySlot }: typeof import('./survey-report') =
    await import(new URL('./survey-report.ts', import.meta.url).href);
  const { parseContribution } = await import(new URL('./kernel/contributions.js', import.meta.url).href);
  const f = fixture();
  f.ports.organizer = requester.publicKey();
  const actor = contributor.publicKey();
  const raw = { usefulness: 5, building: true, project: 'private project', ambassadorInterest: false,
    nextTopic: 'private topic', email: 'private@example.test' };
  const confirmed = { actor, answer: raw, salt: 'a'.repeat(32), commitment: '1'.repeat(64),
    createdAt: new Date(start).toISOString(), rehearsal: true };
  const unsigned = { ...confirmed, actor: null, commitment: '2'.repeat(64), answer: { ...raw, usefulness: 3 } };
  const pending = { ...confirmed, commitment: '3'.repeat(64) };
  const proof = signedReceipt({ kind: 'SURVEY', role: 'respondent', statement: 'Respondí la encuesta',
    evidence: { commitment: confirmed.commitment } }, contributor);
  f.ports.getSurvey = async () => confirmed;
  assert.ok((await f.run({ ...proof, surveyId: 'abca0615-00d0-414c-aa12-68ac34535888' })).ok);

  let saved: { digest: string; bytes: string; rehearsal: boolean } | undefined;
  const fallback = [{ answer: { ...raw, usefulness: 1, building: false, ambassadorInterest: true }, salt: 'b'.repeat(32) }];
  const request = { createdAt: new Date(start).toISOString(), rehearsal: true, fallback };
  const message = Buffer.from(reportRequestMessage(request.createdAt, request.rehearsal, fallback));
  const generate = createSurveyReport({
    organizer: requester.publicKey(), now: () => new Date(start),
    list: async () => [pending, confirmed, unsigned, { ...unsigned, rehearsal: false }],
    settle: async () => true,
    head: async slot => {
      assert.equal(slot, surveySlot(actor, true));
      return f.records.get(proof.digest) ?? null;
    },
    async save(digest, snapshot) { saved = { digest, ...snapshot }; },
  });
  assert.deepEqual(await generate({ ...request, signature: other.sign(message).toString('hex') }),
    { ok: false, reason: 'organizer-required' });
  assert.equal(saved, undefined);
  const generated = await generate({ ...request, signature: requester.sign(message).toString('hex') });
  assert.ok(generated.ok);
  const receipt = parseContribution(generated.bytes);
  assert.deepEqual({ ...receipt.evidence.counts }, { withAccount: 1, withoutAccount: 1, fallbackForm: 1 });
  assert.deepEqual({ ...receipt.evidence.aggregate },
    { averageUsefulness: 3, building: 2, ambassadorInterest: 1, rehearsal: true });
  assert.deepEqual([...receipt.evidence.surveys], [proof.digest]);
  assert.equal(generated.bytes.includes('private'), false);
  assert.equal(generated.bytes.includes('b'.repeat(32)), false);

  const fields = { kind: 'REPORT', role: 'organizer', statement: receipt.statement, evidence: receipt.evidence };
  assert.deepEqual(await f.run(signedReceipt(fields, other)), { ok: false, reason: 'organizer-required' });
  const signed = signedReceipt(fields);
  assert.deepEqual(await f.run(signed), { ok: false, reason: 'invalid-report-snapshot' });
  f.ports.getReport = async digest => saved?.digest === digest ? saved : null;
  const result = await f.run(signed);
  assert.ok(result.ok);
  assert.equal(result.index.rehearsal, true);
  assert.equal(f.submitted.length, 2);
});

test('official REPORT waits for closure and pending confirmations, and withholds metrics for a small cohort', async () => {
  const { createSurveyReport, reportRequestMessage }: typeof import('./survey-report') =
    await import(new URL('./survey-report.ts', import.meta.url).href);
  const { parseContribution } = await import(new URL('./kernel/contributions.js', import.meta.url).href);
  const cutoff = new Date(start - 1000).toISOString();
  const closesAt = new Date(start + 60_000).toISOString();
  let now = start;
  let settled = false;
  const record = {
    actor: null, salt: 'a'.repeat(32), commitment: '1'.repeat(64), createdAt: cutoff, rehearsal: false,
    answer: { usefulness: 5, building: true, project: '', ambassadorInterest: true, nextTopic: '', email: null },
  };
  const generate = createSurveyReport({
    organizer: requester.publicKey(), now: () => new Date(now), cutoff, closesAt,
    list: async () => [record, { ...record, actor: contributor.publicKey(), commitment: '2'.repeat(64) }],
    head: async () => null, settle: async () => settled, save: async () => {},
  });
  function run() {
    const createdAt = new Date(now).toISOString();
    const signature = requester.sign(Buffer.from(reportRequestMessage(createdAt, false, []))).toString('hex');
    return generate({ rehearsal: false, createdAt, fallback: [], signature });
  }
  assert.deepEqual(await run(), { ok: false, reason: 'invalid-report-time' });
  now = start + 360_000;
  assert.deepEqual(await run(), { ok: false, reason: 'survey-anchors-pending' });
  settled = true;
  const report = await run();
  assert.ok(report.ok);
  assert.deepEqual({ ...parseContribution(report.bytes).evidence.aggregate }, { rehearsal: false, metricsWithheld: true });
});

test('anchoring checks the signed photo reference and stores a publication pointer only on confirmation', async () => {
  const f = fixture();
  const digest = 'a'.repeat(64);
  const evidence = { uri: `https://vespi.xyz/api/contributions/photos/${digest}`, sha256: digest };
  f.ports.photoExists = async (actor, sha256) => actor === requester.publicKey() && sha256 === digest;
  assert.deepEqual(await f.run(signedReceipt({ evidence }, other)), { ok: false, reason: 'evidence-unavailable' });
  assert.deepEqual(await f.run(signedReceipt({ evidence: { ...evidence, uri: 'https://example.test/photo' } })),
    { ok: false, reason: 'evidence-unavailable' });
  const photoReceipt = signedReceipt({ evidence });
  assert.ok((await f.run(photoReceipt)).ok);
  assert.equal(f.records.get(photoReceipt.digest)?.intent.photo, digest);
  assert.ok(f.records.get(photoReceipt.digest)?.index);
  assert.equal(f.submitted.length, 1);
});

test('account activity recovers prior signatures and the current step only for the requested account', async () => {
  const { createReceiptRegistry }: typeof import('./receipt-registry') =
    await import(new URL('./receipt-registry.ts', import.meta.url).href);
  const request = signedReceipt();
  const delivery = signedReceipt({ kind: 'CONTRIBUTE', role: 'contributor', chain: request.digest, prev: request.digest,
    statement: 'Shared a design reference' }, contributor);
  const wrap = (row: typeof request, confirmed = true) => JSON.stringify({
    intent: { digest: row.digest, bytes: row.bytes },
    index: confirmed ? { version: 1, digest: row.digest, network: 'stellar:testnet', txHash: row.digest,
      ledger: 100, envelopeXdr: row.xdr, rehearsal: true } : undefined,
  });
  const records: Record<string, string> = {
    ['receipt:' + request.digest]: wrap(request), ['receipt:' + delivery.digest]: wrap(delivery),
    ['head:' + request.digest]: delivery.digest,
  };
  const requestStore: typeof fetch = async (_input, init) => {
    const [operation, , field] = JSON.parse(String(init?.body));
    return Response.json({ result: operation === 'HSCAN'
      ? ['0', Object.entries(records).filter(([key]) => key.startsWith('receipt:')).flat()]
      : records[field] ?? null });
  };
  const registry = createReceiptRegistry({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 'fake' }, requestStore);
  const owner = await registry.activity(requester.publicKey(), '0');
  assert.deepEqual(owner.entries.map(row => [row.digest, row.state, row.head]), [[request.digest, 'CONTRIBUTE', delivery.digest]]);
  const author = await registry.activity(contributor.publicKey(), '0');
  assert.equal(author.entries[0]?.statement, 'Shared a design reference');
  assert.equal(author.entries[0]?.context, 'Request review');
  assert.equal((await registry.activity(other.publicKey(), '0')).entries.length, 0);
});
