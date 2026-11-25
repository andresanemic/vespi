'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import MobileHistory from '../../MobileHistory';
import { useMobileIdentity } from '../../mobile-identity';
import AppFooter from '../../AppFooter';
import PublicContributionHeader from '../../PublicContributionHeader';
import type { PublicProfile } from '@/lib/contributions/profile-registry';
import type { PublicEncounter } from '@/lib/contributions/public-encounters';
import { DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { withContributionNetwork } from '../../client';
import Link from 'next/link';
import type { Lang } from '@/lib/i18n';

const copy = {
  es: {
    account: 'Cuenta de Stellar', publicRecords: 'Aportes confirmados',
    empty: 'Todavía no hay aportes públicos confirmados.', recordsError: 'No pudimos cargar los aportes.',
    gave: 'Ayudó a', received: 'Recibió ayuda de', more: 'Ver más aportes', first: 'Volver al inicio de la lista',
    copy: 'Copiar enlace del perfil', copied: 'Enlace copiado.',
    copyError: 'Puedes copiar el enlace desde la barra de direcciones.',
    missing: 'Perfil no encontrado', unavailable: 'No pudimos cargar el perfil',
    limited: 'Demasiadas consultas. Inténtalo en un momento.',
    retry: 'Volver a intentar', retrying: 'Consultando el perfil…',
  },
  en: {
    account: 'Stellar account', publicRecords: 'Confirmed contributions',
    empty: 'There are no confirmed public contributions yet.', recordsError: 'We could not load the contributions.',
    gave: 'Helped', received: 'Received help from', more: 'See more contributions', first: 'Back to the first contributions',
    copy: 'Copy profile link', copied: 'Link copied.',
    copyError: 'You can copy the link from the address bar.',
    missing: 'Profile not found', unavailable: 'Could not load this profile',
    limited: 'Too many requests. Try again in a moment.',
    retry: 'Try again', retrying: 'Checking the profile…',
  },
};

export default function ProfileView({ profile, network = DEFAULT_NETWORK, initialLang = 'es', page = null, attendance, cursor = '0', limited = false }: {
  profile: PublicProfile | null | undefined; network?: ContributionNetwork; initialLang?: Lang;
  page?: { entries: PublicEncounter[]; cursor: string } | null; cursor?: string; limited?: boolean;
  attendance?: { digest: string; statement: string };
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'copyError'>();
  const [retrying, startRetry] = useTransition();
  const router = useRouter();
  const t = copy[lang];
  const account = useMobileIdentity()?.account;
  const mainnet = network === 'mainnet';
  const date = new Intl.DateTimeFormat(lang === 'es' ? 'es-CL' : 'en', { dateStyle: 'medium', timeZone: 'UTC' });
  const profilePath = (next = '0') => withContributionNetwork('/app/perfil/' + profile?.account + '?lang=' + lang +
    (next === '0' ? '' : '&cursor=' + next), network);

  async function copyLink() {
    if (!profile) return;
    try {
      const url = new URL(profilePath(), window.location.origin);
      await navigator.clipboard.writeText(url.href);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('copyError');
    }
  }

  return (
    <main className="mobile-contributions mobile-compact mobile-public-view" lang={lang}>
      <PublicContributionHeader lang={lang} network={network}>
          <button type="button" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
      </PublicContributionHeader>
      <div className="mobile-sheet">
        <div className="mobile-network" data-mainnet={mainnet || undefined}>
          <span className="mobile-network-label">{mainnet && <span className="mobile-network-dot" aria-hidden="true" />}
            {mainnet ? 'Mainnet' : 'Testnet'}
          </span>
        </div>
        <section className="mobile-content" aria-labelledby="profile-heading">
          <h1 id="profile-heading" dir="auto">{profile?.displayName ?? (profile === null ? t.missing : t.unavailable)}</h1>
          {profile ? <>
            <section className="mobile-public-records" aria-labelledby="profile-contributions-heading">
              <h2 id="profile-contributions-heading">{t.publicRecords}</h2>
              {page?.entries.length ? <ul>{page.entries.map(entry => <li key={entry.id}>
                <Link prefetch={false} className="mobile-public-record-link" href={withContributionNetwork('/app/aporte/' + entry.id + '?lang=' + lang, network)}>
                  {entry.contributions.map(({ from, text }, index) => {
                    const helped = (from === 'a' ? entry.a.account : entry.b.account) === profile.account;
                    const other = profile.account === entry.a.account ? entry.b : entry.a;
                    return <span key={index} className="mobile-public-record-summary">
                      <strong>{helped ? t.gave : t.received} {other.displayName}</strong>
                      <span dir="auto">{text}</span>
                    </span>;
                  })}
                  <time dateTime={entry.date}>{date.format(new Date(entry.date))}</time>
                </Link>
              </li>)}</ul> : <p className="mobile-note">{page ? t.empty : t.recordsError}</p>}
              {page && page.cursor !== '0' && <Link className="mobile-text-action" href={profilePath(page.cursor)}>{t.more}</Link>}
              {cursor !== '0' && <Link className="mobile-text-action" href={profilePath()}>{t.first}</Link>}
            </section>
            {attendance && <section className="mobile-public-records" aria-labelledby="profile-attendance-heading">
              <h2 id="profile-attendance-heading">{lang === 'es' ? 'Asistencia firmada' : 'Signed attendance'}</h2>
              <Link className="mobile-text-action" href={'/app?receipt=' + attendance.digest + '&lang=' + lang}>{attendance.statement}</Link>
            </section>}
            {profile.account === account && <MobileHistory key={network} lang={lang} account={account} network={network} />}
            <dl className="mobile-details">
              <dt>{t.account}</dt>
              <dd>{profile.account}</dd>
            </dl>
            <button className="mobile-action" type="button" onClick={copyLink}>{t.copy}</button>
            <p className="mobile-note" role="status" hidden={!copyStatus}>{copyStatus && t[copyStatus]}</p>
          </> : profile === undefined && (
            <div className="mobile-actions" aria-busy={retrying}>
              {limited && <p className="mobile-note" role="status">{t.limited}</p>}
              <button className="mobile-action" type="button" disabled={retrying}
                onClick={() => startRetry(() => router.refresh())}>{retrying ? t.retrying : t.retry}</button>
            </div>
          )}
        </section>
      </div>
      <AppFooter lang={lang} />
    </main>
  );
}
