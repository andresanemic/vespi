import { Account, BASE_FEE, StrKey, FeeBumpTransaction, Keypair, Memo, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { Buffer } from 'buffer';
import { surveyMaxTime } from './encuesta/timebound';
import { profileMessage } from '@/lib/contributions/profile-authorization';
import { photoUploadMessage } from '@/lib/contributions/photo-authorization';
import { signTransaction, type Signer } from '@/lib/contributions/keys';
import { contributionNetwork, DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { focusRoot } from '@/lib/contributions/focus-event';

const api = '/api/contributions';
const hashPattern = /^[0-9a-f]{64}$/;

type Reply<T> = ({ ok: true } & T) | { ok: false; reason: string };
type Index = { digest: string; txHash: string; ledger: number; rehearsal: boolean };
type HorizonTransaction = { envelope_xdr: string; successful: boolean; hash: string; ledger: number };

export class FlowError extends Error {}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function withContributionNetwork(path: string, network = DEFAULT_NETWORK) {
  return network === DEFAULT_NETWORK ? path : path + (path.includes('?') ? '&' : '?') + 'network=' + network;
}

export async function canUseMainnet(account: string, signal = AbortSignal.timeout(12_000)) {
  const response = await fetch(api + '/network?account=' + encodeURIComponent(account), { cache: 'no-store', signal });
  if (!response.ok) throw new FlowError('mainnet-unavailable');
  return (await response.json()).mainnet === true;
}

const encounterWrites = new Map<ContributionNetwork, Promise<unknown>>();
const encounterSessions = new Map<ContributionNetwork, { account: string; sessionId: string }>();
const encounterSessionKey = (network: ContributionNetwork) => 'vespi-encounter:session:' + network;
const closingSessionKey = (network: ContributionNetwork) => 'vespi-encounter:closing:' + network;

function encounterSession(network: ContributionNetwork) {
  let raw: string | null;
  try { raw = localStorage.getItem(encounterSessionKey(network)); }
  catch { return encounterSessions.get(network); }
  try {
    const reference = raw && JSON.parse(raw);
    if (reference && typeof reference.account === 'string' && StrKey.isValidEd25519PublicKey(reference.account) &&
      typeof reference.sessionId === 'string' && /^[a-f0-9]{32}$/.test(reference.sessionId)) {
      return reference as { account: string; sessionId: string };
    }
  } catch {}
}

export function encounterSessionId(account: string, network: ContributionNetwork) {
  const current = encounterSession(network);
  if (current?.account === account) return current.sessionId;
  const sessionId = crypto.randomUUID().replaceAll('-', '');
  const reference = { account, sessionId };
  encounterSessions.set(network, reference);
  try { localStorage.setItem(encounterSessionKey(network), JSON.stringify(reference)); } catch {}
  return sessionId;
}

export function forgetEncounterSession(sessionId: string, network: ContributionNetwork) {
  if (encounterSession(network)?.sessionId !== sessionId) return;
  encounterSessions.delete(network);
  try { localStorage.removeItem(encounterSessionKey(network)); } catch {}
}

function serializeEncounterWrite<T>(network: ContributionNetwork, send: () => Promise<T>) {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('vespi-encounters:' + network, send);
  const pending = (encounterWrites.get(network) ?? Promise.resolve()).then(send);
  encounterWrites.set(network, pending.catch(() => {}));
  return pending;
}

async function sendEncounterLogout(network: ContributionNetwork, body: object, saved?: string) {
  const { result } = await postJson('/encounters', body, network, true);
  if (!result.ok || !saved) return;
  try {
    const key = closingSessionKey(network);
    if (localStorage.getItem(key) === saved) localStorage.removeItem(key);
  } catch {}
}

export function closeEncounterSession(network: ContributionNetwork, account?: string) {
  const reference = encounterSession(network);
  const target = reference && (!account || reference.account === account) ? reference : { account };
  const body = { action: 'logout', ...target };
  const saved = 'sessionId' in target ? JSON.stringify(body) : undefined;
  try {
    if (target === reference) localStorage.removeItem(encounterSessionKey(network));
    if (saved) localStorage.setItem(closingSessionKey(network), saved);
  } catch {}
  if (target === reference) encounterSessions.delete(network);
  const sent = sendEncounterLogout(network, body, saved).catch(() => {});
  // Send now, then queue a barrier for later writes in this document and other tabs.
  void serializeEncounterWrite(network, () => sent);
  return sent;
}

export function post<T>(path: string, body: object, network = DEFAULT_NETWORK, keepalive = false) {
  const send = () => postJson<T>(path, body, network, keepalive);
  const action = 'action' in body && body.action;
  if (path !== '/encounters' || !['session', 'publish', 'respond'].some(value => value === action)) return send();
  return serializeEncounterWrite(network, async () => {
    let closing: string | null = null;
    try { closing = localStorage.getItem(closingSessionKey(network)); } catch {}
    // A reload can drop the lock while the keepalive is still in flight. The targeted close is idempotent.
    if (closing) {
      try { await sendEncounterLogout(network, JSON.parse(closing), closing); } catch {}
    }
    return send();
  });
}

async function postJson<T>(path: string, body: object, network: ContributionNetwork, keepalive: boolean) {
  const response = await fetch(withContributionNetwork(api + path, network), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    keepalive,
  });
  const result: Reply<T> = await response.json();
  return { result, retryAfter: Number(response.headers.get('Retry-After')) || 2 };
}

export async function onboard(signer: Signer, network = DEFAULT_NETWORK) {
  const until = Date.now() + 70_000;
  do {
    const { result, retryAfter } = await post<{ xdr: string; token: string }>('/account', {
      action: 'prepare', publicKey: signer.publicKey,
    }, network);
    if (!result.ok) {
      if (result.reason === 'already-onboarded') return;
      if (result.reason !== 'busy' && result.reason !== 'rate_limited') throw new FlowError(result.reason);
      await pause(retryAfter * 1000);
      continue;
    }
    const tx = new Transaction(result.xdr, contributionNetwork(network).passphrase);
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
    }, network);
    if (completed.ok || completed.reason === 'already-onboarded') return;
    if (completed.reason !== 'retry') throw new FlowError(completed.reason);
    await pause(1000);
  } while (Date.now() < until);
  throw new FlowError('busy');
}

