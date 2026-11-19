import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';
import { createEncounterRegistry, type StoredEncounter } from '@/lib/contributions/encounter-registry';
import {
  decisionMessage, encounterAccess, isEncounterId, parseDecisionNote, parseEncounterDraft, proposalMessage, sessionMessage,
  type Decision, type Encounter,
} from '@/lib/contributions/encounters';

export const dynamic = 'force-dynamic';
const cookie = 'vespi-encounters';
const lifetime = 7 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const digestPattern = /^[a-f0-9]{64}$/;
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (reason: string, status: number) => reply({ ok: false, reason }, status);

function verifies(account: string, payload: Uint8Array, signature: unknown): signature is string {
  return typeof signature === 'string' && /^[a-f0-9]{128}$/.test(signature) &&
    Keypair.fromPublicKey(account).verify(Buffer.from(payload), Buffer.from(signature, 'hex'));
}
function sessionAccount(value?: string) {
  if (!value) return null;
  const [account, expiry, signature, ...rest] = value.split('.');
  const expires = Number(expiry);
  if (rest.length || !StrKey.isValidEd25519PublicKey(account) || !Number.isSafeInteger(expires) ||
    expires <= now() || expires > now() + lifetime) return null;
  return verifies(account, sessionMessage(account, expires), signature) ? account : null;
}
function readSession(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(item => item.trim())
    .find(item => item.startsWith(cookie + '='))?.slice(cookie.length + 1);
  return sessionAccount(value);
}
function setSession(response: Response, request: Request, value: unknown, expected: string) {
  if (typeof value !== 'string' || sessionAccount(value) !== expected) return response;
  const secure = new URL(request.url).hostname === 'localhost' ? '' : '; Secure';
  response.headers.append('Set-Cookie', cookie + '=' + value + '; Path=/api/contributions/encounters; HttpOnly; SameSite=Lax; Max-Age=' + lifetime + secure);
  return response;
}
function invitationCode(row: StoredEncounter) {
  const key = process.env.CONTRIB_TOKEN_KEY;
  if (row.draft.inviteMode === 'link' && key) {
    return createHmac('sha256', key).update('vespi:encounter-claim:v1:' + row.id + ':' + row.proposalSignature).digest('hex');
  }
}
function validCode(row: StoredEncounter, input: unknown) {
  const code = invitationCode(row);
  return Boolean(code && typeof input === 'string' && digestPattern.test(input) &&
    timingSafeEqual(Buffer.from(input, 'hex'), Buffer.from(code, 'hex')));
}
function accessStatus(access: string) { return ['sign-in', 'claim-sign-in'].includes(access) ? 401 : 403; }

function view(row: StoredEncounter, viewer?: string | null): Encounter {
  const { id, draft, createdAt, decision, anchor, receiptToken } = row;
  const confirmed = decision?.choice === 'confirm';
  const status = !draft.b ? 'personal' : confirmed ? 'confirmed' : decision?.choice === 'correction' ? 'correction' :
    decision?.choice === 'declined' ? 'declined' : 'pending';
  const anchorCommitment = status === 'personal' || status === 'confirmed'
    ? createHash('sha256').update(JSON.stringify(['vespi:encuentro:anchor:v1:stellar:testnet',
      id, row.proposalSignature, decision?.signature ?? null])).digest('hex') : undefined;
  const code = viewer === draft.a.account && !decision ? invitationCode(row) : undefined;
  return { ...draft, id, createdAt, status, confirmed, revision: row.revision ?? (draft.revisionOf ? 2 : 1),
    inviteUrl: status === 'pending' && (draft.b?.account || code)
      ? '/app?encuentro=' + id + (code ? '#invitation=' + code : '') : undefined,
    note: decision?.note, respondedBy: decision?.person, anchor, anchorCommitment, receiptToken,
    proposalSignature: row.proposalSignature, decisionSignature: decision?.signature } as Encounter;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const registry = createEncounterRegistry(process.env);
  try {
    if (params.get('session') === '1') {
      const account = readSession(request);
      if (!account) return reply({ ok: true, profile: null });
      const profile = await createProfileRegistry(process.env).get(account);
      return reply({ ok: true, profile });
    }
    if (id !== null) {
      if (!isEncounterId(id)) return failure('not-found', 404);
      const record = await registry.get(id);
      if (!record) return failure('not-found', 404);
      const account = readSession(request);
      const access = encounterAccess(record.draft, Boolean(record.decision), account, {
        valid: validCode(record, request.headers.get('x-vespi-invitation')), respondent: record.decision?.person.account,
      });
      if (access !== 'allowed') return failure(access, accessStatus(access));
      return reply({ ok: true, encounter: view(record, account) });
    }
    const account = params.get('account');
    const cursor = params.get('cursor') ?? '0';
    if (!account || account !== readSession(request)) return failure('sign-in', 401);
    if (!/^\d{1,20}$/.test(cursor)) return failure('invalid-cursor', 400);
    const listed = await registry.list(account, cursor);
    return reply({ ok: true, cursor: listed.cursor, entries: listed.entries.map(row => view(row, account)) });
  } catch {
    return failure('unavailable', 503);
  }
}

