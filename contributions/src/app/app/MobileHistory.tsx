'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '@/lib/i18n';
import type { ActivityEntry } from '@/lib/contributions/receipt-registry';
import type { Encounter } from '@/lib/contributions/encounters';
import { DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { focusRoot, isFocusRegistration } from '@/lib/contributions/focus-event';
import { contributionLink, withContributionNetwork, FlowError } from './client';
import { mainnetBlocked, MainnetFailure } from './MainnetNotice';
import { invitationPath, readInvitations, readMutual, type SavedInvitation } from './saved-invitations';
import ShareActions from './ShareActions';
import { listEncounters } from './encuentros/encounter-client';
import { createMeridianBackend } from './encuentros/meridian-backend';

const copy = {
  es: {
    activity: 'Actividad', loading: 'Buscando tus aportes…', retry: 'Volver a intentar',
    error: 'No pudimos cargar tus aportes.', empty: 'Todavía no hay actividad registrada en esta cuenta.',
    needs: 'Te toca firmar', waiting: 'Esperas a otra persona', done: 'Ya firmaste',
    finished: 'Listos', private: 'Privado', changes: 'Cambios solicitados', declined: 'No reconocido',
    encounterError: 'No pudimos cargar todos tus registros.', unlock: 'Entra para ver tus registros',
    invite: 'Cuando tengas su cuenta, autorízala para que pueda firmar el aporte.', invited: 'Invitación preparada para',
    community: 'Invitación de', received: 'Revisar y aceptar', deliver: 'Abrir invitación',
    resume: 'Autorizar cuenta para entregar', view: 'Ver registro', share: 'Volver a compartir invitación',
    send: 'Te invito a registrar tu aporte en Vespi Contributions.',
    delivery: 'Compartir para revisión', review: '¿Puedes revisar el aporte que registré en Vespi Contributions?',
    actions: { REQUEST: 'Solicitud firmada', CONTRIBUTE: 'Entrega firmada', ACCEPT: 'Aceptación firmada', ATTEST: 'Testimonio firmado' },
  },
  en: {
    activity: 'Activity', loading: 'Loading your contributions…', retry: 'Try again',
    error: 'We could not load your contributions.', empty: 'There is no recorded activity on this account yet.',
    needs: 'Your signature is next', waiting: 'Waiting for someone else', done: 'You signed',
    finished: 'Ready', private: 'Private', changes: 'Changes requested', declined: 'Declined',
    encounterError: 'We could not load all your records.', unlock: 'Sign in to see your records',
    invite: 'Once you have their account, authorize it so they can sign the contribution.', invited: 'Invitation ready for',
    community: 'Invitation from', received: 'Review and accept', deliver: 'Open invitation',
    resume: 'Authorize account to deliver', view: 'View record', share: 'Share invitation again',
    send: 'Please record your contribution in Vespi Contributions.',
    delivery: 'Share for review', review: 'Can you review the contribution I recorded in Vespi Contributions?',
    actions: { REQUEST: 'Request signed', CONTRIBUTE: 'Delivery signed', ACCEPT: 'Acceptance signed', ATTEST: 'Testimony signed' },
  },
};

function recentFirst<T extends { createdAt: string }>(items: Iterable<T>) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function MobileHistory({ lang, account, network = DEFAULT_NETWORK, includeEncounters = false }: {
  lang: Lang; account: string; network?: ContributionNetwork; includeEncounters?: boolean;
}) {
  const t = copy[lang];
  const [entries, setEntries] = useState<ActivityEntry[]>();
  const [invitations, setInvitations] = useState<SavedInvitation[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [origin, setOrigin] = useState('');
  const [encounters, setEncounters] = useState<Encounter[]>();
  const [encounterError, setEncounterError] = useState('');
  const scrollRestored = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setInvitations(readInvitations(account, network));
      setOrigin(location.origin);
      const found = new Map<string, ActivityEntry>();
      const cursors = new Set<string>();
      let cursor = '0';
      do {
        if (cursors.has(cursor)) throw new Error('Repeated activity cursor');
        cursors.add(cursor);
        const response = await fetch(withContributionNetwork('/api/contributions/activity/' + account + '?cursor=' + cursor, network),
          { signal: controller.signal });
        if (network === 'mainnet' && response.status === 503) throw new FlowError('mainnet-unavailable');
        if (network === 'mainnet' && response.status === 403) throw new FlowError('account-not-allowed');
        if (!response.ok) throw new Error('Activity unavailable');
        const page: { entries: ActivityEntry[]; cursor: string } = await response.json();
        if (controller.signal.aborted) return;
        for (const entry of page.entries) found.set(entry.digest, entry);
        cursor = page.cursor;
        if (cursor === '0') setEntries(recentFirst(found.values()));
        else if (page.entries.length) setEntries(previous => recentFirst(new Map(
          [...(previous ?? []), ...page.entries].map(entry => [entry.digest, entry]),
        ).values()));
      } while (cursor !== '0');
      setError('');
    }
    void load().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof FlowError ? cause.message : 'unavailable'); });
    const refresh = () => { if (document.visibilityState === 'visible') setRetry(value => value + 1); };
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', refresh); };
  }, [account, retry, network]);

  useEffect(() => {
    if (!includeEncounters) return;
    let current = true;
    async function load() {
      const found = new Map<string, Encounter>();
      const seen = new Set<string>();
      let cursor = '0';
      do {
        if (!current) return;
        if (seen.has(cursor)) throw new Error('Repeated encounter cursor');
        seen.add(cursor);
        const page = await listEncounters(account, cursor, network).catch(async error => {
          if (!current || cursor !== '0' || !(error instanceof FlowError) || error.message !== 'sign-in') throw error;
          const session = await createMeridianBackend(network).session();
          if (session?.id !== account) throw error;
          return listEncounters(account, cursor, network);
        });
        if (!current) return;
        for (const row of page.entries) found.set(row.id, row);
        cursor = page.cursor;
        if (cursor === '0') setEncounters(recentFirst(found.values()));
        else if (page.entries.length) setEncounters(previous => recentFirst(new Map(
          [...(previous ?? []), ...page.entries].map(row => [row.id, row]),
        ).values()));
      } while (cursor !== '0');
      setEncounterError('');
    }
    void load().catch(cause => { if (current) setEncounterError(cause instanceof FlowError ? cause.message : 'unavailable'); });
    return () => { current = false; };
  }, [account, includeEncounters, network, retry]);

  useEffect(() => {
    if (!includeEncounters || !entries || !encounters || scrollRestored.current) return;
    const position = history.state?.vespiHistoryScroll;
    if (typeof position !== 'number') return;
    scrollRestored.current = true;
    const frame = requestAnimationFrame(() => scrollTo(0, position));
    return () => cancelAnimationFrame(frame);
  }, [entries, encounters, includeEncounters]);

  const activity = entries ?? [];
  const focusRecord = (entry: ActivityEntry) => network === 'testnet' && entry.action === 'REQUEST' && isFocusRegistration(entry.context, entry.root);
  const roots = new Map(activity.filter(entry => entry.action !== 'ATTEST' && !focusRecord(entry)).reverse().map(entry => [entry.root, entry]));
  const requests = new Set(activity.filter(entry => entry.action === 'REQUEST').map(entry => entry.root));
  const incoming = invitations.filter(invitation => invitation.incoming && !roots.has(invitation.root) &&
    (network !== 'testnet' || invitation.root !== focusRoot));
  const context = (root: string) => invitations.find(invitation => invitation.root === root)?.mutual ?? readMutual(account, root, network);
  const toReview = [...roots.values()].filter(entry => requests.has(entry.root) && entry.state === 'CONTRIBUTE');
  const waiting = [...roots.values()].filter(entry => entry.state === 'REQUEST' || (entry.state === 'CONTRIBUTE' && !requests.has(entry.root)));
  const records = encounters ?? [];
  const actionable = records.filter(row => (row.status === 'pending' && row.a.account !== account) ||
    (row.status === 'correction' && row.a.account === account));
  const waitingRecords = records.filter(row => (row.status === 'pending' && row.a.account === account) ||
    (row.status === 'correction' && row.a.account !== account));
  const finishedRecords = records.filter(row => row.status === 'confirmed' || row.status === 'personal' || row.status === 'declined');
  const signedReceipts = includeEncounters ? activity.filter(entry => entry.state === 'ACCEPT' || entry.action === 'ATTEST' || focusRecord(entry)) : activity;
  const recordRow = (row: Encounter) => <article className="mobile-actions" key={row.id}>
    <p><strong>{row.title}</strong>{row.visibility !== 'public' && (' · ' + t.private)}</p>
    {(row.status === 'correction' || row.status === 'declined') &&
      <p className="mobile-note">{row.status === 'correction' ? t.changes : t.declined}</p>}
    <Link className="mobile-secondary" href={withContributionNetwork('/app?encuentro=' + row.id + '&lang=' + lang, network)}
      onNavigate={() => history.replaceState({ ...history.state, vespiHistoryScroll: scrollY }, '')}>{t.view}</Link>
  </article>;

  return <section className="mobile-actions mobile-history" aria-label={t.activity}>
    {((!entries && !error) || (includeEncounters && !encounters && !encounterError)) &&
      <p className="mobile-note" role="status">{t.loading}</p>}
    {error && (mainnetBlocked(error) ? <MainnetFailure lang={lang} reason={error} /> : <p role="alert">{t.error}</p>)}
    {encounterError === 'sign-in' ? <Link className="mobile-secondary"
      href={withContributionNetwork('/app?lang=' + lang, network)}>{t.unlock}</Link> : encounterError &&
      <p className="mobile-note" role="alert">{t.encounterError}</p>}
    {(error || encounterError) &&
      <button className="mobile-secondary" type="button" onClick={() => {
        setError(''); setEncounterError(''); setRetry(value => value + 1);
      }}>{t.retry}</button>}
    {entries && !error && !encounterError && !entries.length && !incoming.length && !records.length &&
      (!includeEncounters || encounters) && <p className="mobile-note">{t.empty}</p>}
    {Boolean(toReview.length || incoming.length || actionable.length) && <h2>{t.needs}</h2>}
    {actionable.map(recordRow)}
    {incoming.map(invitation => <article className="mobile-actions" key={invitation.root}>
      <p>{t.community} <strong>{invitation.name}</strong></p>
      <Link className="mobile-secondary" href={invitationPath(invitation, network)}>{t.deliver}</Link>
    </article>)}
    {toReview.map(entry => <article className="mobile-actions" key={entry.root}>
      <p>{entry.context}</p>
      <Link className="mobile-secondary" href={contributionLink('continue', entry.head, context(entry.root), network)}>{t.received}</Link>
    </article>)}
    {Boolean(waiting.length || waitingRecords.length) && <h2>{t.waiting}</h2>}
    {waitingRecords.map(recordRow)}
    {waiting.map(entry => {
      const invitation = invitations.find(item => item.root === entry.root && !item.incoming);
      return <article className="mobile-actions" key={entry.root}>
        <p>{entry.context}</p>
        {entry.state === 'REQUEST' ? invitation ? <>
          <p>{t.invited} <strong>{invitation.name}</strong></p>
          <ShareActions lang={lang} url={origin + invitationPath(invitation, network)} label={t.share} message={t.send} />
        </> : <>
          <p>{t.invite}</p>
          <Link className="mobile-secondary" href={contributionLink('continue', entry.root, context(entry.root), network)}>{t.resume}</Link>
        </> : <ShareActions lang={lang} url={origin + contributionLink('continue', entry.head, context(entry.root), network)} label={t.delivery} message={t.review} />}
      </article>;
    })}
    {Boolean(signedReceipts.length || finishedRecords.length) && <h2>{includeEncounters ? t.finished : t.done}</h2>}
    {finishedRecords.map(recordRow)}
    {signedReceipts.map(entry => <article className="mobile-actions" key={entry.digest}>
      <p><strong>{focusRecord(entry) ? (lang === 'es' ? 'Evento registrado' : 'Event registered') : t.actions[entry.action]}</strong> · {entry.statement}</p>
      <Link className="mobile-secondary" href={contributionLink('receipt', entry.digest, context(entry.root), network)}>{t.view}</Link>
    </article>)}
  </section>;
}