export function validDisplayName(name: string) {
  return !!name && [...name].length <= 40 && !/[\p{Cc}\p{Cf}]/u.test(name);
}

export async function getDisplayName(account: string, network = DEFAULT_NETWORK) {
  const response = await fetch(withContributionNetwork(api + '/profiles/' + account, network), {
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

export async function readProfilePage(cursor: string, network = DEFAULT_NETWORK) {
  const response = await fetch(withContributionNetwork(api + '/profiles?cursor=' + encodeURIComponent(cursor), network), {
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

export async function publishDisplayName(signer: Signer, displayName: string, network = DEFAULT_NETWORK) {
  const account = signer.publicKey;
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const signature = Buffer.from(await signer.sign(profileMessage(account, displayName, expiresAt, network))).toString('hex');
  const { result } = await post('/profiles', { account, displayName, expiresAt, signature }, network);
  if (result.ok) return displayName;
  if (result.reason === 'profile-exists') {
    const existing = await getDisplayName(account, network);
    if (existing !== null) return existing;
  }
  throw new FlowError(network === 'mainnet' && (result.reason === 'account-not-allowed' || result.reason === 'mainnet-unavailable')
    ? result.reason : 'profile-unavailable');
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
export type Attempt = { bytes: string; digest: string; xdr: string; returning?: ReturnContext; network?: 'mainnet' };

export function contributionLink(action: 'receipt' | 'continue', digest: string, mutual?: string, network = DEFAULT_NETWORK) {
  return withContributionNetwork('/app?' + action + '=' + digest + (mutual ? '&mutual=' + mutual : ''), network);
}

const attemptKey = (actor: string, network = DEFAULT_NETWORK, focusRecord = false) =>
  'vespi-contributions:pending:' + actor + (focusRecord ? ':focus-group' : network === 'mainnet' ? ':mainnet' : '');

export function storeAttempt(actor: string, attempt: Attempt, focusRecord = false) {
  try { localStorage.setItem(attemptKey(actor, attempt.network, focusRecord), JSON.stringify(attempt)); } catch {}
}

export async function loadAttempt(actor: string, network = DEFAULT_NETWORK, focusRecord = false) {
  try {
    const attempt: Attempt = JSON.parse(localStorage.getItem(attemptKey(actor, network, focusRecord)) ?? 'null');
    if (!attempt || typeof attempt.bytes !== 'string' || typeof attempt.xdr !== 'string' ||
      (attempt.network ?? DEFAULT_NETWORK) !== network ||
      !hashPattern.test(attempt.digest) || await digestBytes(new TextEncoder().encode(attempt.bytes).buffer) !== attempt.digest) return;
    const draft: ReturnType<typeof makeRequest> = JSON.parse(attempt.bytes);
    if (draft.kind !== 'REQUEST' || draft.actor !== actor || typeof draft.statement !== 'string' ||
      (draft.comment !== null && typeof draft.comment !== 'string')) return;
    return { attempt, draft };
  } catch {}
}

export function clearAttempt(actor: string, attempt: Attempt, focusRecord = false) {
  try {
    const key = attemptKey(actor, attempt.network, focusRecord);
    if (localStorage.getItem(key) === JSON.stringify(attempt)) localStorage.removeItem(key);
  } catch {}
}

export async function prepareRequest(draft: ReceiptDraft, signer: Signer, surveyDeadline?: number | null, network = DEFAULT_NETWORK): Promise<Attempt> {
  const { horizon, passphrase } = contributionNetwork(network);
  const { result } = await post<{ bytes: string; digest: string }>('/receipts/prepare', draft, network);
  if (!result.ok) throw new FlowError(result.reason);
  await verifyPrepared(result.bytes, result.digest, draft);
  const accountUrl = horizon + '/accounts/' + signer.publicKey;
  let source = await fetch(accountUrl, { signal: AbortSignal.timeout(12_000) });
  if (network === 'mainnet' && source.status === 404) {
    await onboard(signer, network);
    source = await fetch(accountUrl, { signal: AbortSignal.timeout(12_000) });
  }
  if (network === DEFAULT_NETWORK && source.status === 404) throw new FlowError('testnet-account-missing');
  if (!source.ok) throw new FlowError('account-unavailable');
  const { sequence } = await source.json();
  if (typeof sequence !== 'string' || !/^\d+$/.test(sequence)) throw new FlowError('account-unavailable');
  const maxTime = draft.kind === 'SURVEY' ? surveyMaxTime(Date.now(), surveyDeadline) : undefined;
  if (maxTime === null) throw new FlowError('survey-closed');
  const builder = new TransactionBuilder(new Account(signer.publicKey, sequence), { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .addMemo(Memo.hash(result.digest));
  const tx = (maxTime === undefined ? builder.setTimeout(120) : builder.setTimebounds(0, maxTime)).build();
  await signTransaction(tx, signer);
  return { bytes: result.bytes, digest: result.digest, xdr: tx.toXDR(), ...(network === 'mainnet' && { network }) };
}

export async function anchorAttempt(attempt: Attempt, reference?: string) {
  // A survey supplies its private submission ID. A first delivery supplies the signed assignment.
  const binding = reference === undefined ? {} : JSON.parse(attempt.bytes).kind === 'SURVEY'
    ? { surveyId: reference } : { assignment: reference };
  const { result } = await post<{ index: Index }>('/receipts/anchor',
    { bytes: attempt.bytes, xdr: attempt.xdr, ...binding }, attempt.network);
  if (!result.ok) throw new FlowError(result.reason);
  if (result.index.digest !== attempt.digest) throw new FlowError('receipt-mismatch');
  return result.index;
}

export async function readChainHead(root: string, signal: AbortSignal, network = DEFAULT_NETWORK) {
  if (!hashPattern.test(root)) throw new FlowError('receipt-not-found');
  const response = await fetch(withContributionNetwork(api + '/chains/' + root, network), { cache: 'no-store', signal });
  if (!response.ok) throw new FlowError(network === 'mainnet' && response.status === 503 ? 'mainnet-unavailable' : 'receipt-unavailable');
  const status: { request: string; head: string; kind: ReceiptDraft['kind'] } = await response.json();
  if (status.request !== root || !hashPattern.test(status.head)) throw new FlowError('receipt-mismatch');
  return status.head;
}

export function readReceipt(digest: string, signal: AbortSignal, scope: 'all', network?: ContributionNetwork): Promise<PublicReceipt>;
export function readReceipt(digest: string, signal: AbortSignal, scope?: undefined, network?: ContributionNetwork): Promise<ChainReceipt>;
export async function readReceipt(digest: string, signal: AbortSignal, scope?: 'all', network = DEFAULT_NETWORK): Promise<PublicReceipt> {
  if (!hashPattern.test(digest)) throw new FlowError('receipt-not-found');
  const url = api + '/receipts/' + digest;
  const [receiptResponse, indexResponse] = await Promise.all([
    fetch(withContributionNetwork(url, network), { signal }),
    fetch(withContributionNetwork(url + '?format=index', network), { signal }),
  ]);
  if (receiptResponse.status === 404) throw new FlowError('receipt-not-found');
  if (network === 'mainnet' && (receiptResponse.status === 503 || indexResponse.status === 503)) throw new FlowError('mainnet-unavailable');
  if (!receiptResponse.ok || !indexResponse.ok) throw new FlowError('receipt-unavailable');

  const bytes = await receiptResponse.arrayBuffer();
  const index: Index = await indexResponse.json();
  if (index.digest !== digest || !hashPattern.test(index.txHash) || await digestBytes(bytes) !== digest) {
    throw new FlowError('receipt-mismatch');
  }
  const receipt: ReceiptDraft = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (receipt.kind === 'SURVEY' || receipt.kind === 'ATTEST' ? scope !== 'all' || network === 'mainnet'
    : !['REQUEST', 'CONTRIBUTE', 'ACCEPT'].includes(receipt.kind)) {
    throw new FlowError('receipt-not-found');
  }

  const { horizon, passphrase } = contributionNetwork(network);
  const response = await fetch(horizon + '/transactions/' + index.txHash, { signal });
  if (!response.ok) throw new FlowError('receipt-unavailable');
  const record: HorizonTransaction = await response.json();
  const tx = TransactionBuilder.fromXDR(record.envelope_xdr, passphrase);
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
  if (subject === focusRoot && delivery.receipt.kind === 'REQUEST') return { request: delivery };
  if (delivery.receipt.kind !== 'CONTRIBUTE') throw new FlowError('receipt-mismatch');
  const request = await readReceipt(delivery.receipt.chain, signal);
  if (request.receipt.kind !== 'REQUEST') throw new FlowError('receipt-mismatch');
  return { delivery, request };
}
