import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildEvidencePackage } from '../../../scripts/contributions-export.mjs';
import { chainFixture } from '../../../tests/fixtures/contributions-chain.mjs';
import { readEvidenceChain } from './chain-evidence.mjs';
import type { ContributionNetwork } from './network';

const exec = promisify(execFile);
const origin = 'https://app.invalid';
const paths = '../../../';
const script = fileURLToPath(new URL(paths + 'scripts/contributions-export.mjs', import.meta.url));
const independent = fileURLToPath(new URL(paths + 'tests/fixtures/verify-contributions-package.mjs', import.meta.url));

function fixture(network: ContributionNetwork, options?: Parameters<typeof chainFixture>[1]) {
  const { root, records, accept } = chainFixture(network, options);
  const byDigest = new Map(records.map(entry => [entry.index.digest, entry]));
  const byTransaction = new Map(records.map(entry => [entry.index.txHash, entry.horizon]));
  async function request(input: URL | string | Request, init?: RequestInit) {
    assert.equal(init?.method, 'GET');
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.startsWith('/transactions/')) {
      assert.equal(url.hostname, network === 'mainnet' ? 'horizon.stellar.org' : 'horizon-testnet.stellar.org');
      const row = byTransaction.get(url.pathname.split('/').at(-1)!);
      return row ? Response.json(row) : new Response(null, { status: 404 });
    }
    assert.equal(url.searchParams.get('network'), network);
    const id = url.pathname.split('/').at(-1)!;
    if (url.pathname.includes('/chains/') && id === root) {
      return Response.json({ request: root, head: accept.index.digest, kind: 'ACCEPT' });
    }
    const entry = byDigest.get(id);
    if (!entry) return new Response(null, { status: 404 });
    return url.searchParams.has('format') ? Response.json(entry.index) : new Response(entry.bytes);
  }
  const read = (path: string) => {
    const url = new URL('/api/contributions' + path, origin);
    url.searchParams.set('network', network);
    return request(url, { method: 'GET' });
  };
  return { request, read, root, records, byDigest };
}

for (const network of ['testnet', 'mainnet'] as const) {
  test(network + ' verifies three canonical receipts and builds the package from the right Horizon', async () => {
    const { request, read, root, records } = fixture(network);
    const chain = await readEvidenceChain(read, root, network);
    assert.equal(chain.state, 'complete');
    const bundle = await buildEvidencePackage({ origin, root, network, request });
    assert.deepEqual(bundle.receipts.map(entry => entry.bytes), records.map(entry => Buffer.from(entry.bytes)));
    assert.deepEqual(bundle.index.receipts.map(entry => entry.kind), ['REQUEST', 'CONTRIBUTE', 'ACCEPT']);
    assert.deepEqual(bundle.index.receipts.map(entry => entry.prev), [null, records[0].index.digest, records[1].index.digest]);
    for (const [i, tx] of bundle.transactions.entries()) {
      assert.equal(tx.network, records[i].index.network);
      assert.equal(tx.envelopeXdr, records[i].horizon.envelope_xdr);
      assert.equal(tx.sponsor, records[i].horizon.fee_account);
      assert.equal(tx.actor, records[i].receipt.actor);
      assert.equal(tx.closedAt, records[i].horizon.created_at);
      assert.match(bundle.index.receipts[i].explorer, network === 'mainnet' ? /\/public\/tx\// : /\/testnet\/tx\//);
    }
  });
}

test('accepting an earlier revision preserves all previous links in the package', async () => {
  const { request, root, records } = fixture('mainnet', { revision: true });
  const bundle = await buildEvidencePackage({ origin, root, network: 'mainnet', request });
  assert.equal(bundle.receipts.length, 4);
  assert.equal(records.at(-1)?.receipt.subject, bundle.index.receipts[1].digest);
  assert.equal(bundle.index.receipts.at(-1)?.prev, bundle.index.receipts[2].digest);
});

test('rejects changed receipt bytes before reading Horizon', async () => {
  const { request, root, records } = fixture('testnet');
  records[1].bytes = records[1].bytes.replace('private statement', 'altered statement');
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'testnet', request }), /receipt digest mismatch/);
  records[1].bytes += '\n';
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'testnet', request }), /bytes must be canonical/);
});

