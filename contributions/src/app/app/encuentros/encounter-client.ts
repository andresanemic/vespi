import { Buffer } from 'buffer';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { Signer } from '@/lib/contributions/keys';
import { decisionMessage, parseDecisionNote, parseEncounterDraft, proposalMessage, sessionMessage,
  type Decision, type Encounter, type EncounterDraft } from '@/lib/contributions/encounters';
import { anchorAttempt, digestBytes, FlowError, makeRequest, post, prepareRequest, verifyPrepared, type Attempt } from '../client';

type SignedEncounter = Encounter & { proposalSignature: string; decisionSignature?: string };

function checked(record: SignedEncounter): SignedEncounter {
  const proof = (account: string, message: Uint8Array, signature: string) =>
    /^[a-f0-9]{128}$/.test(signature) && Keypair.fromPublicKey(account).verify(Buffer.from(message), Buffer.from(signature, 'hex'));
  if (!proof(record.a.account, proposalMessage(record.id, record), record.proposalSignature)) throw new FlowError('signature');
  if (record.status === 'confirmed' || record.status === 'correction' || record.status === 'declined') {
    const choice = record.status === 'confirmed' ? 'confirm' : record.status;
    if (!record.b || !record.respondedBy || !record.decisionSignature || !proof(record.respondedBy.account,
      decisionMessage(record.id, record.proposalSignature, choice, record.note ?? ''), record.decisionSignature)) throw new FlowError('signature');
  }
  return record;
}

async function signature(signer: Signer, bytes: Uint8Array) {
  return Buffer.from(await signer.sign(bytes)).toString('hex');
}

async function session(signer: Signer) {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  return signer.publicKey + '.' + expires + '.' + await signature(signer, sessionMessage(signer.publicKey, expires));
}

export async function openEncounterSession(signer: Signer) {
  const { result } = await post('/encounters', { action: 'session', session: await session(signer) });
  if (!result.ok) throw new FlowError(result.reason);
}

async function write(input: object) {
  const { result } = await post<{ encounter: SignedEncounter }>('/encounters', input);
  if (!result.ok) throw new FlowError(result.reason);
  return checked(result.encounter);
}

async function read<T>(params: URLSearchParams, invitation?: string) {
  const response = await fetch('/api/contributions/encounters?' + params, { cache: 'no-store', signal: AbortSignal.timeout(20_000),
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

export async function readEncounter(id: string) {
  return checked((await read<{ encounter: SignedEncounter }>(new URLSearchParams({ id }), invitationFromLocation(id))).encounter);
}

export async function listEncounters(account: string, cursor = '0') {
  const page = await read<{ entries: SignedEncounter[]; cursor: string }>(new URLSearchParams({ account, cursor }));
  return { entries: page.entries.map(checked), cursor: page.cursor };
}

export async function publishEncounter(input: EncounterDraft, signer: Signer) {
  const draft = parseEncounterDraft(input);
  const draftKey = 'vespi-encounter:publishing:' + await digestBytes(new TextEncoder().encode(JSON.stringify(draft)).buffer);
  let id: string = crypto.randomUUID().replaceAll('-', '');
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) id = saved;
    else localStorage.setItem(draftKey, id);
  } catch {}
  const encounter = await write({ action: 'publish', id, draft, signature: await signature(signer, proposalMessage(id, draft)),
    session: await session(signer) });
  try { localStorage.removeItem(draftKey); } catch {}
  return encounter;
}

export async function respondEncounter(encounter: Encounter, signer: Signer, choice: Decision, input = '') {
  const note = parseDecisionNote(input);
  const record = await readEncounter(encounter.id);
  return write({ action: 'respond', id: record.id, account: signer.publicKey, choice, note,
    signature: await signature(signer, decisionMessage(record.id, record.proposalSignature, choice, note)),
    invitation: invitationFromLocation(record.id), session: await session(signer) });
}

export function confirmEncounter(encounter: Encounter, signer: Signer) {
  return respondEncounter(encounter, signer, 'confirm');
}

export async function anchorEncounter(encounter: Encounter, signer: Signer) {
  const { id, anchorCommitment, status, anchor } = await readEncounter(encounter.id);
  if (anchor) return readEncounter(id);
  if (!anchorCommitment || (status !== 'confirmed' && status !== 'personal')) throw new FlowError('pending');
  const key = 'vespi-encounter:anchor:' + id;
  const draft = makeRequest(signer.publicKey, 'Huella de un registro de Vespi Contributions',
    'vespi:encuentro:' + anchorCommitment);
  draft.createdAt = encounter.createdAt;
  let attempt: Attempt | undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Attempt | null;
    if (saved) {
      draft.createdAt = JSON.parse(saved.bytes).createdAt;
      await verifyPrepared(saved.bytes, saved.digest, draft);
      attempt = saved;
    }
  } catch {}
  try {
    if (!attempt) {
      attempt = await prepareRequest(draft, signer);
      try { localStorage.setItem(key, JSON.stringify(attempt)); } catch {}
    }
    const index = await anchorAttempt(attempt);
    const saved = await write({ action: 'anchor', id, receipt: index.digest });
    try { localStorage.removeItem(key); } catch {}
    return saved;
  } catch (error) {
    if (error instanceof FlowError && ['invalid-timebound', 'inner-failed', 'retry-with-fresh-transaction', 'fresh'].includes(error.message)) {
      try { localStorage.removeItem(key); } catch {}
    }
    throw error;
  }
}
