import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const sha256 = data => createHash('sha256').update(data).digest();

function accountKey(account) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...account].map(letter => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  return Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2))).subarray(1, 33);
}

// shortcut: reads the app's classic fee-bump/bumpSequence form; extend for other receipt envelope types.
function verifyXdr(transaction) {
  const xdr = Buffer.from(transaction.envelopeXdr, 'base64');
  let cursor = 0;
  const take = size => {
    const bytes = xdr.subarray(cursor, cursor + size);
    check(bytes.length === size, 'truncated XDR');
    cursor += size;
    return bytes;
  };
  const uint = () => take(4).readUInt32BE();
  const expect = (value, message) => check(uint() === value, message);
  const publicKey = () => {
    expect(0, 'Ed25519 account expected');
    return take(32);
  };
  const signed = (key, hash) => {
    const count = uint();
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]);
    const pub = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    let valid = false;
    for (let n = 0; n < count; n++) {
      const hint = take(4);
      const size = uint();
      const signature = take(size);
      take((4 - size % 4) % 4);
      valid ||= size === 64 && hint.equals(key.subarray(-4)) && verify(null, hash, pub, signature);
    }
    check(valid, 'missing or invalid Ed25519 signature');
  };
  const network = sha256(transaction.network === 'stellar:pubnet'
    ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015');
  expect(5, 'fee bump required');
  const feeKey = publicKey();
  take(8);
  const innerStart = cursor;
  expect(2, 'inner envelope required');
  const actorKey = publicKey();
  take(12);
  const conditions = uint();
  check(conditions === 0 || conditions === 1, 'unexpected transaction preconditions');
  if (conditions === 1) take(16);
  expect(3, 'MEMO_HASH required');
  check(take(32).toString('hex') === transaction.digest, 'wrong MEMO_HASH');
  expect(1, 'one operation required');
  const hasSource = uint();
  check(hasSource === 0 || hasSource === 1, 'invalid operation source flag');
  if (hasSource) publicKey();
  expect(11, 'bumpSequence required');
  take(8);
  expect(0, 'unexpected inner transaction extension');
  signed(actorKey, sha256(Buffer.concat([network, xdr.subarray(innerStart, cursor)])));
  expect(0, 'unexpected fee bump extension');
  const hash = sha256(Buffer.concat([network, xdr.subarray(0, cursor)]));
  signed(feeKey, hash);
  check(cursor === xdr.length, 'unexpected envelope tail');
  check(actorKey.equals(accountKey(transaction.actor)), 'actor does not match XDR');
  check(feeKey.equals(accountKey(transaction.sponsor)), 'sponsor does not match XDR');
  check(hash.toString('hex') === transaction.txHash && transaction.txHash === transaction.envelopeHash, 'envelope hash mismatch');
}

const directory = process.argv[2];
const json = async name => JSON.parse(await readFile(join(directory, name), 'utf8'));
const index = await json('index.json');
const transactions = await json('transactions.json');
const files = await readdir(join(directory, 'receipts'));
check(index.version === 1 && transactions.length === index.receipts.length && files.length === transactions.length, 'package counts differ');
check(index.network === 'stellar:pubnet' || index.network === 'stellar:testnet', 'invalid package network');
check(index.receipts.length >= 3 && index.receipts[0].kind === 'REQUEST' &&
  index.receipts.at(-1).kind === 'ACCEPT', 'invalid chain ends');
const requester = index.receipts[0].account;
const contributor = index.receipts[1].account;
const contributions = new Set();
let prev = null;
for (const [i, entry] of index.receipts.entries()) {
  const tx = transactions[i];
  const bytes = await readFile(join(directory, 'receipts', entry.digest + '.json'));
  const receipt = JSON.parse(bytes);
  check(sha256(bytes).toString('hex') === entry.digest && entry.digest === tx.digest, 'receipt digest mismatch');
  check(receipt.prev === prev && entry.prev === prev && (i === 0 ? index.root === entry.digest : receipt.chain === index.root), 'broken prev link');
  check(receipt.actor === entry.account && entry.account === tx.actor && receipt.kind === entry.kind && receipt.role === entry.role, 'actor, kind or role mismatch');
  check(tx.network === index.network && tx.ledger === entry.ledger && tx.txHash === entry.txHash &&
    Number.isFinite(Date.parse(tx.closedAt)), 'transaction record mismatch');
  verifyXdr(tx);
  if (i === 0) {
    check(receipt.chain === null && receipt.subject === null && receipt.role === 'requester', 'invalid REQUEST');
  } else if (i === index.receipts.length - 1) {
    check(receipt.role === 'requester' && receipt.actor === requester, 'ACCEPT signer differs from REQUEST');
    check(contributions.has(receipt.subject), 'ACCEPT subject is not a contribution in this chain');
  } else {
    check(receipt.kind === 'CONTRIBUTE' && receipt.role === 'contributor' && receipt.subject === null, 'invalid CONTRIBUTE');
    check(receipt.actor === contributor, 'CONTRIBUTE signer changed');
    contributions.add(entry.digest);
  }
  prev = entry.digest;
}
console.log('Independent SHA-256, MEMO_HASH, signature and chain checks passed for ' + files.length + ' receipts.');
