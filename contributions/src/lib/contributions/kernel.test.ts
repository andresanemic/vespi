import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const kernelDir = new URL('./kernel/', import.meta.url);

// sha256 of each kernel source at commit 1f558b8 (LF, without the three provenance lines).
const EXPECTED_SHA256: Record<string, string> = {
  'contributions.js': '879bf44e2682a743448967e67e1c2ac868242a1af69e054f57ebc51d18e1ec21',
  'receipt.js': '88ff11a244ea5b7574a17e8a3c284b47753caf5a498af1a235d86fdfcd82a5c2',
  'context.js': '8bfd3ca4ceccb57291c34363e7a847147a291fe677bf64c34a543d6ecbcb3e8f',
  'time.js': '3ed3565a3843b62341e61a2de405eab77b8218a37ac4ef1b41d49f4a4718502d',
  'zk.js': 'e7885a6ceafe8665212323456b17fd5fac61c1907e361d17da31b56a051b9820',
  'authority.js': '6cdf59ff884c5acc51ea00d7dfa946b6cf2058b67f4779e63250edfc0623d946',
};

// contributionDigest of the fixed REQUEST below, computed with the original kernel at 1f558b8.
const REQUEST_DIGEST = 'eb670b1496dd07c1296cf11cf5a08aabc5e08ea3e85bd01bce5d80d657b63e65';

test('vendored files match kernel commit 1f558b8', () => {
  for (const [file, expected] of Object.entries(EXPECTED_SHA256)) {
    const text = readFileSync(new URL(file, kernelDir), 'utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    assert.equal(lines.slice(0, 3).every((line) => line.startsWith('//')), true, `${file}: three provenance comment lines`);
    const body = lines.slice(3).join('\n');
    assert.equal(createHash('sha256').update(body, 'utf8').digest('hex'), expected, file);
  }
});

test('vendored contributions builds and digests a REQUEST', () => {
  const { buildContribution, contributionDigest } = require('./kernel/contributions.js');
  const request = {
    chain: null,
    kind: 'REQUEST',
    role: 'requester',
    actor: 'G' + 'A'.repeat(55),
    statement: 'Pedí feedback',
    comment: null,
    subject: null,
    prev: null,
    evidence: null,
    createdAt: '2026-11-19T17:30:00.000Z',
  };
  const built = buildContribution(request);
  assert.equal(built.kind, 'REQUEST');
  assert.equal(built.version, 1);
  assert.equal(contributionDigest(request), REQUEST_DIGEST);
});
