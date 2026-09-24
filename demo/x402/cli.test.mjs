import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, validateServiceUrl } from './cli.js';

test('preserves equals signs inside argument values', () => {
  assert.deepEqual(parseArgs(['--service-url=https://example.test/api?a=b=c']), {
    '--service-url': 'https://example.test/api?a=b=c',
  });
});

test('parses ordinary key-value arguments', () => {
  assert.deepEqual(parseArgs(['--max-usdc=0.05']), { '--max-usdc': '0.05' });
});

test('accepts HTTPS and local HTTP service URLs only', () => {
  assert.equal(validateServiceUrl('https://example.test/api'), 'https://example.test/api');
  assert.equal(validateServiceUrl('http://localhost:3777/api'), 'http://localhost:3777/api');
  assert.throws(() => validateServiceUrl('http://example.test/api'), /HTTPS/);
  assert.throws(() => validateServiceUrl('not-a-url'), /invalid/);
});

test('rejects bare, unknown, and duplicate flags when a schema is supplied', () => {
  const allowed = new Set(['--service-url', '--pay-to', '--max-usdc']);
  for (const args of [
    ['--max-usdc', '0.05'],
    ['--unknown=value'],
    ['--max-usdc=0.05', '--max-usdc=0.1'],
  ]) {
    assert.throws(() => parseArgs(args, allowed), /argument|unknown|duplicate|value/);
  }
});
