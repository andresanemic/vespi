import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createRateLimiter, PER_IP, PER_KEY } = await import(new URL('./rate-limit.ts', import.meta.url).href);

const t0 = Date.parse('2026-11-19T18:00:00Z');

test('the defaults are about 120 calls per IP and 10 per key per minute', () => {
  assert.equal(PER_IP, 120);
  assert.equal(PER_KEY, 10);
});

test('30 clients behind one IP with different keys all pass two calls each', () => {
  const limiter = createRateLimiter();
  for (let client = 0; client < 30; client++) {
    for (let call = 0; call < 2; call++) {
      assert.equal(limiter.take('hub', `key-${client}`, t0).ok, true);
    }
  }
});

test('a client repeating its key 11 times gets 429 on the eleventh, with Retry-After', () => {
  const limiter = createRateLimiter();
  for (let n = 0; n < 10; n++) assert.equal(limiter.take('hub', 'same-key', t0 + n).ok, true);
  const limited = limiter.take('hub', 'same-key', t0 + 10);
  assert.equal(limited.ok, false);
  assert.ok(limited.retryAfter > 0 && limited.retryAfter <= 60);
  assert.equal(limiter.take('hub', 'other-key', t0 + 11).ok, true);
});

test('the IP budget stops at 121 calls in the window and resets in the next one', () => {
  const limiter = createRateLimiter();
  for (let n = 0; n < 120; n++) assert.equal(limiter.take('hub', null, t0).ok, true);
  assert.equal(limiter.take('hub', null, t0).ok, false);
  assert.equal(limiter.take('elsewhere', null, t0).ok, true);
  assert.equal(limiter.take('hub', null, t0 + 60_001).ok, true);
});

test('a released call (a busy answer) gives back its IP and key quota', () => {
  const limiter = createRateLimiter({ perIp: 3, perKey: 2 });
  for (let n = 0; n < 20; n++) {
    const hit = limiter.take('hub', 'k', t0);
    assert.equal(hit.ok, true);
    hit.release();
  }
  assert.equal(limiter.take('hub', 'k', t0).ok, true);
  assert.equal(limiter.take('hub', 'k', t0).ok, true);
  assert.equal(limiter.take('hub', 'k', t0).ok, false);
});

test('a key over its limit does not keep spending the IP budget', () => {
  const limiter = createRateLimiter({ perIp: 5, perKey: 1 });
  assert.equal(limiter.take('hub', 'k', t0).ok, true);
  for (let n = 0; n < 10; n++) assert.equal(limiter.take('hub', 'k', t0).ok, false);
  for (let n = 0; n < 4; n++) assert.equal(limiter.take('hub', `other-${n}`, t0).ok, true);
});

test('release after the window has rolled over does not touch the new window', () => {
  const limiter = createRateLimiter({ perIp: 1, perKey: 1 });
  const old = limiter.take('hub', 'k', t0);
  assert.equal(old.ok, true);
  assert.equal(limiter.take('hub', 'k', t0 + 60_001).ok, true);
  old.release();
  assert.equal(limiter.take('hub', 'k', t0 + 60_002).ok, false);
});