test('rejects a different memo and an absent actor signature', async () => {
  for (const [options, error] of [
    [{ wrongMemo: true }, /MEMO_HASH mismatch/], [{ unsigned: true }, /actor signature missing/],
  ] as const) {
    const { request, root } = fixture('mainnet', options);
    await assert.rejects(buildEvidencePackage({ origin, root, network: 'mainnet', request }), error);
  }
});

test('rejects a missing link without producing a partial chain', async () => {
  const { request, read, root, records, byDigest } = fixture('mainnet');
  byDigest.delete(records[1].index.digest);
  assert.deepEqual(await readEvidenceChain(read, root, 'mainnet'), { state: 'pending' });
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'mainnet', request }), /chain is incomplete/);
});

test('a transient receipt failure takes precedence over an incomplete link', async () => {
  const { read, root, records } = fixture('mainnet');
  const path = '/receipts/' + records[1].index.digest;
  await assert.rejects(readEvidenceChain(url => {
    if (url === path) return Promise.resolve(new Response(null, { status: 404 }));
    if (url === path + '?format=index') return Promise.resolve(new Response(null, { status: 503 }));
    return read(url);
  }, root, 'mainnet'), /receipt endpoint failed/);
});

test('rejects a mixed network and envelopes signed for the wrong passphrase', async () => {
  const { request, root, records } = fixture('mainnet');
  records[1].index.network = 'stellar:testnet';
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'mainnet', request }), /network mismatch/);
  Object.assign(records[1].index, fixture('testnet').records[1].index, { network: 'stellar:pubnet' });
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'mainnet', request }), /envelope hash or network mismatch/);
});

test('the exporter rejects a mainnet rehearsal before reading Horizon', async () => {
  const { request, root, records } = fixture('mainnet');
  records[1].index.rehearsal = true;
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'mainnet', request(input, init) {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.notEqual(url.hostname, 'horizon.stellar.org');
    return request(input, init);
  } }), /mainnet.*rehearsal/);
  const testnet = fixture('testnet');
  testnet.records[1].index.rehearsal = true;
  assert.equal((await buildEvidencePackage({ origin, root: testnet.root, network: 'testnet', request: testnet.request })).receipts.length, 3);
});

test('rejects an unsuccessful Horizon transaction or different Horizon envelope', async () => {
  const { request, root, records } = fixture('testnet');
  records[1].horizon.successful = false;
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'testnet', request }), /Horizon transaction failed/);
  records[1].horizon.successful = true;
  records[1].horizon.envelope_xdr = records[0].horizon.envelope_xdr;
  await assert.rejects(buildEvidencePackage({ origin, root, network: 'testnet', request }), /does not match the verified index/);
});

