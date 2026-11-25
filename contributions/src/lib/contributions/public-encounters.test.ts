import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Account, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes, contributionDigest } from './kernel/contributions.js';
import type { StoredEncounter } from './encounter-registry';
import type { EncounterDraft } from './encounters';
import type { ContributionNetwork } from './network';
import './test-imports.mjs';

const { createPublicEncounters }: typeof import('./public-encounters') = await import(new URL('./public-encounters.ts', import.meta.url).href);
const { decisionMessage, encounterAnchorMessage, encounterFingerprintStatement, parseEncounterDraft, proposalMessage }: typeof import('./encounters') =
  await import(new URL('./encounters.ts', import.meta.url).href);
const { contributionNetwork }: typeof import('./network') = await import(new URL('./network.ts', import.meta.url).href);
const { GET }: typeof import('../../app/api/contributions/public/[account]/route') =
  await import(new URL('../../app/api/contributions/public/[account]/route.ts', import.meta.url).href);

const [alice, bob, sponsor] = [21, 22, 23].map(n => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)));
const a = { account: alice.publicKey(), displayName: 'Ana' };
const b = { account: bob.publicKey(), displayName: 'Francisco' };
const id = '2'.repeat(32);
const createdAt = '2026-11-23T12:00:00.000Z';
const legacy: EncounterDraft = {
  type: 'ayuda', title: 'Título interno', date: '2026-11-23', where: 'Santiago', summary: 'Resumen interno', a, b,
  contributions: [{ from: 'a', text: 'Compartí el plano', url: 'https://example.invalid/plano' }],
};
const publicDraft: EncounterDraft = { ...legacy, title: 'Compartí el plano', summary: '', visibility: 'public' };
const legacyDigest = {
  testnet: 'c414fff2d8cb80255ff6587d0b9c2e87da21d9f5a838d893fce484d1d1df31de',
  mainnet: '842c0fa5e2d77e1d9543b54d6a9a4dba0d412d84520a828f31fc1cac6b448329',
};
const env = {
  CONTRIB_KV_REST_API_URL: 'https://test-store.invalid', CONTRIB_KV_REST_API_TOKEN: 'test',
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://main-store.invalid', CONTRIB_KV_MAINNET_REST_API_TOKEN: 'main',
};
const sign = (key: Keypair, bytes: Uint8Array) => key.sign(Buffer.from(bytes)).toString('hex');
function signed(network: ContributionNetwork, draft = publicDraft, choice = 'confirm' as 'confirm' | 'correction' | 'declined',
  person = b, signer = bob, note = choice === 'confirm' ? '' : 'Nota privada de corrección'): StoredEncounter {
  const proposalSignature = sign(alice, proposalMessage(id, draft, network));
  return { id, draft, proposalSignature, createdAt, receiptToken: 'no-publicar-constancia',
    decision: { choice, note, person, signature: sign(signer, decisionMessage(id, proposalSignature, choice, note, network)) } };
}

