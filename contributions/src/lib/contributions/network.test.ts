import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { ContributionNetwork } from './network';
import './test-imports.mjs';

const { contributionNetwork }: typeof import('./network') = await import(new URL('network.ts', import.meta.url).href);
const { assignmentMessage }: typeof import('./contribution-assignment') = await import(new URL('contribution-assignment.ts', import.meta.url).href);
const { photoUploadMessage }: typeof import('./photo-authorization') = await import(new URL('photo-authorization.ts', import.meta.url).href);
const { profileMessage }: typeof import('./profile-authorization') = await import(new URL('profile-authorization.ts', import.meta.url).href);
const { reportRequestMessage }: typeof import('./survey-report') = await import(new URL('survey-report.ts', import.meta.url).href);
const { teamSurveyRequestMessage }: typeof import('./team-survey-authorization') = await import(new URL('team-survey-authorization.ts', import.meta.url).href);
const { proposalMessage, decisionMessage, sessionMessage, encounterAnchorMessage }: typeof import('./encounters') =
  await import(new URL('encounters.ts', import.meta.url).href);
const { photoPath, photoUri }: typeof import('./contribution-photos') = await import(new URL('contribution-photos.ts', import.meta.url).href);
const { createEncounterRegistry }: typeof import('./encounter-registry') = await import(new URL('encounter-registry.ts', import.meta.url).href);
const { createProfileRegistry }: typeof import('./profile-registry') = await import(new URL('profile-registry.ts', import.meta.url).href);
const { createReceiptRegistry }: typeof import('./receipt-registry') = await import(new URL('receipt-registry.ts', import.meta.url).href);
const { createSponsorBudget }: typeof import('./sponsor-budget') = await import(new URL('sponsor-budget.ts', import.meta.url).href);
const { createPrivateSurveyStore }: typeof import('./survey-intake') = await import(new URL('survey-intake.ts', import.meta.url).href);

const actor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const digest = 'a'.repeat(64);
const nonce = 'b'.repeat(32);
const createdAt = '2026-11-19T12:00:00Z';
const draft = {
  type: 'charla' as const, title: 'Charla', date: '2026-11-19', where: '', summary: '',
  a: { account: actor, displayName: 'Ana' }, b: null, contributions: [{ from: 'a' as const, text: 'Idea', url: '' }],
};

async function literals(network: ContributionNetwork) {
  const messages = [
    proposalMessage(nonce, draft, network), decisionMessage(nonce, 'sig', 'confirm', '', network),
    sessionMessage(actor, 100, network), encounterAnchorMessage(nonce, 'sig', null, network),
    assignmentMessage(digest, actor, network), photoUploadMessage(actor, digest, 100, network),
    profileMessage(actor, 'Ana', 100, network), reportRequestMessage(createdAt, true, [], network),
    teamSurveyRequestMessage(actor, 'json', 'event', 100, nonce, network),
  ];
  const domains: string[] = messages.map(message => JSON.parse(new TextDecoder().decode(message))[0]);
  const keys: string[] = [];
  const env = {
    CONTRIB_KV_REST_API_URL: 'https://test-redis.invalid', CONTRIB_KV_REST_API_TOKEN: 'test-token',
    CONTRIB_KV_MAINNET_REST_API_URL: 'https://main-redis.invalid', CONTRIB_KV_MAINNET_REST_API_TOKEN: 'main-token',
    CONTRIB_SPONSOR_BUDGET_STROOPS: '1000', CONTRIB_SPONSOR_BUDGET_STROOPS_MAINNET: '2000',
  };
  const command: typeof fetch = async (url, init) => {
    assert.equal(url, network === 'testnet' ? 'https://test-redis.invalid' : 'https://main-redis.invalid');
    assert.equal(new Headers(init?.headers).get('Authorization'), network === 'testnet' ? 'Bearer test-token' : 'Bearer main-token');
    const args = JSON.parse(String(init?.body));
    keys.push(args[args[0] === 'EVAL' ? 3 : 1]);
    const result = args[0] === 'EVAL' ? (args[3].includes(':sponsor-budget:') ? 'reserved' : 1)
      : args[0] === 'SET' ? 'OK' : args[0] === 'HSETNX' ? 1 : null;
    return Response.json({ result });
  };
  const registry = createReceiptRegistry(env, command, network);
  const survey = createPrivateSurveyStore(env, command, network);
  await createEncounterRegistry(env, command, network).get(nonce);
  await createProfileRegistry(env, command, network).get(actor);
  await registry.get(digest);
  await registry.reservePhoto(actor, digest, 20);
  await createSponsorBudget(env, command, network)({ sponsor: actor, hash: digest, txHash: digest, stroops: 200 });
  await survey.get(nonce);
  await survey.consumeTeamAuthorization(actor, nonce);
  await survey.getReport(digest);

  return { ...contributionNetwork(network), domains, keys, blob: photoPath(actor, digest, network), uri: photoUri(digest, network) };
}

test('the testnet signature domains, Redis keys, photos, index network and Stellar endpoints retain their published literals', async () => {
  assert.deepEqual(await literals('testnet'), {
    passphrase: 'Test SDF Network ; September 2015',
    horizon: 'https://horizon-testnet.stellar.org',
    id: 'stellar:testnet',
    segment: 'testnet',
    explorer: 'https://stellar.expert/explorer/testnet',
    domains: [
      'vespi:encuentro:v1:stellar:testnet', 'vespi:encuentro:v1:stellar:testnet', 'vespi:encuentro:v1:stellar:testnet',
      'vespi:encuentro:anchor:v1:stellar:testnet', 'vespi:contribution-assignment:v1:stellar:testnet',
      'vespi:contribution-photo:v1:stellar:testnet', 'vespi:contribution-profile:v1:stellar:testnet',
      'vespi:survey-report:v1:stellar:testnet', 'vespi:contributions-team-survey:v1:stellar:testnet',
    ],
    keys: [
      'contributions:testnet:encounters:v1', 'contributions:testnet:profiles', 'contributions:testnet:receipts',
      'contributions:testnet:photo-quota:2026-11-19', `contributions:testnet:sponsor-budget:${actor}`,
      'contributions:testnet:private-survey:v1', `contributions:testnet:team-auth:v1:${nonce}`, 'contributions:testnet:survey-reports:v1',
    ],
    blob: `contributions/testnet/photos/${actor}/${digest}`,
    uri: `https://vespi.xyz/api/contributions/photos/${digest}`,
  });
});

test('every mainnet literal is distinct from its testnet counterpart', async () => {
  const [mainnet, testnet] = await Promise.all([literals('mainnet'), literals('testnet')]);
  assert.deepEqual(mainnet, {
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizon: 'https://horizon.stellar.org',
    id: 'stellar:pubnet',
    segment: 'mainnet',
    explorer: 'https://stellar.expert/explorer/public',
    domains: testnet.domains.map(domain => domain.replace('stellar:testnet', 'stellar:pubnet')),
    keys: testnet.keys.map(key => key.replace('contributions:testnet:', 'contributions:mainnet:')),
    blob: `contributions/mainnet/photos/${actor}/${digest}`,
    uri: `https://vespi.xyz/api/contributions/photos/${digest}?network=mainnet`,
  });
  for (const domain of mainnet.domains) assert.ok(!testnet.domains.includes(domain));
  for (const key of mainnet.keys) assert.ok(!testnet.keys.includes(key));
  for (const field of ['passphrase', 'horizon', 'id', 'segment', 'explorer', 'blob', 'uri'] as const) {
    assert.notEqual(mainnet[field], testnet[field]);
  }
});
