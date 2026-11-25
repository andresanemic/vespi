import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';

import './test-imports.mjs';

const { decisionMessage, encounterAccess, parseEncounterDraft, proposalMessage }: typeof import('./encounters') =
  await import(new URL('./encounters.ts', import.meta.url).href);

const creator = Keypair.random();
const guest = Keypair.random();
const id = '2'.repeat(32);
const draft = {
  type: 'reunion' as const, title: 'Intercambio de referencias', date: '2026-11-18', where: '', summary: '',
  a: { account: creator.publicKey(), displayName: 'Persona A' }, b: { account: '', displayName: 'Persona B' },
  contributions: [{ from: 'a' as const, text: 'Compartió una referencia', url: '' },
    { from: 'b' as const, text: 'Presentó a otra persona', url: 'https://example.com/' }],
};

test('legacy encounter signatures still parse with a name-only recipient and contributions in both directions', () => {
  const clean = parseEncounterDraft(draft);
  assert.equal(clean.contributions.length, 2);
  assert.equal(clean.b?.account, '');
  assert.throws(() => parseEncounterDraft({ ...draft, b: null }));
  assert.throws(() => parseEncounterDraft({ ...draft, b: draft.a }));
  assert.throws(() => parseEncounterDraft({ ...draft, date: '2026-02-30' }));
  assert.throws(() => parseEncounterDraft({ ...draft, contributions: [{ ...draft.contributions[0], url: 'javascript:alert(1)' }] }));
});

test('directed encounters stay private, including after signing, and legacy confirmed links still work', () => {
  const directed = { ...draft, b: { ...draft.b, account: guest.publicKey() } };
  const stranger = Keypair.random().publicKey();
  assert.equal(encounterAccess(directed, false, null), 'sign-in');
  assert.equal(encounterAccess(directed, false, stranger), 'wrong-account');
  assert.equal(encounterAccess(directed, true, stranger), 'wrong-account');
  assert.equal(encounterAccess(directed, false, creator.publicKey()), 'allowed');
  assert.equal(encounterAccess(directed, false, guest.publicKey()), 'allowed');
  assert.equal(encounterAccess(draft, false, stranger), 'wrong-account');
  assert.equal(encounterAccess(draft, true, null), 'allowed');
  assert.equal(encounterAccess(draft, true, null, undefined, 'mainnet'), 'sign-in');
  const personal = { ...draft, b: null };
  for (const network of ['testnet', 'mainnet'] as const) {
    for (const reviewed of [false, true]) {
      assert.equal(encounterAccess(personal, reviewed, null, undefined, network), 'sign-in');
      assert.equal(encounterAccess(personal, reviewed, stranger, undefined, network), 'wrong-account');
      assert.equal(encounterAccess(personal, reviewed, creator.publicKey(), undefined, network), 'allowed');
    }
  }
});

test('both signatures bind their exact proposal, version and response', () => {
  const root = Buffer.from(proposalMessage(id, draft));
  const signedProposal = creator.sign(root);
  const proof = signedProposal.toString('hex');
  const signedConfirmation = guest.sign(Buffer.from(decisionMessage(id, proof, 'confirm', '')));
  assert.ok(creator.verify(root, signedProposal));
  assert.ok(guest.verify(Buffer.from(decisionMessage(id, proof, 'confirm', '')), signedConfirmation));
  assert.equal(creator.verify(Buffer.from(proposalMessage(id, { ...draft, title: 'Título editado' })), signedProposal), false);
  assert.equal(creator.verify(Buffer.from(proposalMessage(id, { ...draft, revisionOf: '1'.repeat(32) })), signedProposal), false);
  assert.equal(guest.verify(Buffer.from(decisionMessage(id, proof, 'declined', '')), signedConfirmation), false);
  assert.equal(guest.verify(Buffer.from(decisionMessage('3'.repeat(32), proof, 'confirm', '')), signedConfirmation), false);
});

test('a no-account link requires possession and closes after the first signed response', () => {
  const linked = parseEncounterDraft({ ...draft, inviteMode: 'link' });
  const stranger = Keypair.random().publicKey();
  const unclaimed = { valid: true };
  const claimed = { valid: true, respondent: guest.publicKey() };
  assert.equal(encounterAccess(linked, false, guest.publicKey()), 'wrong-account');
  assert.equal(encounterAccess(linked, false, null, unclaimed), 'claim-sign-in');
  assert.equal(encounterAccess(linked, false, guest.publicKey(), unclaimed), 'allowed');
  assert.equal(encounterAccess(linked, true, stranger, claimed), 'wrong-account');
  assert.equal(encounterAccess(linked, true, guest.publicKey(), { ...claimed, valid: false }), 'allowed');
  assert.throws(() => parseEncounterDraft({ ...linked, b: { ...draft.b, account: guest.publicKey() } }));
  assert.notDeepEqual(proposalMessage(id, draft), proposalMessage(id, linked));
});