for (const network of ['testnet', 'mainnet'] as const) {
  test(network + ': fixed historical bytes and signature, followed by the signed visibility', () => {
    const domain = network === 'testnet' ? 'stellar:testnet' : 'stellar:pubnet';
    const before = Buffer.from(JSON.stringify(['vespi:encuentro:v1:' + domain, 'proposal', id, legacy]));
    assert.deepEqual(Buffer.from(proposalMessage(id, legacy, network)), before);
    assert.equal(createHash('sha256').update(proposalMessage(id, legacy, network)).digest('hex'), legacyDigest[network]);
    assert.equal(sign(alice, proposalMessage(id, legacy, network)), sign(alice, before));
    const after = JSON.parse(Buffer.from(proposalMessage(id, publicDraft, network)).toString());
    assert.equal(Object.keys(after[3]).at(-1), 'visibility');
    assert.notEqual(sign(alice, proposalMessage(id, publicDraft, network)), sign(alice, before));
  });

  test(network + ': only a verified confirmation is returned by detail and list', async () => {
    const correct = signed(network);
    let row: StoredEncounter | null = correct;
    let receipt: unknown = null;
    let offline = false;
    let corruptNeighbor = false;
    const service = createPublicEncounters(network, env, async (url, init) => {
      assert.equal(url, network === 'testnet' ? env.CONTRIB_KV_REST_API_URL : env.CONTRIB_KV_MAINNET_REST_API_URL);
      const [command, key, field, ...args] = JSON.parse(String(init?.body));
      assert.match(key, new RegExp('^contributions:' + network + ':'));
      if (offline) return new Response(null, { status: 503 });
      if (command === 'ZRANGEBYLEX') {
        assert.deepEqual([field, ...args], ['[' + a.account + ':', '[' + a.account + ':g', 'LIMIT', 0, 13]);
        return Response.json({ result: [a.account + ':' + id, ...(corruptNeighbor ? [a.account + ':' + '3'.repeat(32)] : [])] });
      }
      if (command === 'HMGET') return Response.json({ result: [row && JSON.stringify(row), ...(corruptNeighbor ? ['{'] : [])] });
      const value = key.endsWith(':receipts') ? receipt : field === 'record:' + id ? row : null;
      return Response.json({ result: value && JSON.stringify(value) });
    });
    const other = network === 'testnet' ? 'mainnet' : 'testnet';
    const legacySigned = signed(network, legacy);
    for (const rejected of [
      legacySigned, { ...legacySigned, draft: publicDraft }, { ...correct, decision: undefined }, signed(network, publicDraft, 'correction'),
      signed(network, publicDraft, 'declined'), { ...correct, draft: { ...publicDraft, type: 'charla' as const, b: null } },
      signed(network, publicDraft, 'confirm', a, alice), signed(other),
      { ...correct, proposalSignature: 'a'.repeat(128) },
      { ...correct, decision: { ...correct.decision!, signature: 'b'.repeat(128) } }, null,
    ]) {
      row = rejected;
      assert.equal(await service.get(id), null);
      assert.deepEqual((await service.list(a.account, '0')).entries, []);
    }
    row = correct;
    assert.equal(await service.get('f'.repeat(32)), null);
    const entry = await service.get(id);
    assert.ok(entry);
    assert.equal(entry.anchor, null);
    assert.deepEqual((await service.list(a.account, '0')).entries, [entry]);
    assert.deepEqual(Object.keys(entry).sort(), [
      'a', 'anchor', 'b', 'commitment', 'contributions', 'date', 'decisionSignature', 'id', 'proposalSignature', 'where',
    ]);
    const messages = (await service.get(id, true))?.messages;
    assert.deepEqual(messages, {
      proposal: Buffer.from(proposalMessage(id, publicDraft, network)).toString(),
      confirmation: Buffer.from(decisionMessage(id, correct.proposalSignature, 'confirm', '', network)).toString(),
    });
    corruptNeighbor = true;
    assert.deepEqual((await service.list(a.account, '0')).entries, [entry]);
    corruptNeighbor = false;

    row = signed(network, { ...legacy, visibility: 'public' }, 'confirm', b, bob, 'Nota privada confirmada');
    const vintage = await service.get(id, true);
    assert.deepEqual(vintage?.messages, { proposal: null, confirmation: null });
    const record = JSON.stringify(vintage);
    for (const secret of ['Título interno', 'Resumen interno', 'no-publicar-constancia', 'inviteUrl', 'inviteMode', 'Nota privada']) {
      assert.ok(!record.includes(secret));
    }

    row = signed(network, { ...publicDraft, b: { account: '', displayName: 'Nombre escrito por Ana' }, inviteMode: 'link' });
    const linked = await service.get(id, true);
    assert.deepEqual(linked?.b, b);
    assert.equal(linked?.messages?.proposal, null);
    assert.ok(linked?.messages?.confirmation);
    assert.doesNotMatch(JSON.stringify(linked), /Nombre escrito por Ana|inviteMode/);
    row = signed(network, { ...publicDraft, revisionOf: '4'.repeat(32) });
    assert.deepEqual((await service.get(id, true))?.messages, { proposal: null,
      confirmation: Buffer.from(decisionMessage(id, row.proposalSignature, 'confirm', '', network)).toString() });
    const commitment = createHash('sha256').update(encounterAnchorMessage(id, correct.proposalSignature, correct.decision!.signature, network)).digest('hex');
    function anchor(actor: Keypair, hash: string, receiptNetwork = network) {
      const fields = { kind: 'REQUEST', role: 'requester', actor: actor.publicKey(), chain: null, prev: null, subject: null,
        statement: encounterFingerprintStatement, comment: 'vespi:encuentro:' + hash, createdAt, evidence: null };
      const digest = contributionDigest(fields);
      const { passphrase, id: networkId } = contributionNetwork(receiptNetwork);
      const tx = new TransactionBuilder(new Account(actor.publicKey(), '0'), { fee: BASE_FEE, networkPassphrase: passphrase })
        .addMemo(Memo.hash(digest)).addOperation(Operation.bumpSequence({ bumpTo: '2' })).setTimeout(30).build();
      tx.sign(actor);
      const envelope = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, tx, passphrase);
      envelope.sign(sponsor);
      const txHash = envelope.hash().toString('hex');
      row = { ...correct, anchor: digest };
      receipt = { intent: { bytes: canonicalBytes(fields), digest },
        index: { digest, network: networkId, txHash, ledger: 42, envelopeXdr: envelope.toXDR(), rehearsal: false } };
      return { digest, txHash };
    }
    anchor(alice, commitment);
    assert.equal((await service.get(id))?.anchor, null);
    anchor(bob, 'f'.repeat(64));
    assert.equal((await service.get(id))?.anchor, null);
    anchor(bob, commitment, other);
    assert.equal((await service.get(id))?.anchor, null);
    const proof = anchor(bob, commitment);
    assert.deepEqual((await service.get(id))?.anchor, proof);
    offline = true;
    await assert.rejects(service.get(id), /Encounter request failed/);
  });
}

test('only two-person help can be proposed as public', () => {
  for (const fields of [{ type: 'charla', b: null }, { type: 'reunion' }, { role: 'asistente' }, { b: { ...b, account: '' } }]) {
    assert.throws(() => parseEncounterDraft({ ...publicDraft, ...fields }));
  }
});

test('public list validates account, limits requests by IP and reads mainnet without session or sponsor settings', async t => {
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  let offline = false;
  const redis = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, env.CONTRIB_KV_MAINNET_REST_API_URL);
    return offline ? new Response(null, { status: 500 }) : Response.json({ result: [] });
  });
  const read = (account: string, ip = 'fixture-public', query = 'network=mainnet') => GET(new Request(
    'https://app.invalid/api/contributions/public/' + account + '?' + query, { headers: { 'x-forwarded-for': ip } }),
  { params: Promise.resolve({ account }) });
  assert.equal((await read('invalid')).status, 400);
  assert.equal((await read(a.account, 'fixture-cursor', 'cursor=1')).status, 400);
  assert.equal(redis.mock.callCount(), 0);
  assert.deepEqual(await (await read(a.account)).json(), { ok: true, cursor: '0', entries: [] });
  offline = true;
  assert.equal((await read(a.account)).status, 503);
  for (let i = 0; i < 117; i++) assert.equal((await read(a.account)).status, 503);
  const limited = await read(a.account);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('Retry-After'));
});
