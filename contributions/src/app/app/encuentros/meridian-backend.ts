import { createPasskey, isEmbeddedBrowser, keypairFromPrf, resolvePasskeyPrf, signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import type { Encounter, EncounterDraft, Person } from '@/lib/contributions/encounters';
import { getDisplayName, onboard, post, publishDisplayName, readProfilePage, readReceipt, validDisplayName, type DirectoryProfile } from '../client';
import { clearMobileIdentity, getMobileSigner, keepMobileSigner, rememberMobileIdentity } from '../mobile-identity';
import { anchorEncounter, confirmEncounter, invitationFromLocation, listEncounters, openEncounterSession, publishEncounter, readEncounter, respondEncounter } from './encounter-client';

export type MeridianEntry = { view: 'home' | 'records' | 'how' | 'example' | 'detail'; id?: string };
type Draft = Pick<EncounterDraft, 'type' | 'title' | 'date' | 'where' | 'summary' | 'contributions' | 'revisionOf' | 'inviteMode'> & { b: string; bAccount?: string };
type Decision = 'correct' | 'decline';

const api = '/api/contributions/encounters';
const passkeyRequired = 'Tu navegador no pudo desbloquear esta passkey. Abre Vespi en Safari o Chrome.';
const unexpectedAccount = 'Usa la passkey de la cuenta que participa en este encuentro.';

export function readMeridianEntry(url = new URL(location.href)): MeridianEntry {
  const id = url.searchParams.get('encuentro');
  if (id) return { view: 'detail', id };
  const view = url.searchParams.get('vista');
  return { view: view === 'encuentros' ? 'records' : view === 'como' ? 'how' : view === 'ejemplo' ? 'example' : 'home' };
}

export function createMeridianBackend() {
  let identity: Person | null = null;
  const known = new Map<string, Encounter>();

  async function activeSession() {
    const response = await fetch(api + '?session=1', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('No pudimos recuperar tu sesión.');
    const { profile } = await response.json() as { profile: Person | null };
    identity = profile;
    if (profile) rememberMobileIdentity(profile.account, profile.displayName);
    return profile && { id: profile.account, displayName: profile.displayName };
  }

  function browser() {
    if (isEmbeddedBrowser(navigator.userAgent)) {
      throw new Error('Abre este enlace en Safari o Chrome para usar tu passkey.');
    }
    return location.hostname;
  }

  async function unlock(expected?: string) {
    const rpId = browser();
    const prf = await unlockPasskey({ rpId }).catch(() => null);
    if (!prf) throw new Error(passkeyRequired);
    const signer = signerFromKeypair(await keypairFromPrf(prf, rpId));
    if (expected && signer.publicKey !== expected) throw new Error(unexpectedAccount);
    return signer;
  }

  async function connect(signer: Signer, displayName: string) {
    await openEncounterSession(signer);
    const profile = await activeSession();
    if (profile?.id !== signer.publicKey) throw new Error('No pudimos iniciar sesión.');
    keepMobileSigner(signer, false);
    rememberMobileIdentity(signer.publicKey, displayName);
    return profile;
  }

  function requireIdentity() {
    if (!identity) throw new Error('Inicia sesión para continuar.');
    return identity;
  }

  async function signerFor(a: Person) {
    return getMobileSigner(a.account)?.signer ?? unlock(a.account);
  }

  async function display(record: Encounter, verifyAnchor = true) {
    known.set(record.id, record);
    let transactionHash: string | undefined;
    const verify = () => readReceipt(record.anchor!, AbortSignal.timeout(10000));
    if (verifyAnchor && record.anchor) {
      const proof = await verify().catch(() => null);
      if (proof && proof.receipt.comment === 'vespi:encuentro:' + record.anchorCommitment) transactionHash = proof.index.txHash;
    }
    return {
      ...record,
      created: Date.parse(record.createdAt),
      revision: record.revision ?? (record.revisionOf ? 2 : 1),
      a: record.a.displayName,
      aAccount: record.a.account,
      b: record.respondedBy?.displayName ?? record.b?.displayName ?? '',
      bAccount: record.respondedBy?.account ?? record.b?.account ?? '',
      contributions: record.contributions.map((contribution, i) => ({ ...contribution, id: String(i) })),
      confirmations: { a: true, b: record.status === 'confirmed' },
      identityLabel: record.status === 'confirmed' ? 'Dos cuentas verificadas' : 'Cuenta autora verificada',
      signaturesLabel: record.status === 'confirmed' ? 'Dos firmas verificadas' : 'Firma de la persona autora verificada',
      recordHash: transactionHash ? record.anchorCommitment : undefined,
      transactionHash,
      inviteUrl: record.inviteUrl ? new URL(record.inviteUrl, location.origin).href : undefined,
      receiptUrl: transactionHash && record.receiptToken ? location.origin + '/app/constancia/' + record.receiptToken : undefined,
      canAnchor: !record.anchor && identity?.account === (record.status === 'confirmed' ? record.respondedBy?.account :
        record.status === 'personal' ? record.a.account : null),
    };
  }

  function recordFor(id: string) {
    const record = known.get(id);
    if (!record) throw new Error('Vuelve a abrir el encuentro.');
    return record;
  }

  function reviewerFor(record: Encounter) {
    const a = requireIdentity();
    if (record.status !== 'pending' || !record.b || a.account === record.a.account ||
      (record.b.account !== a.account && !(record.inviteMode === 'link' && invitationFromLocation(record.id)))) throw new Error(unexpectedAccount);
    return a;
  }

  return {
    session: activeSession,
    async register({ displayName }: { displayName: string }) {
      if (!validDisplayName(displayName) || displayName.length < 2) throw new Error('Escribe un nombre de 2 a 40 caracteres.');
      const rpId = browser();
      const created = await createPasskey({ rpId, userName: displayName }).catch(() => null);
      if (!created) throw new Error('No pudimos crear la passkey. Puedes intentarlo de nuevo.');
      const prf = await resolvePasskeyPrf({ rpId, created }).catch(() => null);
      if (!prf) throw new Error(passkeyRequired);
      const signer = signerFromKeypair(await keypairFromPrf(prf, rpId));
      await onboard(signer);
      return connect(signer, await publishDisplayName(signer, displayName));
    },
    async login() {
      const signer = await unlock();
      const name = await getDisplayName(signer.publicKey);
      if (!name) throw new Error('La cuenta todavía no tiene un nombre visible en Vespi.');
      return connect(signer, name);
    },
    async logout() {
      const { result } = await post('/encounters', { action: 'logout' });
      if (!result.ok) throw new Error('No pudimos cerrar la sesión.');
      identity = null;
      clearMobileIdentity();
    },
    async read(id: string) { return display(await readEncounter(id)); },
    async findProfiles(query: string) {
      const matches = new Map<string, DirectoryProfile>();
      const seen = new Set<string>();
      let cursor = '0';
      const searchable = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      do {
        if (seen.has(cursor)) throw new Error('Directory cursor repeated');
        seen.add(cursor);
        const page = await readProfilePage(cursor);
        for (const profile of page.entries) {
          if (profile.account !== identity?.account && searchable(profile.displayName + ' ' + profile.account).includes(searchable(query))) {
            matches.set(profile.account, profile);
          }
        }
        cursor = page.cursor;
      } while (cursor !== '0');
      return [...matches.values()].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.account.localeCompare(b.account));
    },
    async list(account: string) {
      const records = new Map<string, Encounter>();
      let cursor = '0';
      const seen = new Set<string>();
      do {
        if (seen.has(cursor)) throw new Error('No pudimos recuperar todos los encuentros.');
        seen.add(cursor);
        const page = await listEncounters(account, cursor);
        for (const record of page.entries) records.set(record.id, record);
        cursor = page.cursor;
      } while (cursor !== '0');
      return Promise.all([...records.values()].map(record => display(record, false)));
    },
    async publishEncounter(draft: Draft) {
      const a = requireIdentity();
      const signer = await signerFor(a);
      const { type, title, date, where, summary, contributions, revisionOf, inviteMode } = draft;
      const b = revisionOf ? (known.get(revisionOf) ?? await readEncounter(revisionOf)).respondedBy
        : draft.b.trim() ? { account: draft.bAccount ?? '', displayName: draft.b.trim() } : null;
      return display(await publishEncounter({ type, title, date, where, summary, contributions, revisionOf,
        inviteMode: b && !b.account ? inviteMode : undefined, a, b: b ?? null }, signer));
    },
    async signEncounter({ recordId, revision, participantRole }: { recordId: string; revision: number; participantRole: 'a' | 'b' }) {
      const record = recordFor(recordId);
      if ((record.revision ?? (record.revisionOf ? 2 : 1)) !== revision || participantRole !== 'b') throw new Error(unexpectedAccount);
      const signer = await signerFor(reviewerFor(record));
      const encounter = await display(await confirmEncounter(record, signer));
      return { signed: true, verified: true, revision, encounter };
    },
    async decide(id: string, decision: Decision, note: string) {
      const record = recordFor(id);
      const signer = await signerFor(reviewerFor(record));
      return display(await respondEncounter(record, signer, decision === 'correct' ? 'correction' : 'declined', note));
    },
    async anchor(id: string) {
      const record = recordFor(id);
      const a = requireIdentity();
      const account = record.status === 'personal' ? record.a.account : record.status === 'confirmed' ? record.respondedBy?.account : undefined;
      if (a.account !== account) throw new Error(unexpectedAccount);
      return display(await anchorEncounter(record, await signerFor(a)));
    },
    navigate(view: string, id?: string) {
      const url = new URL('/app', location.origin);
      const theme = new URL(location.href).searchParams.get('theme');
      if (theme) url.searchParams.set('theme', theme);
      if (view === 'records') url.searchParams.set('vista', 'encuentros');
      if (view === 'how') url.searchParams.set('vista', 'como');
      if (view === 'example') url.searchParams.set('vista', 'ejemplo');
      if (id) {
        url.searchParams.set('encuentro', id);
        const code = invitationFromLocation(id);
        if (code) url.hash = 'invitation=' + code;
      }
      if (url.href !== location.href) history.pushState(null, '', url);
    },
  };
}
