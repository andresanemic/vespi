'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('suite record script exists and the saved result has its required fields', () => {
  const root = path.join(__dirname, '..');
  const script = path.join(root, 'scripts', 'record-suite.mjs');
  const result = path.join(root, 'docs', 'SUITE_RESULT.txt');
  assert.equal(fs.existsSync(script), true);

  const contents = fs.readFileSync(result, 'utf8');
  for (const field of [
    /^Date \(UTC\): .+$/m,
    /^Node version: v\d+\.\d+\.\d+$/m,
    /^HEAD SHA: [a-f0-9]{40}$/m,
    /^The HEAD SHA is the parent commit of the commit that stores this file\.$/m,
    /^Command: node --test test\/\*\.test\.js$/m,
    /^Tests: \d+$/m,
    /^Passed: \d+$/m,
    /^Failed: \d+$/m,
    /^Todo: \d+$/m,
    /^Skipped: \d+$/m,
  ]) assert.match(contents, field);
});
