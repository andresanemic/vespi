import { createHash } from 'node:crypto';
import { FeeBumpTransaction, Keypair } from '@stellar/stellar-sdk/base';
import { buildIndexEntry, contributionDigest, parseContribution, verifyChain } from './kernel/contributions.js';
import { contributionNetwork } from './network.ts';
import { focusAttendance, focusRoot } from './focus-event.ts';

/** @typedef {import('./network').ContributionNetwork} Network */
/** @typedef {(path: string) => Promise<Response>} Read */

export const chainDigestPattern = /^[0-9a-f]{64}$/;
export const chainEvidenceScope = {
  en: 'The evidence shows that the accounts signed these receipt bytes and in which order. It does not establish whether the contribution was good or true.',
  es: 'La evidencia muestra que las cuentas firmaron estos bytes y en qué orden. No establece si el aporte fue bueno o verdadero.',
};

/** @param {ReturnType<typeof parseContribution>} receipt @param {ReturnType<typeof buildIndexEntry>} index @param {Network} network */
function verifyEnvelope(receipt, index, network) {
  const envelope = new FeeBumpTransaction(index.envelopeXdr, contributionNetwork(network).passphrase);
  const tx = envelope.innerTransaction;
  if (envelope.hash().toString('hex') !== index.txHash) throw new Error('envelope hash or network mismatch');
  if (tx.memo.type !== 'hash' || !Buffer.isBuffer(tx.memo.value) ||
    tx.memo.value.toString('hex') !== index.digest) throw new Error('MEMO_HASH mismatch');
  const actor = Keypair.fromPublicKey(receipt.actor);
  if (tx.source !== receipt.actor || !tx.signatures.some(signature =>
    signature.hint().equals(actor.signatureHint()) && actor.verify(tx.hash(), signature.signature()))) {
    throw new Error('actor signature missing or invalid');
  }
  const sponsor = Keypair.fromPublicKey(envelope.feeSource);
  if (!envelope.signatures.some(signature =>
    signature.hint().equals(sponsor.signatureHint()) && sponsor.verify(envelope.hash(), signature.signature()))) {
    throw new Error('sponsor signature missing or invalid');
  }
  return envelope;
}

/** @param {string} digest @param {Buffer} bytes @param {unknown} rawIndex @param {Network} network */
export function verifyEvidenceReceipt(digest, bytes, rawIndex, network) {
  const receipt = parseContribution(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const index = buildIndexEntry(rawIndex);
  if (createHash('sha256').update(bytes).digest('hex') !== digest ||
    contributionDigest(receipt) !== digest || index.digest !== digest) throw new Error('receipt digest mismatch');
  if (index.network !== contributionNetwork(network).id) throw new Error('receipt network mismatch');
  const envelope = verifyEnvelope(receipt, index, network);
  return { bytes, receipt, index, sponsor: envelope.feeSource };
}

/** @typedef {ReturnType<typeof verifyEvidenceReceipt>} EvidenceReceipt */

/** @param {Read} read @param {string} root @param {Network} network */
export async function readEvidenceChain(read, root, network) {
  if (!chainDigestPattern.test(root)) return /** @type {const} */ ({ state: 'missing' });
  const status = await read('/chains/' + root);
  if (status.status === 404) return /** @type {const} */ ({ state: 'missing' });
  if (!status.ok) throw new Error('chain endpoint returned HTTP ' + status.status);
  const { request, head, kind } = await status.json();
  if (request !== root || typeof head !== 'string' || !chainDigestPattern.test(head) ||
    !['REQUEST', 'CONTRIBUTE', 'ACCEPT'].includes(kind) || (kind === 'REQUEST') !== (head === root)) {
    throw new Error('invalid chain head');
  }
  if (kind !== 'ACCEPT') return /** @type {const} */ ({ state: 'pending' });

  /** @type {EvidenceReceipt[]} */
  const entries = [];
  const seen = new Set();
  let next = head;
  while (next !== null) {
    if (!chainDigestPattern.test(next) || seen.has(next)) throw new Error('invalid or cyclic chain link');
    seen.add(next);
    const url = '/receipts/' + next;
    const [raw, index] = await Promise.all([read(url), read(url + '?format=index')]);
    if ([raw, index].some(response => !response.ok && response.status !== 404)) throw new Error('receipt endpoint failed for ' + next);
    if (raw.status === 404 || index.status === 404) return /** @type {const} */ ({ state: 'pending' });
    try {
      const entry = verifyEvidenceReceipt(next, Buffer.from(await raw.arrayBuffer()), await index.json(), network);
      entries.push(entry);
      next = entry.receipt.prev;
    } catch (error) {
      throw new Error('receipt ' + next + ': ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  entries.reverse();
  const receipts = entries.map(entry => entry.receipt);
  const result = verifyChain(receipts);
  if (!result.ok || result.chainId !== root || receipts.at(-1)?.kind !== 'ACCEPT') {
    throw new Error('chain verification failed: ' + (result.reason ?? 'root or final step mismatch'));
  }
  return /** @type {const} */ ({ state: 'complete', entries });
}

/** @param {Read} read @param {string} root @param {string} attendance @param {Network} network @param {string | null} [registeredRoot] */
export async function readFocusEvidence(read, root, attendance, network, registeredRoot = focusRoot) {
  if (network !== 'testnet' || root !== registeredRoot || !chainDigestPattern.test(root) || !chainDigestPattern.test(attendance)) {
    throw new Error('attendance evidence requires the configured testnet event');
  }
  /** @param {string} digest */
  async function entry(digest) {
    const url = '/receipts/' + digest;
    const [raw, index] = await Promise.all([read(url), read(url + '?format=index')]);
    if (!raw.ok || !index.ok) throw new Error('attendance receipt unavailable: ' + digest);
    return verifyEvidenceReceipt(digest, Buffer.from(await raw.arrayBuffer()), await index.json(), network);
  }
  const [request, witness] = await Promise.all([entry(root), entry(attendance)]);
  const receipt = witness.receipt;
  if (request.receipt.kind !== 'REQUEST' || receipt.kind !== 'ATTEST' || receipt.chain !== root ||
    receipt.subject !== root || receipt.actor === request.receipt.actor || receipt.comment !== null ||
    receipt.evidence !== null || !Object.values(focusAttendance).includes(receipt.statement)) {
    throw new Error('invalid focus attendance link');
  }
  return [request, witness];
}

/** @param {string | URL} origin @param {string} path @param {Network} network */
export function evidenceApiUrl(origin, path, network) {
  const url = new URL('/api/contributions' + path, origin);
  url.searchParams.set('network', network);
  return url;
}
