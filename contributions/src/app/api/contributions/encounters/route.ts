import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import { contributionNetwork, DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { accountNotAllowed, readContributionNetwork, requestContributionNetwork } from '@/lib/contributions/network-request';
import { contributionsTokenKey, tokenKeyHasMinimumBytes } from '@/lib/contributions/redis-credentials.mjs';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';
import { createEncounterRegistry, type StoredEncounter } from '@/lib/contributions/encounter-registry';
import { verifiesEncounterSignature } from '@/lib/contributions/encounter-signatures';
import { signedPublicEncounter } from '@/lib/contributions/public-encounters';
import {
  decisionMessage, deriveRecordTitle, encounterAccess, encounterAnchorMessage, isEncounterFingerprint, isEncounterId, parseDecisionNote, parseEncounterDraft, proposalMessage, sessionMessage,
  type Decision, type Encounter, type EncounterDraft,
} from '@/lib/contributions/encounters';

export const dynamic = 'force-dynamic';
const cookie = (network: ContributionNetwork) => network === DEFAULT_NETWORK ? 'vespi-encounters' : `vespi-encounters-${contributionNetwork(network).segment}`;
const lifetime = 7 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const digestPattern = /^[a-f0-9]{64}$/;
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (reason: string, status: number) => reply({ ok: false, reason }, status);

function parseSession(network: ContributionNetwork, value?: string) {
  if (!value) return null;
  const [account, expiry, signature, sessionId, ...rest] = value.split('.');
  const expires = Number(expiry);
  if (rest.length || !StrKey.isValidEd25519PublicKey(account) || !Number.isSafeInteger(expires) ||
    expires <= now() || expires > now() + lifetime || (sessionId !== undefined && !isEncounterId(sessionId))) return null;
  return verifiesEncounterSignature(account, sessionMessage(account, expires, network, sessionId), signature) ? { account, sessionId } : null;
}

function readCookie(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map(item => item.trim())
    .find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}

function sessionCookie(network: ContributionNetwork, reference: string) {
  return cookie(network) + '-' + createHash('sha256').update(reference).digest('hex').slice(0, 32);
}

function sessionReference(account: unknown, sessionId: unknown) {
  return typeof account === 'string' && StrKey.isValidEd25519PublicKey(account) && isEncounterId(sessionId)
    ? account + '.' + sessionId : undefined;
}

function currentReference(request: Request, network: ContributionNetwork) {
  const [account, sessionId, extra] = (readCookie(request, cookie(network) + '-current') ?? '').split('.');
  return extra === undefined ? sessionReference(account, sessionId) : undefined;
}

function readSession(request: Request, network: ContributionNetwork) {
  const current = currentReference(request, network);
  if (!current) {
    const legacy = parseSession(network, readCookie(request, cookie(network)));
    return legacy && !legacy.sessionId ? legacy.account : null;
  }
  const name = sessionCookie(network, current);
  if (readCookie(request, name + '-closed')) return null;
  const session = parseSession(network, readCookie(request, name));
  return session && sessionReference(session.account, session.sessionId) === current ? session.account : null;
}

function writeCookie(response: Response, request: Request, name: string, value: string, maxAge: number) {
  const { hostname, protocol } = new URL(request.url);
  const secure = hostname !== 'localhost' || protocol === 'https:' ? '; Secure' : '';
  response.headers.append('Set-Cookie', name + '=' + value + '; Path=/api/contributions/encounters; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secure);
}

function setSession(response: Response, request: Request, value: unknown, expected: string, network: ContributionNetwork) {
  const session = typeof value === 'string' && parseSession(network, value);
  if (!session || session.account !== expected || typeof value !== 'string') return response;
  const reference = sessionReference(session.account, session.sessionId);
  if (reference) {
    const name = sessionCookie(network, reference);
    if (readCookie(request, name + '-closed')) return response;
    // Only one credential stays in the browser: the previous one and the older format expire here.
    const previous = currentReference(request, network);
    if (previous && previous !== reference) writeCookie(response, request, sessionCookie(network, previous), '', 0);
    if (readCookie(request, cookie(network))) writeCookie(response, request, cookie(network), '', 0);
    writeCookie(response, request, name, value, lifetime);
    writeCookie(response, request, cookie(network) + '-current', reference, lifetime);
  } else {
    writeCookie(response, request, cookie(network), value, lifetime);
  }
  return response;
}

function closeSession(request: Request, network: ContributionNetwork, account: unknown, sessionId: unknown) {
  const response = reply({ ok: true });
  const closingAccount = typeof account === 'string' && StrKey.isValidEd25519PublicKey(account) ? account : undefined;
  const target = sessionReference(closingAccount, sessionId);
  const current = currentReference(request, network);
  const reference = target ?? current;
  if (reference && (!closingAccount || reference.startsWith(closingAccount + '.'))) {
    const name = sessionCookie(network, reference);
    // A late response can expire only its own credential. A concurrent write cannot revive it.
    writeCookie(response, request, name, '', 0);
    writeCookie(response, request, name + '-closed', '1', lifetime);
  }
  const legacy = parseSession(network, readCookie(request, cookie(network)))?.account;
  if (target ? legacy === closingAccount : !legacy || !closingAccount || legacy === closingAccount) writeCookie(response, request, cookie(network), '', 0);
  return response;
}
function invitationCode(row: StoredEncounter, network: ContributionNetwork, key?: string) {
  if (row.draft.inviteMode === 'link' && key) {
    const hmac = createHmac('sha256', key).update('vespi:encounter-claim:v1:');
    if (network !== DEFAULT_NETWORK) hmac.update(contributionNetwork(network).id + ':');
    return hmac.update(row.id + ':' + row.proposalSignature).digest('hex');
  }
}
// The commitment is public in the anchored receipt. Testnet keeps its historical token; on mainnet the link
// depends on the server key, so only the participants can hand it out.
function certificateToken(commitment: string, network: ContributionNetwork, key?: string) {
  if (network === DEFAULT_NETWORK) return createHash('sha256').update('vespi:encuentro:proof:' + commitment).digest('hex').slice(0, 32);
  if (!tokenKeyHasMinimumBytes(key)) throw new Error('contributions: mainnet certificates need the token key');
  return createHmac('sha256', key as string).update('vespi:encounter-proof:v1:' + contributionNetwork(network).id + ':' + commitment)
    .digest('hex').slice(0, 32);
}
function validCode(row: StoredEncounter, input: unknown, network: ContributionNetwork, key?: string) {
  const code = invitationCode(row, network, key);
  return Boolean(code && typeof input === 'string' && digestPattern.test(input) &&
    timingSafeEqual(Buffer.from(input, 'hex'), Buffer.from(code, 'hex')));
}
function accessStatus(access: string) { return ['sign-in', 'claim-sign-in'].includes(access) ? 401 : 403; }

function view(row: StoredEncounter, network: ContributionNetwork, key: string | undefined, viewer?: string | null): Encounter {
  const { id, draft, createdAt, decision, anchor, receiptToken } = row;
  const confirmed = decision?.choice === 'confirm';
  const status = !draft.b ? 'personal' : confirmed ? 'confirmed' : decision?.choice === 'correction' ? 'correction' :
    decision?.choice === 'declined' ? 'declined' : 'pending';
  const anchorCommitment = status === 'personal' || status === 'confirmed'
    ? createHash('sha256').update(encounterAnchorMessage(id, row.proposalSignature, decision?.signature ?? null, network)).digest('hex') : undefined;
  const code = viewer === draft.a.account && !decision ? invitationCode(row, network, key) : undefined;
  return { ...draft, id, createdAt, status, confirmed, revision: row.revision ?? (draft.revisionOf ? 2 : 1),
    inviteUrl: status === 'pending' && (draft.b?.account || code)
      ? '/app?encuentro=' + id + (network === DEFAULT_NETWORK ? '' : '&network=' + contributionNetwork(network).segment) +
        (code ? '#invitation=' + code : '') : undefined,
    note: decision?.note, respondedBy: decision?.person, anchor, anchorCommitment, receiptToken,
    proposalSignature: row.proposalSignature, decisionSignature: decision?.signature } as Encounter;
}

export async function GET(request: Request) {
  const selected = readContributionNetwork(request);
  if (!selected.ok) return selected.response;
  const { network, env, allowlist } = selected;
  const key = contributionsTokenKey(env, network);
  const viewer = readSession(request, network);
  if (viewer && allowlist && !allowlist.has(viewer)) return accountNotAllowed();
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (allowlist && id !== null && !viewer) return failure('sign-in', 401);
  const registry = createEncounterRegistry(env, fetch, network);
  try {
    if (params.get('session') === '1') {
      if (!viewer) return reply({ ok: true, profile: null });
      const profile = await createProfileRegistry(env, fetch, network).get(viewer);
      return reply({ ok: true, profile });
    }
    if (id !== null) {
      if (!isEncounterId(id)) return failure('not-found', 404);
      const record = await registry.get(id);
      if (!record) return failure('not-found', 404);
      const access = encounterAccess(record.draft, Boolean(record.decision), viewer, {
        valid: validCode(record, request.headers.get('x-vespi-invitation'), network, key), respondent: record.decision?.person.account,
      }, network);
      if (access !== 'allowed') return failure(access, accessStatus(access));
      return reply({ ok: true, encounter: view(record, network, key, viewer) });
    }
    const account = params.get('account');
    const cursor = params.get('cursor') ?? '0';
    if (!account || account !== viewer) return failure('sign-in', 401);
    if (!/^\d{1,20}$/.test(cursor)) return failure('invalid-cursor', 400);
    const listed = await registry.list(account, cursor);
    return reply({ ok: true, cursor: listed.cursor, entries: listed.entries.map(row => view(row, network, key, account)) });
  } catch {
    return failure('unavailable', 503);
  }
}

export async function POST(request: Request) {
  let body: { action?: string; id?: unknown; draft?: unknown; signature?: unknown; session?: unknown; sessionId?: unknown;
    choice?: Decision; note?: unknown; receipt?: unknown; account?: unknown; invitation?: unknown; network?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 30_000) return failure('invalid-input', 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return failure('invalid-input', 400);
  } catch { return failure('invalid-input', 400); }

  if (body.action === 'logout') {
    let network;
    try { network = requestContributionNetwork(request, body); }
    catch { return failure('invalid-network', 400); }
    return closeSession(request, network, body.account, body.sessionId);
  }
  const selected = readContributionNetwork(request, body);
  if (!selected.ok) return selected.response;
  const { network, env, allowlist } = selected;
  if (body.action === 'session') {
    const session = typeof body.session === 'string' ? parseSession(network, body.session) : null;
    const account = session?.account;
    if (account && allowlist && !allowlist.has(account)) return accountNotAllowed();
    const reference = sessionReference(account, session?.sessionId);
    if (reference && readCookie(request, sessionCookie(network, reference) + '-closed')) return failure('session-closed', 409);
    return account ? setSession(reply({ ok: true }), request, body.session, account, network) : failure('sign-in', 401);
  }
  const key = contributionsTokenKey(env, network);
  const id = body.id;
  if (!isEncounterId(id)) return failure('invalid-id', 400);
  const registry = createEncounterRegistry(env, fetch, network);
  try {
    if (body.action === 'publish') {
      let draft;
      try { draft = parseEncounterDraft(body.draft); }
      catch { return failure('invalid-encounter', 400); }
      const input = body.draft as EncounterDraft;
      if (draft.visibility === 'public' &&
        (input.summary !== '' || input.title !== deriveRecordTitle(draft.contributions[0].text))) {
        return failure('invalid-encounter', 400);
      }
      const { a, b } = draft;
      if (b && !b.account && draft.inviteMode !== 'link') return failure('recipient-required', 400);
      if (allowlist && (!allowlist.has(a.account) || (b?.account && !allowlist.has(b.account)))) return accountNotAllowed();
      if (draft.inviteMode === 'link' && !tokenKeyHasMinimumBytes(key)) return failure('unavailable', 503);
      if (!verifiesEncounterSignature(a.account, proposalMessage(id, draft, network), body.signature)) return failure('signature', 403);
      const profiles = createProfileRegistry(env, fetch, network);
      const names = await Promise.all([profiles.get(a.account), b?.account ? profiles.get(b.account) : null]);
      if (names[0]?.displayName !== a.displayName || (b?.account && names[1]?.displayName !== b.displayName)) return failure('profile', 400);
      let revision = 1;
      if (draft.revisionOf) {
        const previous = await registry.get(draft.revisionOf);
        if (!previous || previous.draft.a.account !== a.account || previous.decision?.choice !== 'correction' ||
          previous.decision.person.account !== b?.account || previous.draft.visibility !== draft.visibility) {
          return failure('invalid-revision', 400);
        }
        revision = (previous.revision ?? (previous.draft.revisionOf ? 2 : 1)) + 1;
      }
      const record = { id, draft, revision, createdAt: new Date().toISOString(), proposalSignature: body.signature };
      const saved = await registry.create(record) ? record : await registry.get(id);
      if (!saved || saved.proposalSignature !== body.signature) return failure('conflict', 409);
      return setSession(reply({ ok: true, encounter: view(saved, network, key, a.account) }), request, body.session, a.account, network);
    }
    const viewer = readSession(request, network);
    if (allowlist) {
      if (viewer && !allowlist.has(viewer)) return accountNotAllowed();
      if (body.action === 'respond' && (typeof body.account !== 'string' || !allowlist.has(body.account))) return accountNotAllowed();
      if (!viewer) return failure('sign-in', 401);
    }
    const existing = await registry.get(id);
    if (!existing) return failure('not-found', 404);
    if (body.action === 'respond') {
      const recipient = body.account;
      const invited = existing.draft.b;
      if (!invited || typeof recipient !== 'string' || !StrKey.isValidEd25519PublicKey(recipient) ||
        recipient === existing.draft.a.account) return failure('signature', 403);
      const mayRespond = existing.draft.inviteMode === 'link'
        ? viewer === recipient && validCode(existing, body.invitation, network, key) &&
          (!existing.decision || existing.decision.person.account === recipient)
        : invited.account === recipient;
      if (!mayRespond) return failure('signature', 403);
      const choice = body.choice;
      if (!recipient || (choice !== 'confirm' && choice !== 'correction' && choice !== 'declined')) return failure('invalid-decision', 400);
      let note: string;
      try { note = parseDecisionNote(body.note); }
      catch { return failure('invalid-note', 400); }
      if (choice === 'correction' && !note) return failure('missing-correction', 400);
      if (!verifiesEncounterSignature(recipient, decisionMessage(id, existing.proposalSignature, choice, note, network), body.signature)) return failure('signature', 403);
      const person = await createProfileRegistry(env, fetch, network).get(recipient);
      if (!person) return failure('profile', 400);
      const decision = { choice, note, signature: body.signature, person };
      const confirmed = { ...existing, decision };
      const saved = await registry.respond(id, decision, Boolean(signedPublicEncounter(confirmed, network))) ? confirmed : await registry.get(id);
      if (!saved || saved.decision?.signature !== body.signature) return failure('already-reviewed', 409);
      return setSession(reply({ ok: true, encounter: view(saved, network, key) }), request, body.session, recipient, network);
    }
    if (body.action === 'anchor') {
      const access = encounterAccess(existing.draft, Boolean(existing.decision), viewer, {
        valid: false, respondent: existing.decision?.person.account,
      }, network);
      if (access !== 'allowed') return failure(access, accessStatus(access));
      const actor = existing.decision?.person.account ?? existing.draft.a.account;
      if (allowlist && !allowlist.has(actor)) return accountNotAllowed();
      const { anchor, anchorCommitment } = view(existing, network, key);
      if (anchor) return reply({ ok: true, encounter: view(existing, network, key) });
      if (!anchorCommitment || typeof body.receipt !== 'string' || !digestPattern.test(body.receipt)) return failure('invalid-anchor', 400);
      const receipt = await createReceiptRegistry(env, fetch, network).get(body.receipt);
      if (!receipt?.index || receipt.index.network !== contributionNetwork(network).id) return failure('unverified-anchor', 400);
      const value = parseContribution(receipt.intent.bytes);
      if (value.kind !== 'REQUEST' || value.actor !== actor || (allowlist && !isEncounterFingerprint(value)) ||
        value.comment !== 'vespi:encuentro:' + anchorCommitment) return failure('unverified-anchor', 400);
      const receiptToken = certificateToken(anchorCommitment, network, key);
      const saved = await registry.anchor(id, body.receipt, receiptToken)
        ? { ...existing, anchor: body.receipt, receiptToken } : await registry.get(id);
      return saved ? reply({ ok: true, encounter: view(saved, network, key) }) : failure('not-found', 404);
    }
    return failure('invalid-action', 400);
  } catch {
    return failure('unavailable', 503);
  }
}
