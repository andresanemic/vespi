import type { Keypair } from '@stellar/stellar-sdk/base';
import { createPasskey, isEmbeddedBrowser, keypairFromPrf, resolvePasskeyPrf, signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import { isEncounterId, type Encounter, type EncounterDraft, type Person } from '@/lib/contributions/encounters';
import { DEFAULT_NETWORK } from '@/lib/contributions/network';
import { canUseMainnet, FlowError, getDisplayName, onboard, publishDisplayName, readProfilePage, readReceipt, validDisplayName, withContributionNetwork, type DirectoryProfile } from '../client';
import { clearMobileIdentity, getMobileSigner, keepMobileSigner, readMobileIdentity, rememberMobileIdentity, requireMobileSigner, restoreMobileSession, unlockedNow, unlockIsRecent } from '../mobile-identity';
import { anchorEncounter, confirmEncounter, invitationFromLocation, listEncounters, openEncounterSession, publishEncounter, readEncounter, respondEncounter } from './encounter-client';

export type MeridianEntry = { view: 'home' | 'how' | 'example' | 'detail' | 'wizard'; id?: string; invalidNetwork?: boolean; legacyDraft?: boolean; revision?: string };
type Draft = Pick<EncounterDraft, 'type' | 'title' | 'date' | 'where' | 'summary' | 'contributions' | 'revisionOf' | 'inviteMode' | 'visibility'> & { b: string; bAccount?: string };
type Decision = 'correct' | 'decline';

const api = '/api/contributions/encounters';
const passkeyRequired = 'Tu navegador no pudo desbloquear esta passkey. Abre Vespi en Safari o Chrome.';
const unexpectedAccount = 'Usa la passkey de la cuenta que participa en este encuentro.';

export function readMeridianEntry(url = new URL(location.href)): MeridianEntry {
  const id = url.searchParams.get('encuentro');
  if (id) return { view: 'detail', id };
  const view = url.searchParams.get('vista');
  const revision = url.searchParams.get('revision');
  return { view: ['registro', 'borrador-encuentro'].includes(view ?? '') ? 'wizard' : view === 'como' ? 'how' : view === 'ejemplo' ? 'example' : 'home',
    legacyDraft: view === 'borrador-encuentro', revision: isEncounterId(revision) ? revision : undefined };
}

export function createMeridianBackend(network = DEFAULT_NETWORK) {
  const mainnet = network === 'mainnet';
  let identity: Person | null = null;
  const known = new Map<string, Encounter>();

  async function sessionProfile() {
    const response = await fetch(withContributionNetwork(api + '?session=1', network), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const { profile, reason } = await response.json() as { profile: Person | null; reason?: string };
    if (!response.ok) throw new FlowError(reason ?? 'unavailable');
    return profile;
  }

  async function activeSession() {
    const remembered = readMobileIdentity();
    if (!remembered) return null;
    await restoreMobileSession();
    if (mainnet && !await canUseMainnet(remembered.account)) throw new FlowError('account-not-allowed');
    let profile = await sessionProfile();
    if (profile?.account !== remembered.account) {
      const signer = getMobileSigner(remembered.account)?.signer ??
        (remembered.local ? await requireMobileSigner(remembered.account, true).catch(() => undefined) : undefined);
      const displayName = signer && (mainnet ? await getDisplayName(remembered.account, network) : remembered.displayName);
      if (signer && displayName) profile = await encounterSession(signer);
    }
    if (profile?.account !== remembered.account || readMobileIdentity()?.account !== remembered.account) return null;
    identity = profile;
    return { id: profile.account, displayName: profile.displayName };
  }

  function browser() {
    if (isEmbeddedBrowser(navigator.userAgent)) {
      throw new Error('Abre este enlace en Safari o Chrome para usar tu passkey.');
    }
    return location.hostname;
  }

  // The keypair of a signer just unlocked, so signing in can open the session.
  const pairs = new WeakMap<Signer, { pair: Keypair; at: number }>();

  async function unlock() {
    const rpId = browser();
    const prf = await unlockPasskey({ rpId }).catch(() => null);
    if (!prf) throw new Error(passkeyRequired);
    const at = unlockedNow();
    const pair = await keypairFromPrf(prf, rpId);
    const signer = signerFromKeypair(pair);
    pairs.set(signer, { pair, at });
    return signer;
  }

  async function encounterSession(signer: Signer) {
    await openEncounterSession(signer, network);
    const profile = await sessionProfile();
    if (profile?.account !== signer.publicKey) throw new Error('No pudimos iniciar sesión.');
    return profile;
  }

  async function connect(signer: Signer) {
    const profile = await encounterSession(signer);
    rememberMobileIdentity(profile.account, profile.displayName);
    const used = pairs.get(signer);
    keepMobileSigner(signer, false, used?.pair, used?.at);
    identity = profile;
    return { id: profile.account, displayName: profile.displayName };
  }

  function requireIdentity() {
    if (!identity || identity.account !== readMobileIdentity()?.account) throw new Error('Inicia sesión para continuar.');
    return identity;
  }

  async function signerFor(a: Person, fresh = mainnet) {
    try { return await requireMobileSigner(a.account, false, fresh); }
    catch (error) {
      if (error instanceof FlowError && error.message === 'different-account') throw new Error(unexpectedAccount);
      if (error instanceof FlowError && (error.message === 'auth' || error.message === 'device-required')) throw new Error(passkeyRequired);
      throw error;
    }
  }

  async function display(record: Encounter, verifyAnchor = true) {
    known.set(record.id, record);
    let transactionHash: string | undefined;
    const verify = () => readReceipt(record.anchor!, AbortSignal.timeout(10000), undefined, network);
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
      receiptUrl: transactionHash && record.receiptToken
        ? location.origin + withContributionNetwork('/app/constancia/' + record.receiptToken, network) : undefined,
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
    mainnetEligible: canUseMainnet,
    voiceSigner: () => signerFor(requireIdentity(), false),
    voiceNeedsPasskey: () => !!identity && !readMobileIdentity()?.local && !getMobileSigner(identity.account),
    async register({ displayName }: { displayName: string }) {
      if (mainnet) throw new FlowError('account-not-allowed');
      if (!validDisplayName(displayName) || displayName.length < 2) throw new Error('Escribe un nombre de 2 a 40 caracteres.');
      const rpId = browser();
      const created = await createPasskey({ rpId, userName: displayName }).catch(() => null);
      if (!created) throw new Error('No pudimos crear la passkey. Puedes intentarlo de nuevo.');
      const prf = await resolvePasskeyPrf({ rpId, created }).catch(() => null);
      if (!prf) throw new Error(passkeyRequired);
      const pair = await keypairFromPrf(prf, rpId);
      const signer = signerFromKeypair(pair);
      pairs.set(signer, { pair, at: unlockedNow() });
      await onboard(signer);
      await publishDisplayName(signer, displayName);
      return connect(signer);
    },
    async login() {
      const signer = await unlock();
      if (mainnet && !await canUseMainnet(signer.publicKey)) throw new FlowError('account-not-allowed');
      const name = await getDisplayName(signer.publicKey, network);
      if (mainnet) {
        const existing = name ?? await getDisplayName(signer.publicKey);
        const finishLogin = async (displayName: string) => {
          let current = signer;
          // Choosing a name can take a while: an old passkey use does not sign on mainnet.
          if (!unlockIsRecent(pairs.get(signer)!.at)) {
            current = await unlock();
            if (current.publicKey !== signer.publicKey) throw new Error(unexpectedAccount);
          }
          await onboard(current, network);
          if (!name) await publishDisplayName(current, displayName, network);
          return connect(current);
        };
        if (existing) return finishLogin(existing);
        return {
          async saveName(displayName: string) {
            if (!validDisplayName(displayName) || displayName.length < 2) throw new Error('Escribe un nombre de 2 a 40 caracteres.');
            return finishLogin(displayName);
          },
        };
      }
      if (!name) throw new Error('La cuenta todavía no tiene un nombre visible en Vespi.');
      return connect(signer);
    },
    async logout() {
      identity = null;
      known.clear();
      await clearMobileIdentity();
    },
    async read(id: string) {
      if (!identity && mainnet) throw new FlowError('sign-in');
      try {
        const record = await readEncounter(id, network);
        // A leftover server session must not show a record to someone who signed out here.
        if (!identity && !invitationFromLocation(id)) throw new FlowError('sign-in');
        return display(record);
      }
      catch (error) {
        if (!mainnet && error instanceof FlowError && error.message === 'wrong-account' && !invitationFromLocation(id)) {
          throw new FlowError('incomplete');
        }
        throw error;
      }
    },
    async findProfiles(query: string) {
      const matches = new Map<string, DirectoryProfile>();
      const seen = new Set<string>();
      let cursor = '0';
      const searchable = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      do {
        if (seen.has(cursor)) throw new Error('Directory cursor repeated');
        seen.add(cursor);
        const page = await readProfilePage(cursor, network);
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
        const page = await listEncounters(account, cursor, network);
        for (const record of page.entries) records.set(record.id, record);
        cursor = page.cursor;
      } while (cursor !== '0');
      return Promise.all([...records.values()].map(record => display(record, false)));
    },
    async publishEncounter(draft: Draft) {
      const a = requireIdentity();
      const { type, title, date, where, summary, contributions, revisionOf, inviteMode, visibility } = draft;
      // The passkey comes first: iOS may refuse it after a network wait.
      const signer = await signerFor(a);
      const b = revisionOf ? (known.get(revisionOf) ?? await readEncounter(revisionOf, network)).respondedBy
        : draft.b.trim() ? { account: draft.bAccount ?? '', displayName: draft.b.trim() } : null;
      if (mainnet && b?.account && !await canUseMainnet(b.account)) throw new FlowError('recipient-not-allowed');
      return display(await publishEncounter({ type, title, date, where, summary, contributions, revisionOf,
        inviteMode: b && !b.account ? inviteMode : undefined, a, b: b ?? null, visibility }, signer, network));
    },
    async signEncounter({ recordId, revision, participantRole }: { recordId: string; revision: number; participantRole: 'a' | 'b' }) {
      const record = recordFor(recordId);
      if ((record.revision ?? (record.revisionOf ? 2 : 1)) !== revision || participantRole !== 'b') throw new Error(unexpectedAccount);
      const signer = await signerFor(reviewerFor(record));
      const encounter = await display(await confirmEncounter(record, signer, network));
      return { signed: true, verified: true, revision, encounter };
    },
    async decide(id: string, decision: Decision, note: string) {
      const record = recordFor(id);
      const signer = await signerFor(reviewerFor(record));
      return display(await respondEncounter(record, signer, decision === 'correct' ? 'correction' : 'declined', note, network));
    },
    async anchor(id: string) {
      const record = recordFor(id);
      const a = requireIdentity();
      const account = record.status === 'personal' ? record.a.account : record.status === 'confirmed' ? record.respondedBy?.account : undefined;
      if (a.account !== account) throw new Error(unexpectedAccount);
      return display(await anchorEncounter(record, await signerFor(a), network));
    },
    navigate(view: string, id?: string, legacyDraft = false, revision?: string) {
      const current = new URL(location.href);
      if (id && current.searchParams.get('encuentro') === id) return;
      const url = new URL('/app', location.origin);
      if (mainnet) url.searchParams.set('network', network);
      const lang = current.searchParams.get('lang');
      if (lang) url.searchParams.set('lang', lang);
      const theme = current.searchParams.get('theme');
      if (theme) url.searchParams.set('theme', theme);
      if (view === 'wizard') {
        url.searchParams.set('vista', legacyDraft ? 'borrador-encuentro' : 'registro');
        if (revision) url.searchParams.set('revision', revision);
      }
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
