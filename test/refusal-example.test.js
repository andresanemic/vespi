'use strict';

// The example that shows what an agent is not allowed to do must keep telling the truth:
// an over-limit operation is stopped with no effect, an in-limit one runs and verifies.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('examples/refusal.js refuses the over-limit operation and verifies the in-limit one', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'refusal.js')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;
  assert.match(out, /operation 1: spend 25 NOTE/);
  assert.match(out, /needs_human_decision \(over the granted ceiling; no effect ran\)/);
  assert.match(out, /effect: none/);
  assert.match(out, /"status":"needs_human_decision"[^\n]*"coverage":\[\]/);
  assert.match(out, /operation 2: spend 3 NOTE/);
  assert.match(out, /"status":"verified"[^\n]*"coverage":\["effect_present","recipient_matches"\][^\n]*"notCovered":\["network_anchor","external anchor"\]/);
});
