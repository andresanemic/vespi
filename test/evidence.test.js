'use strict';
// The testnet evidence list is part of what judges read: its shape is checked offline here, and
// `node scripts/verify-testnet-evidence.mjs` re-checks every hash against Horizon when there is a network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('docs/testnet-evidence.json lists unique, well formed transaction hashes and a consistent summary', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'testnet-evidence.json'), 'utf8'));
  const list = data.transactions;
  assert.ok(Array.isArray(list) && list.length > 0);
  const seen = new Set();
  for (const t of list) {
    assert.match(t.hash, /^[0-9a-f]{64}$/);
    assert.ok(!seen.has(t.hash), 'duplicate hash');
    seen.add(t.hash);
    assert.ok(Number.isInteger(t.ledger) && t.ledger > 0);
  }
  assert.equal(data.summary.successful, list.length);
  const ledgers = list.map((t) => t.ledger);
  assert.deepEqual(data.summary.ledgers, [Math.min(...ledgers), Math.max(...ledgers)]);
});

test('the README counts match the evidence file', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'testnet-evidence.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes(`${data.transactions.length} successful testnet transactions`), 'English README states the number');
  assert.ok(readme.includes(`${data.transactions.length} transacciones exitosas en testnet`), 'Spanish README states the number');
});
