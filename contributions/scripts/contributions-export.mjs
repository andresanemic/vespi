import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chainDigestPattern, chainEvidenceScope, evidenceApiUrl, readEvidenceChain, readFocusEvidence } from '../src/lib/contributions/chain-evidence.mjs';
import { contributionNetwork, parseContributionNetwork } from '../src/lib/contributions/network.ts';

export async function buildEvidencePackage({ origin, root, network, attendance = '', registeredFocusRoot = /** @type {string | null | undefined} */ (undefined), request = fetch }) {
  const { horizon, explorer, id } = contributionNetwork(network);
  const get = url => request(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const read = path => get(evidenceApiUrl(origin, path, network));
  const chain = attendance ? { state: 'complete', entries: await readFocusEvidence(read, root, attendance, network, registeredFocusRoot) }
    : await readEvidenceChain(read, root, network);
  if (chain.state !== 'complete') throw new Error('chain is ' + (chain.state === 'missing' ? 'missing' : 'incomplete'));
  if (network === 'mainnet' && chain.entries.some(({ index }) => index.rehearsal === true)) {
    throw new Error('mainnet export cannot include rehearsal receipts');
  }

  const transactions = await Promise.all(chain.entries.map(async ({ receipt, index, sponsor }) => {
    const response = await get(horizon + '/transactions/' + index.txHash);
    if (!response.ok) throw new Error('Horizon returned HTTP ' + response.status + ' for ' + index.txHash);
    const tx = await response.json();
    if (tx.successful !== true) throw new Error('Horizon transaction failed: ' + index.txHash);
    // Equality binds Horizon's signed bytes to the envelope verified by readEvidenceChain.
    if (tx.hash !== index.txHash || tx.ledger !== index.ledger || tx.envelope_xdr !== index.envelopeXdr ||
      tx.source_account !== receipt.actor || tx.fee_account !== sponsor ||
      typeof tx.created_at !== 'string' || !Number.isFinite(Date.parse(tx.created_at))) {
      throw new Error('Horizon transaction does not match the verified index: ' + index.txHash);
    }
    return {
      digest: index.digest, network: id, txHash: tx.hash, ledger: tx.ledger, closedAt: tx.created_at,
      actor: receipt.actor, envelopeHash: index.txHash, envelopeXdr: tx.envelope_xdr, sponsor,
    };
  }));

  return {
    receipts: chain.entries.map(({ bytes, index, receipt }) => ({
      digest: index.digest, bytes, account: receipt.actor, statement: receipt.statement, comment: receipt.comment,
    })),
    transactions,
    index: {
      version: 1, root, network: id, ...(attendance && { purpose: 'focus-attendance' }),
      receipts: chain.entries.map(({ receipt, index }) => ({
        digest: index.digest, kind: receipt.kind, role: receipt.role, account: receipt.actor, prev: receipt.prev,
        ...(attendance && receipt.kind === 'ATTEST' && { chain: receipt.chain, subject: receipt.subject }),
        txHash: index.txHash, ledger: index.ledger, explorer: explorer + '/tx/' + index.txHash,
      })),
    },
  };
}

const readme = [
  '# Vespi Contributions chain evidence',
  '',
  chainEvidenceScope.en,
  '',
  '1. Follow `index.json` from the request through the contribution to the acceptance.',
  "2. Compute the SHA-256 of each file in `receipts/` as stored. It must match the file's digest and the transaction's `MEMO_HASH`.",
  "3. Compare each receipt's `prev` with the preceding file's digest. The request has a null predecessor.",
  '4. Follow the explorer links to confirm the network and ledger. In `transactions.json`, the fee-bump XDR contains the actor’s signed transaction. Its outer hash is the ledger transaction hash, and its fee source is the sponsor.',
  '',
  'Each receipt contains the statement and comment exactly as signed. This package is published with the consent of both participants.',
  '',
].join('\n');

const attendanceReadme = [
  '# Vespi Contributions attendance evidence', '',
  'The organizer signed the event record (REQUEST). The attendee signed a statement of attendance (ATTEST).',
  'The evidence verifies who signed the two receipts. Attendance itself is self-reported.', '',
  '1. Check that `chain` and `subject` in the ATTEST match the digest of the REQUEST in `index.json`.',
  '2. Compute the SHA-256 of each receipt file and match it to the digest and the transaction’s MEMO_HASH.',
  '3. Compare the signed envelopes in `transactions.json` with the linked transactions on Stellar testnet.', '',
].join('\n');

async function checkOutput(out, force) {
  const stat = await lstat(out).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat && !stat.isDirectory()) throw new Error('--out must be a directory');
  if (stat && !force && (await readdir(out)).length) {
    throw new Error('output directory is not empty; use --force to replace the package');
  }
}

