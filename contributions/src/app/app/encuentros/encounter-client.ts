import { Buffer } from 'buffer';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { Signer } from '@/lib/contributions/keys';
import { decisionMessage, encounterFingerprintStatement, parseDecisionNote, parseEncounterDraft, proposalMessage, sessionMessage,
  type Decision, type Encounter, type EncounterDraft } from '@/lib/contributions/encounters';
import { DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { anchorAttempt, digestBytes, encounterSessionId, FlowError, forgetEncounterSession, makeRequest, post, prepareRequest, verifyPrepared, withContributionNetwork, type Attempt } from '../client';

type SignedEncounter = Encounter & { proposalSignature: string; decisionSignature?: string };

function checked(record: SignedEncounter, network: ContributionNetwork): SignedEncounter {
  const proof = (account: string, message: Uint8Array, signature: string) =>
    /^[a-f0-9]{128}$/.test(signature) && Keypair.fromPublicKey(account).verify(Buffer.from(message), Buffer.from(signature, 'hex'));
  if (!proof(record.a.account, proposalMessage(record.id, record, network), record.proposalSignature)) throw new FlowError('signature');
  if (record.status === 'confirmed' || record.status === 'correction' || record.status === 'declined') {
    const choice = record.status === 'confirmed' ? 'confirm' : record.status;
    if (!record.b || !record.respondedBy || !record.decisionSignature || !proof(record.respondedBy.account,
      decisionMessage(record.id, record.proposalSignature, choice, record.note ?? '', network), record.decisionSignature)) throw new FlowError('signature');
  }
  return record;
}

async function signature(signer: Signer, bytes: Uint8Array) {
  return Buffer.from(await signer.sign(bytes)).toString('hex');
}

async function session(signer: Signer, network: ContributionNetwork) {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const sessionId = encounterSessionId(signer.publicKey, network);
  const signed = await signature(signer, sessionMessage(signer.publicKey, expires, network, sessionId));
  return [signer.publicKey, expires, signed, sessionId].join('.');
}

export async function openEncounterSession(signer: Signer, network = DEFAULT_NETWORK) {
  const sessionId = encounterSessionId(signer.publicKey, network);
  let { result } = await post('/encounters', { action: 'session', session: await session(signer, network) }, network);
  if (!result.ok && result.reason === 'session-closed') {
    // Another tab closed this session without clearing the local reference: start a new one, once.
    forgetEncounterSession(sessionId, network);
    ({ result } = await post('/encounters', { action: 'session', session: await session(signer, network) }, network));
  }
  if (!result.ok) throw new FlowError(result.reason);
}

async function write(input: object, network: ContributionNetwork) {
  const { result } = await post<{ encounter: SignedEncounter }>('/encounters', input, network);
  if (!result.ok) throw new FlowError(result.reason);
  return checked(result.encounter, network);
}

async function read<T>(params: URLSearchParams, network: ContributionNetwork, invitation?: string) {
  const response = await fetch(withContributionNetwork('/api/contributions/encounters?' + params, network), { cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: invitation ? { 'X-Vespi-Invitation': invitation } : undefined });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new FlowError(body.reason ?? 'unavailable');
  return body as T;
}

export function invitationFromLocation(id: string) {
  const url = new URL(location.href);
  if (url.searchParams.get('encuentro') !== id) return;
  const code = new URLSearchParams(url.hash.slice(1)).get('invitation');
  return code && /^[a-f0-9]{64}$/.test(code) ? code : undefined;
}

export async function readEncounter(id: string, network = DEFAULT_NETWORK) {
  const { encounter } = await read<{ encounter: SignedEncounter }>(new URLSearchParams({ id }), network, invitationFromLocation(id));
  return checked(encounter, network);
}

export async function listEncounters(account: string, cursor = '0', network = DEFAULT_NETWORK) {
  const page = await read<{ entries: SignedEncounter[]; cursor: string }>(new URLSearchParams({ account, cursor }), network);
  return { entries: page.entries.map(record => checked(record, network)), cursor: page.cursor };
}

export async function publishEncounter(input: EncounterDraft, signer: Signer, network = DEFAULT_NETWORK) {
  const draft = parseEncounterDraft(input);
  const draftKey = 'vespi-encounter:publishing:' + (network === 'mainnet' ? 'mainnet:' : '') +
    await digestBytes(new TextEncoder().encode(JSON.stringify(draft)).buffer);
  let id: string = crypto.randomUUID().replaceAll('-', '');
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) id = saved;
    else localStorage.setItem(draftKey, id);
  } catch {}
  const encounter = await write({ action: 'publish', id, draft, signature: await signature(signer, proposalMessage(id, draft, network)),
    session: await session(signer, network) }, network);
  try { localStorage.removeItem(draftKey); } catch {}
  return encounter;
}

export async function respondEncounter(encounter: Encounter, signer: Signer, choice: Decision, input = '', network = DEFAULT_NETWORK) {
  const note = parseDecisionNote(input);
  const record = await readEncounter(encounter.id, network);
  return write({ action: 'respond', id: record.id, account: signer.publicKey, choice, note,
    signature: await signature(signer, decisionMessage(record.id, record.proposalSignature, choice, note, network)),
    invitation: invitationFromLocation(record.id), session: await session(signer, network) }, network);
}

export function confirmEncounter(encounter: Encounter, signer: Signer, network = DEFAULT_NETWORK) {
  return respondEncounter(encounter, signer, 'confirm', '', network);
}

export async function anchorEncounter(encounter: Encounter, signer: Signer, network = DEFAULT_NETWORK) {
  const record = await readEncounter(encounter.id, network);
  const { id, anchorCommitment, status, anchor } = record;
  if (anchor) return network === DEFAULT_NETWORK ? readEncounter(id, network) : record;
  if (!anchorCommitment || (status !== 'confirmed' && status !== 'personal')) throw new FlowError('pending');
  const key = 'vespi-encounter:anchor:' + (network === 'mainnet' ? 'mainnet:' : '') + id;
  const draft = makeRequest(signer.publicKey, encounterFingerprintStatement, 'vespi:encuentro:' + anchorCommitment);
  draft.createdAt = network === DEFAULT_NETWORK ? encounter.createdAt : record.createdAt;
  let attempt: Attempt | undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Attempt | null;
    if (saved && (saved.network ?? DEFAULT_NETWORK) === network) {
      draft.createdAt = JSON.parse(saved.bytes).createdAt;
      await verifyPrepared(saved.bytes, saved.digest, draft);
      attempt = saved;
    }
  } catch {}
  try {
    if (network !== DEFAULT_NETWORK && attempt && draft.createdAt !== record.createdAt) {
      // shortcut: pre-existing mainnet attempts have a different digest, drop this path after they are reconciled.
      const latest = await readEncounter(id, network);
      if (latest.anchor) return latest;
    }
    if (!attempt) {
      attempt = await prepareRequest(draft, signer, undefined, network);
      try { localStorage.setItem(key, JSON.stringify(attempt)); } catch {}
    }
    const index = await anchorAttempt(attempt);
    const saved = await write({ action: 'anchor', id, receipt: index.digest }, network);
    try { localStorage.removeItem(key); } catch {}
    return saved;
  } catch (error) {
    if (error instanceof FlowError && ['invalid-timebound', 'inner-failed', 'retry-with-fresh-transaction', 'fresh'].includes(error.message)) {
      try { localStorage.removeItem(key); } catch {}
    }
    throw error;
  }
}
