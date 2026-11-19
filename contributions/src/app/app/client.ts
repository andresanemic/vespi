import { Account, BASE_FEE, StrKey, FeeBumpTransaction, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { Buffer } from 'buffer';
import { surveyMaxTime } from './encuesta/timebound';
import { profileMessage } from '@/lib/contributions/profile-authorization';
import { photoUploadMessage } from '@/lib/contributions/photo-authorization';
import { signTransaction, type Signer } from '@/lib/contributions/keys';

const api = '/api/contributions';
const horizon = 'https://horizon-testnet.stellar.org';
const hashPattern = /^[0-9a-f]{64}$/;

type Reply<T> = ({ ok: true } & T) | { ok: false; reason: string };
type Index = { digest: string; txHash: string; ledger: number; rehearsal: boolean };
type HorizonTransaction = { envelope_xdr: string; successful: boolean; hash: string; ledger: number };

export class FlowError extends Error {}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function post<T>(path: string, body: object) {
  const response = await fetch(api + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result: Reply<T> = await response.json();
  return { result, retryAfter: Number(response.headers.get('Retry-After')) || 2 };
}

export async function onboard(signer: Signer) {
  const until = Date.now() + 70_000;
  do {
    const { result, retryAfter } = await post<{ xdr: string; token: string }>('/account', {
      action: 'prepare', publicKey: signer.publicKey,
    });
    if (!result.ok) {
      if (result.reason === 'already-onboarded') return;
      if (result.reason !== 'busy' && result.reason !== 'rate_limited') throw new FlowError(result.reason);
      await pause(retryAfter * 1000);
      continue;
    }
    const tx = new Transaction(result.xdr, Networks.TESTNET);
    const [begin, create, end] = tx.operations;
    if (tx.source === signer.publicKey || tx.operations.length !== 3 || tx.memo.type !== 'none' ||
      begin.type !== 'beginSponsoringFutureReserves' || !begin.source || begin.source === signer.publicKey ||
      begin.sponsoredId !== signer.publicKey || create.type !== 'createAccount' || create.source !== begin.source ||
      create.destination !== signer.publicKey || create.startingBalance !== '0.0000000' ||
      end.type !== 'endSponsoringFutureReserves' || end.source !== signer.publicKey) {
      throw new FlowError('unexpected-onboarding');
    }
    await signTransaction(tx, signer);
    const { result: completed } = await post('/account', {
      action: 'complete', xdr: tx.toXDR(), token: result.token,
    });
    if (completed.ok || completed.reason === 'already-onboarded') return;
    if (completed.reason !== 'retry') throw new FlowError(completed.reason);
    await pause(1000);
  } while (Date.now() < until);
  throw new FlowError('busy');
}

export function validDisplayName(name: string) {
  return !!name && [...name].length <= 40 && !/[\p{Cc}\p{Cf}]/u.test(name);
}

export async function getDisplayName(account: string) {
  const response = await fetch(api + '/profiles/' + account, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new FlowError('profile-unavailable');
  const { account: profileAccount, displayName } = await response.json();
  if (profileAccount !== account || typeof displayName !== 'string' || !validDisplayName(displayName)) {
    throw new FlowError('profile-unavailable');
  }
  return displayName;
}

export type DirectoryProfile = { account: string; displayName: string };

export async function readProfilePage(cursor: string) {
  const response = await fetch(api + '/profiles?cursor=' + encodeURIComponent(cursor), {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new FlowError('profile-unavailable');
  const page: { cursor: string; entries: DirectoryProfile[] } = await response.json();
  if (typeof page.cursor !== 'string' || !/^\d{1,20}$/.test(page.cursor) || !Array.isArray(page.entries)) {
    throw new FlowError('profile-unavailable');
  }
  return { cursor: page.cursor, entries: page.entries.filter(profile => profile && typeof profile.account === 'string' &&
    StrKey.isValidEd25519PublicKey(profile.account) && typeof profile.displayName === 'string' && validDisplayName(profile.displayName)) };
}

export async function publishDisplayName(signer: Signer, displayName: string) {
  const account = signer.publicKey;
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const signature = Buffer.from(await signer.sign(profileMessage(account, displayName, expiresAt))).toString('hex');
  const { result } = await post('/profiles', { account, displayName, expiresAt, signature });
  if (result.ok) return displayName;
  if (result.reason === 'profile-exists') {
    const existing = await getDisplayName(account);
    if (existing !== null) return existing;
  }
  throw new FlowError('profile-unavailable');
}

export function makeRequest(actor: string, statement: string, comment: string | null) {
  return { version: 1, chain: null, kind: 'REQUEST' as const, role: 'requester', actor, statement,
    comment, subject: null, prev: null, evidence: null, createdAt: new Date().toISOString() };
}

export async function digestBytes(bytes: ArrayBuffer) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

export type LinkedKind = 'CONTRIBUTE' | 'ACCEPT';

export function makeLinkedReceipt(kind: LinkedKind, actor: string, chain: string, prev: string, statement: string, comment: string | null = null) {
  return { version: 1, kind, role: kind === 'ACCEPT' ? 'requester' : 'contributor', actor, chain, prev,
    subject: kind === 'ACCEPT' ? prev : null, statement, comment, evidence: null, createdAt: new Date().toISOString() };
}

export function makeSurveyReceipt(actor: string, commitment: string) {
  return { version: 1, chain: null, kind: 'SURVEY' as const, role: 'respondent', actor,
    statement: 'Respondí la encuesta', comment: null, subject: null, prev: null, evidence: { commitment }, createdAt: new Date().toISOString() };
}

type PhotoEvidence = { uri: string; sha256: string };

export async function uploadContributionPhoto(file: Blob, signer: Signer) {
  const bytes = await file.arrayBuffer();
  const sha256 = await digestBytes(bytes);
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const signature = await signer.sign(photoUploadMessage(signer.publicKey, sha256, expiresAt));
  const { result } = await post<{ evidence: PhotoEvidence }>('/photos', {
    actor: signer.publicKey, sha256, expiresAt,
    signature: Buffer.from(signature).toString('hex'), base64: Buffer.from(bytes).toString('base64'),
  });
  if (!result.ok) throw new FlowError(result.reason);
  return result.evidence;
}

export function makeObservation(actor: string, chain: string, subject: string, statement: string, comment: string | null, evidence: PhotoEvidence | null = null) {
  return { version: 1, kind: 'ATTEST' as const, role: 'observer', actor, chain, subject,
    statement, comment, prev: null, evidence, createdAt: new Date().toISOString() };
}

type ChainDraft = ReturnType<typeof makeRequest> | ReturnType<typeof makeLinkedReceipt>;
export type ReceiptDraft = ChainDraft | ReturnType<typeof makeSurveyReceipt> | ReturnType<typeof makeObservation>;
type ChainReceipt = { receipt: ChainDraft; index: Index };
export type PublicReceipt = { receipt: ReceiptDraft; index: Index };

export async function verifyPrepared(bytes: string, digest: string, expected: ReceiptDraft) {
  const parsed = JSON.parse(bytes);
  const { evidence, ...fields } = expected;
  const actualEvidence = parsed?.evidence;
  const matchingEvidence = evidence === null ? actualEvidence === null
    : actualEvidence && typeof actualEvidence === 'object' && !Array.isArray(actualEvidence) &&
      Object.keys(actualEvidence).length === Object.keys(evidence).length &&
      Object.entries(evidence).every(([field, value]) => actualEvidence[field] === value);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== Object.keys(expected).length ||
    !matchingEvidence || Object.entries(fields).some(([field, value]) => parsed[field] !== value) ||
    await digestBytes(new TextEncoder().encode(bytes).buffer) !== digest) {
    throw new FlowError('receipt-mismatch');
  }
}

export type ReturnContext = { first: string; counterparty: string };
export type Attempt = { bytes: string; digest: string; xdr: string; returning?: ReturnContext };

export function contributionLink(action: 'receipt' | 'continue', digest: string, mutual?: string) {
  return '/app?' + action + '=' + digest + (mutual ? '&mutual=' + mutual : '');
}

const attemptKey = (actor: string) => 'vespi-contributions:pending:' + actor;

export function storeAttempt(actor: string, attempt: Attempt) {
  try { localStorage.setItem(attemptKey(actor), JSON.stringify(attempt)); } catch {}
}

export async function loadAttempt(actor: string) {
  try {
    const attempt: Attempt = JSON.parse(localStorage.getItem(attemptKey(actor)) ?? 'null');
    if (!attempt || typeof attempt.bytes !== 'string' || typeof attempt.xdr !== 'string' ||
      !hashPattern.test(attempt.digest) || await digestBytes(new TextEncoder().encode(attempt.bytes).buffer) !== attempt.digest) return;
    const draft: ReturnType<typeof makeRequest> = JSON.parse(attempt.bytes);
    if (draft.kind !== 'REQUEST' || draft.actor !== actor || typeof draft.statement !== 'string' ||
      (draft.comment !== null && typeof draft.comment !== 'string')) return;
    return { attempt, draft };
  } catch {}
}

export function clearAttempt(actor: string, attempt: Attempt) {
  try {
    const key = attemptKey(actor);
    if (localStorage.getItem(key) === JSON.stringify(attempt)) localStorage.removeItem(key);
  } catch {}
}

export async function prepareRequest(draft: ReceiptDraft, signer: Signer, surveyDeadline?: number | null) {
  const { result } = await post<{ bytes: string; digest: string }>('/receipts/prepare', draft);
  if (!result.ok) throw new FlowError(result.reason);
  await verifyPrepared(result.bytes, result.digest, draft);
  const source = await fetch(horizon + '/accounts/' + signer.publicKey, { signal: AbortSignal.timeout(12_000) });
  if (!source.ok) throw new FlowError('account-unavailable');
  const { sequence } = await source.json();
  if (typeof sequence !== 'string' || !/^\d+$/.test(sequence)) throw new FlowError('account-unavailable');
  const maxTime = draft.kind === 'SURVEY' ? surveyMaxTime(Date.now(), surveyDeadline) : undefined;
  if (maxTime === null) throw new FlowError('survey-closed');
  const builder = new TransactionBuilder(new Account(signer.publicKey, sequence), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .addMemo(Memo.hash(result.digest));
  const tx = (maxTime === undefined ? builder.setTimeout(120) : builder.setTimebounds(0, maxTime)).build();
  await signTransaction(tx, signer);
  return { bytes: result.bytes, digest: result.digest, xdr: tx.toXDR() };
}

export async function anchorAttempt(attempt: Attempt, reference?: string) {
  // A survey supplies its private submission ID. A first delivery supplies the signed assignment.
  const binding = reference === undefined ? {} : JSON.parse(attempt.bytes).kind === 'SURVEY'
    ? { surveyId: reference } : { assignment: reference };
  const { result } = await post<{ index: Index }>('/receipts/anchor', { bytes: attempt.bytes, xdr: attempt.xdr, ...binding });
  if (!result.ok) throw new FlowError(result.reason);
  if (result.index.digest !== attempt.digest) throw new FlowError('receipt-mismatch');
  return result.index;
}

export async function readChainHead(root: string, signal: AbortSignal) {
  if (!hashPattern.test(root)) throw new FlowError('receipt-not-found');
  const response = await fetch(api + '/chains/' + root, { cache: 'no-store', signal });
  if (!response.ok) throw new FlowError('receipt-unavailable');
  const status: { request: string; head: string; kind: ReceiptDraft['kind'] } = await response.json();
  if (status.request !== root || !hashPattern.test(status.head)) throw new FlowError('receipt-mismatch');
  return status.head;
}

export function readReceipt(digest: string, signal: AbortSignal, scope: 'all'): Promise<PublicReceipt>;
export function readReceipt(digest: string, signal: AbortSignal): Promise<ChainReceipt>;
export async function readReceipt(digest: string, signal: AbortSignal, scope?: 'all'): Promise<PublicReceipt> {
  if (!hashPattern.test(digest)) throw new FlowError('receipt-not-found');
  const url = api + '/receipts/' + digest;
  const [receiptResponse, indexResponse] = await Promise.all([fetch(url, { signal }), fetch(url + '?format=index', { signal })]);
  if (receiptResponse.status === 404) throw new FlowError('receipt-not-found');
  if (!receiptResponse.ok || !indexResponse.ok) throw new FlowError('receipt-unavailable');

  const bytes = await receiptResponse.arrayBuffer();
  const index: Index = await indexResponse.json();
  if (index.digest !== digest || !hashPattern.test(index.txHash) || await digestBytes(bytes) !== digest) {
    throw new FlowError('receipt-mismatch');
  }
  const receipt: ReceiptDraft = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (receipt.kind === 'SURVEY' || receipt.kind === 'ATTEST' ? scope !== 'all' : !['REQUEST', 'CONTRIBUTE', 'ACCEPT'].includes(receipt.kind)) {
    throw new FlowError('receipt-not-found');
  }

  const response = await fetch(horizon + '/transactions/' + index.txHash, { signal });
  if (!response.ok) throw new FlowError('receipt-unavailable');
  const record: HorizonTransaction = await response.json();
  const tx = TransactionBuilder.fromXDR(record.envelope_xdr, Networks.TESTNET);
  if (!(tx instanceof FeeBumpTransaction) || !record.successful || record.hash !== index.txHash ||
    tx.hash().toString('hex') !== index.txHash || record.ledger !== index.ledger) {
    throw new FlowError('receipt-mismatch');
  }
  const inner = tx.innerTransaction;
  if (inner.source !== receipt.actor || inner.memo.type !== 'hash' || Buffer.from(inner.memo.value as Buffer).toString('hex') !== digest ||
    !inner.signatures.some(signature => Keypair.fromPublicKey(receipt.actor).verify(inner.hash(), signature.signature()))) {
    throw new FlowError('receipt-mismatch');
  }
  return { receipt, index };
}
export async function readObservationTarget(subject: string, signal: AbortSignal) {
  const delivery = await readReceipt(subject, signal);
  if (delivery.receipt.kind !== 'CONTRIBUTE') throw new FlowError('receipt-mismatch');
  const request = await readReceipt(delivery.receipt.chain, signal);
  if (request.receipt.kind !== 'REQUEST') throw new FlowError('receipt-mismatch');
  return { delivery, request };
}
