import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk/base';
const { registerHooks } = await import('node:module' as string);
type Context = { parentURL?: string };
type Resolve = (specifier: string, context: Context) => { url: string };
registerHooks({ resolve(specifier: string, context: Context, next: Resolve) {
  if (specifier.startsWith('./') && context.parentURL?.startsWith(new URL('./', import.meta.url).href) && !/\.[cm]?[jt]s$/.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
  return next(specifier, context);
} });
const { createTeamSurveyQuery, teamSurveyRequestMessage, surveyCsv }: typeof import('./team-survey') = await import(new URL('./team-survey.ts', import.meta.url).href);
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const account = signer.publicKey();
const nonce = 'ab'.repeat(16);
const answer = { usefulness: 4, building: true, project: '=cmd|calc', ambassadorInterest: false, nextTopic: 'Next', email: 'person@example.test' };
const rows = [
 { actor: account, answer, salt: 'cd'.repeat(16), commitment: 'a'.repeat(64), createdAt: '2026-11-19T18:00:00.000Z', rehearsal: true },
 { actor: null, answer: { ...answer, project: 'event' }, salt: 'ef'.repeat(16), commitment: 'b'.repeat(64), createdAt: '2026-11-19T19:00:00.000Z', rehearsal: false },
];
const request = (action: 'json' | 'csv' = 'json', cohort: 'rehearsal' | 'event' = 'rehearsal', expiresAt = 150) => ({
 account, action, cohort, expiresAt, nonce,
 signature: signer.sign(Buffer.from(teamSurveyRequestMessage(account, action, cohort, expiresAt, nonce))).toString('hex'),
});

test('team query requires allowlisted signature, limits reads to the signed cohort and omits private support fields', async () => {
 let consumed = 0, read = 0;
 const query = createTeamSurveyQuery({ teamAccounts: [account], consumeNonce: async () => { consumed++; return true; }, list: async () => { read++; return rows; } }, () => 100_000);
 assert.equal((await query({ ...request(), action: 'csv' })).reason, 'team-auth-required');
 assert.equal((await query(request('json', 'event', 161))).reason, 'team-auth-required');
 const result = await query(request());
 assert.ok(result.ok);
 if (result.ok) {
   assert.equal(result.records.length, 1);
   assert.deepEqual(result.records[0], { createdAt: rows[0].createdAt, answer });
   assert.equal('salt' in result.records[0], false);
 }
 assert.equal(consumed, 1); assert.equal(read, 1);
});

test('team authorization is one-use and expires after nonce consumption', async () => {
 let time = 100_000;
 const query = createTeamSurveyQuery({ teamAccounts: [account], consumeNonce: async () => { time = 151_000; return true; }, list: async () => { throw new Error('must not read'); } }, () => time);
 assert.equal((await query(request())).reason, 'team-auth-expired');
 const replay = createTeamSurveyQuery({ teamAccounts: [account], consumeNonce: async () => false, list: async () => [] }, () => 100_000);
 assert.equal((await replay(request())).reason, 'team-auth-replayed');
});

test('CSV quotes cells and escapes formula prefixes', () => {
 const csv = surveyCsv([{ createdAt: '2026-11-19T18:00:00.000Z', answer }]);
 assert.match(csv, /"'=cmd\|calc"/);
 assert.match(csv, /"person@example\.test"/);
 assert.match(csv, /\r\n/);
});
