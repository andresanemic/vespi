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
  assert.equal(report.packageVersion, '0.1.4-rc.6');
  assert.equal(report.gitCommit, null);
  assert.match(report.fileHashes['src/operation.js'], /^[a-f0-9]{64}$/);
  assert.equal(report.fileHashes['docs/JUDGE_PACKAGE.json'], report.manifestSelfHash);
  assert.ok(report.excludedPaths.includes('**/node_modules/**'));
  assert.equal(report.tests.passed, 1);
  assert.ok(report.publicProjectRepositories.some((repository) => repository.name === 'TEMIS'));
});
