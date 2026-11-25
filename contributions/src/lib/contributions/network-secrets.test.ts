import { test } from 'node:test';
import assert from 'node:assert/strict';

const { contributionsRedisCredentials, contributionsTokenKey } =
  await import(new URL('./redis-credentials.mjs', import.meta.url).href);

const testnet = {
  CONTRIB_KV_REST_API_URL: 'https://testnet.example', CONTRIB_KV_REST_API_TOKEN: 'testnet-token',
  UPSTASH_REDIS_REST_URL: 'https://shared.example', UPSTASH_REDIS_REST_TOKEN: 'shared-token',
  CONTRIB_TOKEN_KEY: 'testnet-token-key-with-32-bytes-at-least!',
};
const mainnet = {
  ...testnet,
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://mainnet.example', CONTRIB_KV_MAINNET_REST_API_TOKEN: 'mainnet-token',
  CONTRIB_TOKEN_KEY_MAINNET: 'mainnet-token-key-with-32-bytes-at-least!',
};

test('testnet keeps its historical Redis lookup and token key', () => {
  assert.deepEqual(contributionsRedisCredentials(testnet), { url: 'https://testnet.example', token: 'testnet-token' });
  assert.deepEqual(contributionsRedisCredentials(testnet, 'testnet'), contributionsRedisCredentials(testnet));
  const shared = { ...testnet, CONTRIB_KV_REST_API_URL: undefined, CONTRIB_KV_REST_API_TOKEN: undefined };
  assert.deepEqual(contributionsRedisCredentials(shared), { url: 'https://shared.example', token: 'shared-token' });
  assert.equal(contributionsTokenKey(testnet), testnet.CONTRIB_TOKEN_KEY);
});

test('mainnet reads only its own Redis store and never falls back', () => {
  assert.deepEqual(contributionsRedisCredentials(mainnet, 'mainnet'), { url: 'https://mainnet.example', token: 'mainnet-token' });
  assert.throws(() => contributionsRedisCredentials(testnet, 'mainnet'), /CONTRIB_KV_MAINNET/);
  assert.throws(() => contributionsRedisCredentials({ ...mainnet, CONTRIB_KV_MAINNET_REST_API_TOKEN: '' }, 'mainnet'), /CONTRIB_KV_MAINNET/);
  for (const url of ['https://testnet.example', 'https://shared.example']) {
    assert.throws(() => contributionsRedisCredentials({ ...mainnet, CONTRIB_KV_MAINNET_REST_API_URL: url }, 'mainnet'), /must not share/);
  }
  assert.throws(() => contributionsRedisCredentials(mainnet, 'pubnet'), /unknown network/);
  for (const url of ['https://TESTNET.example/', ' https://shared.example:443 ', 'https://shared.example//']) {
    assert.throws(() => contributionsRedisCredentials({ ...mainnet, CONTRIB_KV_MAINNET_REST_API_URL: url }, 'mainnet'), /must not share/, url);
  }
  for (const token of ['testnet-token', ' shared-token ']) {
    assert.throws(() => contributionsRedisCredentials({ ...mainnet, CONTRIB_KV_MAINNET_REST_API_TOKEN: token }, 'mainnet'), /must not share/, token);
  }
});

test('mainnet accepts the names the Vercel Upstash integration creates, still never a shared store', () => {
  const integration = { ...testnet, CONTRIB_KV_MAINNET_KV_REST_API_URL: 'https://mainnet.example', CONTRIB_KV_MAINNET_KV_REST_API_TOKEN: 'mainnet-token' };
  assert.deepEqual(contributionsRedisCredentials(integration, 'mainnet'), { url: 'https://mainnet.example', token: 'mainnet-token' });
  assert.throws(() => contributionsRedisCredentials({ ...integration, CONTRIB_KV_MAINNET_KV_REST_API_URL: 'https://shared.example/' }, 'mainnet'), /must not share/);
  assert.throws(() => contributionsRedisCredentials({ ...testnet, CONTRIB_KV_MAINNET_KV_REST_API_URL: 'https://mainnet.example' }, 'mainnet'), /CONTRIB_KV_MAINNET/);
  assert.throws(() => contributionsRedisCredentials({ ...integration, CONTRIB_KV_MAINNET_REST_API_URL: 'https://old.example' }, 'mainnet'), /CONTRIB_KV_MAINNET/);
});

test('mainnet needs its own token key of at least 32 bytes, distinct from testnet', () => {
  assert.equal(contributionsTokenKey(mainnet, 'mainnet'), mainnet.CONTRIB_TOKEN_KEY_MAINNET);
  assert.throws(() => contributionsTokenKey(testnet, 'mainnet'), /CONTRIB_TOKEN_KEY_MAINNET/);
  assert.throws(() => contributionsTokenKey({ ...mainnet, CONTRIB_TOKEN_KEY_MAINNET: 'short' }, 'mainnet'), /32 bytes/);
  assert.throws(() => contributionsTokenKey({ ...mainnet, CONTRIB_TOKEN_KEY_MAINNET: testnet.CONTRIB_TOKEN_KEY }, 'mainnet'), /reuse/);
  assert.throws(() => contributionsTokenKey(mainnet, 'pubnet'), /unknown network/);
  assert.throws(() => contributionsTokenKey({ ...mainnet, CONTRIB_TOKEN_KEY_MAINNET: ` ${testnet.CONTRIB_TOKEN_KEY} ` }, 'mainnet'), /reuse/);
});