async function writePackage(out, bundle, force) {
  await mkdir(dirname(out), { recursive: true });
  const stage = join(dirname(out), '.' + basename(out) + '.contributions-export');
  await mkdir(stage).catch(error => {
    if (error.code === 'EEXIST') throw new Error('another or interrupted export is using ' + stage);
    throw error;
  });
  const saved = join(stage, 'previous');
  const next = join(stage, 'next');
  const paths = ['receipts', 'transactions.json', 'index.json', 'README.md'];
  const moved = [];
  const installed = [];
  let preserveStage = false;
  try {
    await checkOutput(out, force);
    await mkdir(out, { recursive: true });
    await mkdir(join(next, 'receipts'), { recursive: true });
    await mkdir(saved);
    for (const { digest, bytes } of bundle.receipts) await writeFile(join(next, 'receipts', digest + '.json'), bytes);
    const json = (name, value) => writeFile(join(next, name + '.json'), JSON.stringify(value, null, 2) + '\n');
    await json('transactions', bundle.transactions);
    await json('index', bundle.index);
    await writeFile(join(next, 'README.md'), bundle.index.purpose === 'focus-attendance' ? attendanceReadme : readme);
    for (const path of paths) {
      try {
        await rename(join(out, path), join(saved, path));
        moved.push(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(join(next, path), join(out, path));
      installed.push(path);
    }
  } catch (error) {
    try {
      for (const path of installed.reverse()) await rename(join(out, path), join(next, path));
      for (const path of moved.reverse()) await rename(join(saved, path), join(out, path));
    } catch (rollbackError) {
      preserveStage = true;
      throw new Error('output rollback failed; recover files from ' + stage, { cause: rollbackError });
    }
    throw error;
  } finally {
    if (!preserveStage) await rm(stage, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    network: { type: 'string' }, chain: { type: 'string' }, attendance: { type: 'string' }, out: { type: 'string' },
    origin: { type: 'string', default: 'https://vespi.xyz' }, force: { type: 'boolean' },
    'public-text-reviewed': { type: 'boolean' },
  } });
  const { chain: root, attendance, out, force } = values;
  if (!root || !chainDigestPattern.test(root) || (attendance !== undefined && !chainDigestPattern.test(attendance)) || !out || !values.network) {
    throw new Error('usage: --network mainnet|testnet --chain <request-digest> [--attendance <attestation-digest>] --out <directory> [--origin <url>] [--force] [--public-text-reviewed]');
  }
  const network = parseContributionNetwork(values.network);
  const origin = new URL(values.origin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) throw new Error('--origin must be an HTTP(S) origin');
  const destination = resolve(out);
  if (dirname(destination) === destination) throw new Error('--out must name a package directory');
  await checkOutput(destination, force);
  const bundle = await buildEvidencePackage({ origin, root, network, attendance });
  for (const { account, statement, comment } of bundle.receipts) console.log(JSON.stringify({ account, statement, comment }));
  if (!values['public-text-reviewed']) {
    throw new Error(attendance
      ? 'Review the event record and attendance statement above before rerunning with --public-text-reviewed.'
      : 'Review the signed text above and obtain consent from both participants before rerunning with --public-text-reviewed.');
  }
  await writePackage(destination, bundle, force);
  console.log('Exported ' + bundle.receipts.length + ' receipts on ' + network + ' to ' + destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('contributions-export: ' + error.message);
    process.exitCode = 1;
  });
}