test('CLI previews signed text, requires review before writing, and refuses replacement without --force', async t => {
  const network = 'mainnet';
  const { root, records, request } = fixture(network);
  const pathsSeen = new Set<string>();
  const server = createServer(async (incoming, response) => {
    try {
      const path = incoming.url!;
      pathsSeen.add(path);
      const url = new URL(path, path.startsWith('/transactions/') ? 'https://horizon.stellar.org' : origin);
      const mocked = await request(url, { method: incoming.method });
      response.writeHead(mocked.status, Object.fromEntries(mocked.headers));
      response.end(Buffer.from(await mocked.arrayBuffer()));
    } catch {
      response.writeHead(500).end();
    }
  });
  t.after(() => server.close());
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const local = 'http://127.0.0.1:' + address.port;
  const preload = 'data:text/javascript,' + encodeURIComponent(`
    const real = fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input);
      if (url.origin === 'https://horizon.stellar.org') return real(${JSON.stringify(local)} + url.pathname, init);
      if (url.origin !== ${JSON.stringify(local)}) throw new Error('Unexpected network');
      return real(input, init);
    };
  `);
  const tmp = await mkdtemp(join(tmpdir(), 'vespi-chain-export-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const out = join(tmp, 'package');
  const args = ['--import', preload, script, '--network', network, '--chain', root, '--out', out, '--origin', local];
  records[1].horizon.successful = false;
  await assert.rejects(exec(process.execPath, args), /Horizon transaction failed/);
  assert.deepEqual(await readdir(tmp), []);
  records[1].horizon.successful = true;
  const signedText = records.map(({ receipt }) => ({
    account: receipt.actor, statement: receipt.statement, comment: receipt.comment,
  }));
  const preview = (stdout: string) => stdout.trim().split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  await assert.rejects(exec(process.execPath, args), (error: Error & { stdout?: string }) => {
    assert.match(error.message, /--public-text-reviewed/);
    assert.deepEqual(preview(error.stdout ?? ''), signedText);
    return true;
  });
  assert.deepEqual(await readdir(tmp), []);
  const reviewed = [...args, '--public-text-reviewed'];
  const { stdout } = await exec(process.execPath, reviewed);
  assert.deepEqual(preview(stdout), signedText);
  assert.match(stdout, /Exported 3 receipts on mainnet/);
  assert.match((await exec(process.execPath, [independent, out])).stdout, /checks passed for 3 receipts/);
  const readme = await readFile(join(out, 'README.md'), 'utf8');
  assert.match(readme, /Each receipt contains the statement and comment exactly as signed/);
  assert.match(readme, /published with the consent of both participants/);
  for (const { index, bytes } of records) {
    assert.deepEqual(await readFile(join(out, 'receipts', index.digest + '.json')), Buffer.from(bytes));
    assert.ok(pathsSeen.has('/transactions/' + index.txHash));
  }
  await writeFile(join(out, 'keep.txt'), 'leave this file');
  await writeFile(join(out, 'receipts', 'stale.json'), 'stale');
  await assert.rejects(exec(process.execPath, reviewed), /directory is not empty/);
  assert.ok((await readdir(join(out, 'receipts'))).includes('stale.json'));
  await assert.rejects(exec(process.execPath, [...args, '--force']), /--public-text-reviewed/);
  assert.ok((await readdir(join(out, 'receipts'))).includes('stale.json'));
  await exec(process.execPath, [...reviewed, '--force']);
  assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'leave this file');
  assert.match((await exec(process.execPath, [independent, out])).stdout, /checks passed for 3 receipts/);
});

test('the independent verifier rejects valid XDR signatures for invalid chain semantics', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vespi-chain-independent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, options, expected] of [
    ['valid revision', { revision: true }, null],
    ['third-party ACCEPT', { thirdPartyAccept: true }, /ACCEPT signer differs from REQUEST/],
    ['foreign subject', { foreignSubject: true }, /ACCEPT subject is not a contribution in this chain/],
    ['different revision signer', { revision: true, thirdPartyRevision: true }, /CONTRIBUTE signer changed/],
  ] as const) {
    const { root, records } = chainFixture('mainnet', options);
    const out = join(dir, name);
    await mkdir(join(out, 'receipts'), { recursive: true });
    for (const { index, bytes } of records) await writeFile(join(out, 'receipts', index.digest + '.json'), bytes);
    await writeFile(join(out, 'index.json'), JSON.stringify({
      version: 1, root, network: 'stellar:pubnet',
      receipts: records.map(({ index, receipt }) => ({
        digest: index.digest, txHash: index.txHash, ledger: index.ledger,
        account: receipt.actor, kind: receipt.kind, role: receipt.role, prev: receipt.prev,
      })),
    }));
    await writeFile(join(out, 'transactions.json'), JSON.stringify(records.map(({ index, receipt, horizon }) => ({
      ...index, envelopeHash: index.txHash, actor: receipt.actor, sponsor: horizon.fee_account, closedAt: horizon.created_at,
    }))));
    const verification = exec(process.execPath, [independent, out]);
    if (expected) await assert.rejects(verification, expected);
    else assert.match((await verification).stdout, /checks passed for 4 receipts/);
  }
});
