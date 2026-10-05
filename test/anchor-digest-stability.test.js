'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReceipt, anchorReceipt, anchorReceiptAsync } = require('../src/receipt.js');

function receipt() {
  return buildReceipt({
    operation: { id: 'anchor-stability', goal: 'test stable anchor body', action: 'anchor' },
    capabilityId: 'test-cap',
    authority: { spend: [] },
    outcome: { status: 'verified', exercised: [] },
    evidence: {},
    verification: { verified: true, checks: { local: true }, reason: 'test' },
    notCovered: ['external anchor'],
    at: '2040-01-01T00:00:00.000Z',
  });
}

test('synchronous anchoring sends, confirms, and returns one immutable body digest', () => {
  const original = receipt();
  const seen = [];
  const anchored = anchorReceipt(original, (digest) => { seen.push(digest); return { network: 'stellar:testnet', txHash: 'sync-tx' }; },
    (_txHash, digest) => { seen.push(digest); return true; });

  assert.equal(anchored.anchor.status, 'anchored');
  assert.deepEqual(seen, [anchored.digest, anchored.digest]);
  assert.equal(anchored.anchor.digest, anchored.digest);
});

test('asynchronous anchoring sends, confirms, and returns one immutable body digest', async () => {
  const original = receipt();
  const seen = [];
  const anchored = await anchorReceiptAsync(original, async (digest) => { seen.push(digest); return { network: 'stellar:testnet', txHash: 'async-tx' }; },
    async (_txHash, digest) => { seen.push(digest); return true; });

  assert.equal(anchored.anchor.status, 'anchored');
  assert.deepEqual(seen, [anchored.digest, anchored.digest]);
  assert.equal(anchored.anchor.digest, anchored.digest);
});
