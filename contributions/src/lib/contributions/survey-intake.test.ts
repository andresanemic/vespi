import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surveyCommitment } from './kernel/contributions.js';
import type { SurveyRecord } from './survey-intake';

import './test-imports.mjs';

const { createSurveyIntake, createPrivateSurveyStore, surveySigningDeadline }: typeof import('./survey-intake') =
  await import(new URL('./survey-intake.ts', import.meta.url).href);

const body = {
  id: 'abca0615-00d0-414c-aa12-68ac34535888', actor: null,
  answer: { usefulness: 4, building: true, project: 'Demo', ambassadorInterest: false,
    nextTopic: 'Wallets', email: 'person@example.test' },
};

test('manual opening accepts event answers without a scheduled closing time', async () => {
  const cutoff = '2026-11-19T18:00:00Z';
  const store = { get: async () => null, save: async (_id: string, value: SurveyRecord) => value };
  const submitted = { ...body, cohort: 'event' };
  const now = () => new Date('2026-11-22T21:00:00Z');
  assert.ok((await createSurveyIntake(store, now, cutoff, 'manual')(submitted)).ok);
  assert.equal(surveySigningDeadline('manual'), Infinity);
  assert.deepEqual(await createSurveyIntake(store, now, cutoff, '2026-11-22T20:59:00Z')(submitted),
    { ok: false, reason: 'survey-closed' });
});

test('responders get a salted commitment and retries do not duplicate or expose the stored response', async () => {
  const records = new Map<string, SurveyRecord>();
  const intake = createSurveyIntake({
    async get(id) { return records.get(id) ?? null; },
    async save(id, value) {
      if (!records.has(id)) records.set(id, value);
      return records.get(id)!;
    },
  });
  const first = await intake(body);
  assert.ok(first.ok);
  assert.match(first.salt, /^[a-f0-9]{32}$/);
  assert.equal(first.commitment, surveyCommitment(first.salt, body.answer));
  assert.deepEqual(await intake(body), first);
  assert.deepEqual(await intake({ ...body, answer: { ...body.answer, email: null } }),
    { ok: false, reason: 'survey-id-in-use' });
  assert.equal(records.size, 1);
  assert.deepEqual(await intake({ ...body, answer: { ...body.answer, usefulness: 6 } }),
    { ok: false, reason: 'invalid-survey' });
});

test('closing rejects new responses and lets an exact retry recover the salt', async () => {
  const records = new Map<string, SurveyRecord>();
  let now = new Date('2026-11-19T19:59:59Z');
  const intake = createSurveyIntake({
    async get(id) { return records.get(id) ?? null; },
    async save(id, value) { if (!records.has(id)) records.set(id, value); return records.get(id)!; },
  }, () => now, '2026-11-19T18:00:00Z', '2026-11-19T20:00:00Z');

  const saved = await intake(body);
  assert.ok(saved.ok);
  now = new Date('2026-11-19T20:01:00Z');
  assert.deepEqual(await intake(body), saved);
  assert.deepEqual(await intake({ ...body, answer: { ...body.answer, usefulness: 2 } }),
    { ok: false, reason: 'survey-id-in-use' });
  assert.deepEqual(await intake({ ...body, id: 'abca9615-00d0-414c-aa12-68ac34535888' }),
    { ok: false, reason: 'survey-closed' });
  assert.equal(records.size, 1);
});

test('a stale rehearsal page can recover its saved response but cannot submit an event response', async () => {
  const records = new Map<string, SurveyRecord>();
  let now = new Date('2026-11-19T17:59:59Z');
  const intake = createSurveyIntake({
    async get(id) { return records.get(id) ?? null; },
    async save(id, value) { if (!records.has(id)) records.set(id, value); return records.get(id)!; },
  }, () => now, '2026-11-19T18:00:00Z', '2026-11-19T20:00:00Z');
  const rehearsal = { ...body, cohort: 'rehearsal' };
  const saved = await intake(rehearsal);
  assert.ok(saved.ok);
  now = new Date('2026-11-19T18:00:00Z');
  assert.deepEqual(await intake(rehearsal), saved);
  const newId = 'abca9615-00d0-414c-aa12-68ac34535888';
  assert.deepEqual(await intake({ ...rehearsal, id: newId }),
    { ok: false, reason: 'survey-cohort-changed' });
  assert.deepEqual(await intake({ ...rehearsal, cohort: 'event' }),
    { ok: false, reason: 'survey-cohort-changed' });
  assert.equal(records.size, 1);
  assert.ok((await intake({ ...body, id: newId, cohort: 'event' })).ok);
  assert.equal(records.get(newId)?.rehearsal, false);
});

test('intake storage writes only to the private survey key', async () => {
  const commands: unknown[][] = [];
  const store = createPrivateSurveyStore({ KV_REST_API_URL: 'https://example.test', KV_REST_API_TOKEN: 'test' },
    async (_url, options) => {
      commands.push(JSON.parse(String(options?.body)));
      return Response.json({ result: 1 });
    });
  assert.ok((await createSurveyIntake(store)(body)).ok);
  assert.equal(commands.length, 1);
  const [command, key, id, payload] = commands[0];
  assert.deepEqual([command, key, id], ['HSETNX', 'contributions:testnet:private-survey:v1', body.id]);
  assert.equal(JSON.parse(String(payload)).answer.email, body.answer.email);
});

test('team authorization nonce is atomically consumed with a short Redis expiry', async () => {
  const commands: unknown[][] = [];
  let used = false;
  const store = createPrivateSurveyStore({ KV_REST_API_URL: 'https://example.test', KV_REST_API_TOKEN: 'test' },
    async (_url, options) => {
      const command = JSON.parse(String(options?.body)) as unknown[];
      commands.push(command);
      const result = used ? null : (used = true, 'OK');
      return Response.json({ result });
    });
  assert.equal(await store.consumeTeamAuthorization('GABC', 'ab'.repeat(16)), true);
  assert.equal(await store.consumeTeamAuthorization('GABC', 'ab'.repeat(16)), false);
  assert.deepEqual(commands[0], ['SET', `contributions:testnet:team-auth:v1:${'ab'.repeat(16)}`, 'GABC', 'NX', 'EX', 120]);
});
