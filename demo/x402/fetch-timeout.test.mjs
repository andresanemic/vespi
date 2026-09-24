import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, readJsonWithTimeout } from './capability.js';

test('fetchWithTimeout rejects redirects by default', async () => {
  const originalFetch = globalThis.fetch;
  let redirect;
  globalThis.fetch = async (_url, options) => {
    redirect = options.redirect;
    return new Response('{}', { status: 200 });
  };
  try {
    await fetchWithTimeout('http://localhost:3777');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(redirect, 'error');
});

test('fetchWithTimeout aborts a request that exceeds its deadline', async () => {
  const originalFetch = globalThis.fetch;
  let signal;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  try {
    await assert.rejects(fetchWithTimeout('http://localhost:3777', {}, 5), /timeout/);
    assert.equal(signal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readJsonWithTimeout bounds a post-payment body read', async () => {
  const response = { json: () => new Promise(() => {}) };
  await assert.rejects(readJsonWithTimeout(response, 5), /body timeout/);
});

test('readJsonWithTimeout cancels a pending response stream', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readJsonWithTimeout(response, 5), /body timeout/);
  assert.equal(cancelled, true);
});
