'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Lang } from '@/lib/i18n';
import type { ActivityEntry } from '@/lib/contributions/receipt-registry';
import { contributionLink } from './client';
import { invitationPath, readInvitations, readMutual, type SavedInvitation } from './saved-invitations';
import ShareActions from './ShareActions';

const copy = {
  es: {
    activity: 'Actividad', loading: 'Buscando tus aportes…', retry: 'Volver a intentar',
    error: 'No pudimos cargar tus aportes.', empty: 'Todavía no hay actividad registrada en esta cuenta.',
    needs: 'Te toca firmar', waiting: 'Esperas a otra persona', done: 'Ya firmaste',
    invite: 'Prepara un enlace para invitar a la otra persona.', invited: 'Invitación preparada para',
    community: 'Invitación de', received: 'Revisar y aceptar', deliver: 'Abrir invitación',
    resume: 'Elegir a quién invitar', view: 'Ver registro', share: 'Volver a compartir invitación',
    send: 'Te invito a registrar tu aporte en Vespi Contributions.',
    delivery: 'Compartir para revisión', review: '¿Puedes revisar el aporte que registré en Vespi Contributions?',
    actions: { REQUEST: 'Solicitud firmada', CONTRIBUTE: 'Entrega firmada', ACCEPT: 'Aceptación firmada', ATTEST: 'Testimonio firmado' },
  },
  en: {
    activity: 'Activity', loading: 'Loading your contributions…', retry: 'Try again',
    error: 'We could not load your contributions.', empty: 'There is no recorded activity on this account yet.',
    needs: 'Your signature is next', waiting: 'Waiting for someone else', done: 'You signed',
    invite: 'Prepare a link to invite the other person.', invited: 'Invitation ready for',
    community: 'Invitation from', received: 'Review and accept', deliver: 'Open invitation',
    resume: 'Choose whom to invite', view: 'View record', share: 'Share invitation again',
    send: 'Please record your contribution in Vespi Contributions.',
    delivery: 'Share for review', review: 'Can you review the contribution I recorded in Vespi Contributions?',
    actions: { REQUEST: 'Request signed', CONTRIBUTE: 'Delivery signed', ACCEPT: 'Acceptance signed', ATTEST: 'Testimony signed' },
  },
};

export default function MobileHistory({ lang, account }: { lang: Lang; account: string }) {
  const t = copy[lang];
  const [entries, setEntries] = useState<ActivityEntry[]>();
  const [invitations, setInvitations] = useState<SavedInvitation[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setInvitations(readInvitations(account));
      setOrigin(location.origin);
      const found = new Map<string, ActivityEntry>();
      const cursors = new Set<string>();
      let cursor = '0';
      do {
        if (cursors.has(cursor)) throw new Error('Repeated activity cursor');
        cursors.add(cursor);
        const response = await fetch('/api/contributions/activity/' + account + '?cursor=' + cursor, { signal: controller.signal });
        if (!response.ok) throw new Error('Activity unavailable');
        const page: { entries: ActivityEntry[]; cursor: string } = await response.json();
        for (const entry of page.entries) found.set(entry.digest, entry);
        cursor = page.cursor;
      } while (cursor !== '0');
      if (!controller.signal.aborted) setEntries([...found.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    void load().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    const refresh = () => { if (document.visibilityState === 'visible') setRetry(value => value + 1); };
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); document.removeEventListener('visibilitychange', refresh); };
  }, [account, retry]);

  if (failed) return <div className="mobile-actions">
    <p role="alert">{t.error}</p>
    <button className="mobile-secondary" type="button" onClick={() => { setFailed(false); setRetry(retry + 1); }}>{t.retry}</button>
  </div>;
  if (!entries) return <p role="status">{t.loading}</p>;

  const roots = new Map(entries.filter(entry => entry.action !== 'ATTEST').reverse().map(entry => [entry.root, entry]));
  const requests = new Set(entries.filter(entry => entry.action === 'REQUEST').map(entry => entry.root));
  const incoming = invitations.filter(invitation => invitation.incoming && !roots.has(invitation.root));
  const context = (root: string) => invitations.find(invitation => invitation.root === root)?.mutual ?? readMutual(account, root);
  const toReview = [...roots.values()].filter(entry => requests.has(entry.root) && entry.state === 'CONTRIBUTE');
  const waiting = [...roots.values()].filter(entry => entry.state === 'REQUEST' || (entry.state === 'CONTRIBUTE' && !requests.has(entry.root)));

  return <section className="mobile-actions" aria-label={t.activity}>
    {!entries.length && !incoming.length && <p>{t.empty}</p>}
    {Boolean(toReview.length || incoming.length) && <h2>{t.needs}</h2>}
    {incoming.map(invitation => <article className="mobile-actions" key={invitation.root}>
      <p>{t.community} <strong>{invitation.name}</strong></p>
      <Link className="mobile-secondary" href={invitationPath(invitation)}>{t.deliver}</Link>
    </article>)}
    {toReview.map(entry => <article className="mobile-actions" key={entry.root}>
      <p>{entry.context}</p>
      <Link className="mobile-secondary" href={contributionLink('continue', entry.head, context(entry.root))}>{t.received}</Link>
    </article>)}
    {Boolean(waiting.length) && <h2>{t.waiting}</h2>}
    {waiting.map(entry => {
      const invitation = invitations.find(item => item.root === entry.root && !item.incoming);
      return <article className="mobile-actions" key={entry.root}>
        <p>{entry.context}</p>
        {entry.state === 'REQUEST' ? invitation ? <>
          <p>{t.invited} <strong>{invitation.name}</strong></p>
          <ShareActions lang={lang} url={origin + invitationPath(invitation)} label={t.share} message={t.send} />
        </> : <>
          <p>{t.invite}</p>
          <Link className="mobile-secondary" href={contributionLink('continue', entry.root, context(entry.root))}>{t.resume}</Link>
        </> : <ShareActions lang={lang} url={origin + contributionLink('continue', entry.head, context(entry.root))} label={t.delivery} message={t.review} />}
      </article>;
    })}
    {Boolean(entries.length) && <h2>{t.done}</h2>}
    {entries.map(entry => <article className="mobile-actions" key={entry.digest}>
      <p><strong>{t.actions[entry.action]}</strong> · {entry.statement}</p>
      <Link className="mobile-secondary" href={contributionLink('receipt', entry.digest, context(entry.root))}>{t.view}</Link>
    </article>)}
  </section>;
}
