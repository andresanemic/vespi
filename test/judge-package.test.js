'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
test('judge package parses Node TAP counts and hashes bytes with SHA-256', async () => {
  const { parseTestCounts, sha256, buildPackage } = await import('../scripts/judge-package.mjs');
  assert.deepEqual(parseTestCounts('# tests 205\n# pass 205\n# fail 0\n'), {
    tests: 205, passed: 205, failed: 0,
  });
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const report = await buildPackage({ counts: { tests: 1, passed: 1, failed: 0 }, commit: null });
  assert.equal(report.packageVersion, '0.1.5');
  assert.equal(report.gitCommit, null);
  assert.match(report.sourceSnapshotNote, /fileHashes bind the exact files/);
  assert.match(report.fileHashes['src/operation.js'], /^[a-f0-9]{64}$/);
  assert.match(report.fileHashes['README.md'], /^[a-f0-9]{64}$/);
  assert.match(report.fileHashes['demo/x402/bridge.test.mjs'], /^[a-f0-9]{64}$/);
  assert.match(report.fileHashes['docs/RELEASE_0.1.5_KERNEL.md'], /^[a-f0-9]{64}$/);
  for (const privatePath of Object.keys(report.fileHashes)) {
    assert.doesNotMatch(privatePath, /(^|\/)(\.job|node_modules|\.env[^/]*)(\/|$)|auth\.json|\.db(-shm|-wal)?$|snapshot\//);
  }
  assert.equal(report.fileHashes['test/k3.test.js'], undefined);
  assert.equal(report.fileHashes['demo/x402/receipts/live-testnet-2026-10-02.json'], undefined);
  assert.equal(report.fileHashes['docs/JUDGE_PACKAGE.json'], report.manifestSelfHash);
  assert.ok(report.excludedPaths.includes('**/node_modules/**'));
  assert.ok(report.excludedPaths.includes('**/.job/**'));
  assert.equal(report.tests.passed, 1);
  assert.equal(report.publicProjectRepositories.length, 11);
  assert.ok(report.publicProjectRepositories.some((repository) => repository.name === 'Permamuseum'));
  assert.ok(report.publicProjectRepositories.some((repository) => repository.name === 'TEMIS'));
  for (const repository of report.publicProjectRepositories) {
    assert.match(repository.status, /does not verify current repository contents/);
  }
});
