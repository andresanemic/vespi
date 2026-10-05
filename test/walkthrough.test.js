'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('walkthrough runs the human gate, observed effect, receipt and cross-process continuity', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'walkthrough.js')], {
    encoding: 'utf8',
    timeout: 10_000,
    input: 'Ada: approve\n',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gate: needs_human_decision/);
  assert.match(result.stdout, /human approval \[Name: approve\]: approval: approved by Ada/);
  assert.match(result.stdout, /effect: ledger note written/);
  assert.match(result.stdout, /observation: note present/);
  assert.match(result.stdout, /"coverage":\["effect_present","recipient_matches"\]/);
  assert.match(result.stdout, /"notCovered":\["network_anchor","external anchor"\]/);
  assert.match(result.stdout, /second process: resumes next action publish_summary/);
});