export async function POST(request: Request) {
  let body: { action?: string; id?: unknown; draft?: unknown; signature?: unknown; session?: unknown;
    choice?: Decision; note?: unknown; receipt?: unknown; account?: unknown; invitation?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 30_000) return failure('invalid-input', 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return failure('invalid-input', 400);
  } catch { return failure('invalid-input', 400); }

  if (body.action === 'logout') {
    const response = reply({ ok: true });
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    response.headers.append('Set-Cookie', cookie + '=; Path=/api/contributions/encounters; HttpOnly; SameSite=Lax; Max-Age=0' + secure);
    return response;
  }
  if (body.action === 'session') {
    const account = typeof body.session === 'string' ? sessionAccount(body.session) : null;
    return account ? setSession(reply({ ok: true }), request, body.session, account) : failure('sign-in', 401);
  }
  const id = body.id;
  if (!isEncounterId(id)) return failure('invalid-id', 400);
  const registry = createEncounterRegistry(process.env);
  try {
    if (body.action === 'publish') {
      let draft;
      try { draft = parseEncounterDraft(body.draft); }
      catch { return failure('invalid-encounter', 400); }
      const { a, b } = draft;
      if (b && !b.account && draft.inviteMode !== 'link') return failure('recipient-required', 400);
      if (draft.inviteMode === 'link' && !process.env.CONTRIB_TOKEN_KEY) return failure('unavailable', 503);
      if (!verifies(a.account, proposalMessage(id, draft), body.signature)) return failure('signature', 403);
      const profiles = createProfileRegistry(process.env);
      const names = await Promise.all([profiles.get(a.account), b?.account ? profiles.get(b.account) : null]);
      if (names[0]?.displayName !== a.displayName || (b?.account && names[1]?.displayName !== b.displayName)) return failure('profile', 400);
      let revision = 1;
      if (draft.revisionOf) {
        const previous = await registry.get(draft.revisionOf);
        if (!previous || previous.draft.a.account !== a.account || previous.decision?.choice !== 'correction' ||
          previous.decision.person.account !== b?.account) return failure('invalid-revision', 400);
        revision = (previous.revision ?? (previous.draft.revisionOf ? 2 : 1)) + 1;
      }
      const record = { id, draft, revision, createdAt: new Date().toISOString(), proposalSignature: body.signature };
      const saved = await registry.create(record) ? record : await registry.get(id);
      if (!saved || saved.proposalSignature !== body.signature) return failure('conflict', 409);
      return setSession(reply({ ok: true, encounter: view(saved, a.account) }), request, body.session, a.account);
    }
    const existing = await registry.get(id);
    if (!existing) return failure('not-found', 404);
    if (body.action === 'respond') {
      const recipient = body.account;
      const invited = existing.draft.b;
      if (!invited || typeof recipient !== 'string' || !StrKey.isValidEd25519PublicKey(recipient) ||
        recipient === existing.draft.a.account) return failure('signature', 403);
      const mayRespond = existing.draft.inviteMode === 'link'
        ? readSession(request) === recipient && validCode(existing, body.invitation) &&
          (!existing.decision || existing.decision.person.account === recipient)
        : invited.account === recipient;
      if (!mayRespond) return failure('signature', 403);
      const choice = body.choice;
      if (!recipient || (choice !== 'confirm' && choice !== 'correction' && choice !== 'declined')) return failure('invalid-decision', 400);
      let note: string;
      try { note = parseDecisionNote(body.note); }
      catch { return failure('invalid-note', 400); }
      if (choice === 'correction' && !note) return failure('missing-correction', 400);
      if (!verifies(recipient, decisionMessage(id, existing.proposalSignature, choice, note), body.signature)) return failure('signature', 403);
      const person = await createProfileRegistry(process.env).get(recipient);
      if (!person) return failure('profile', 400);
      const decision = { choice, note, signature: body.signature, person };
      const saved = await registry.update(id, 'decision', decision) ? { ...existing, decision } : await registry.get(id);
      if (!saved || saved.decision?.signature !== body.signature) return failure('already-reviewed', 409);
      return setSession(reply({ ok: true, encounter: view(saved) }), request, body.session, recipient);
    }
    if (body.action === 'anchor') {
      const access = encounterAccess(existing.draft, Boolean(existing.decision), readSession(request), {
        valid: false, respondent: existing.decision?.person.account,
      });
      if (access !== 'allowed') return failure(access, accessStatus(access));
      const { anchor, anchorCommitment } = view(existing);
      if (anchor) return reply({ ok: true, encounter: view(existing) });
      if (!anchorCommitment || typeof body.receipt !== 'string' || !digestPattern.test(body.receipt)) return failure('invalid-anchor', 400);
      const receipt = await createReceiptRegistry(process.env).get(body.receipt);
      if (!receipt?.index || receipt.index.network !== 'stellar:testnet') return failure('unverified-anchor', 400);
      const value = parseContribution(receipt.intent.bytes);
      if (value.kind !== 'REQUEST' || value.actor !== (existing.decision?.person.account ?? existing.draft.a.account) ||
        value.comment !== 'vespi:encuentro:' + anchorCommitment) return failure('unverified-anchor', 400);
      const receiptToken = createHash('sha256').update('vespi:encuentro:proof:' + anchorCommitment).digest('hex').slice(0, 32);
      const saved = await registry.update(id, 'anchor', body.receipt, receiptToken)
        ? { ...existing, anchor: body.receipt, receiptToken } : await registry.get(id);
      return saved ? reply({ ok: true, encounter: view(saved) }) : failure('not-found', 404);
    }
    return failure('invalid-action', 400);
  } catch {
    return failure('unavailable', 503);
  }
}
