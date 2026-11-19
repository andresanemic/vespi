'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import MobileHistory from '../../MobileHistory';
import { useMobileIdentity } from '../../mobile-identity';
import AppBrand from '../../AppBrand';
import AppFooter from '../../AppFooter';
import ThemeSwitch from '@/components/ThemeSwitch';
import type { PublicProfile } from '@/lib/contributions/profile-registry';
import type { Lang } from '@/lib/i18n';

const copy = {
  es: {
    network: 'Ensayo · Stellar testnet', account: 'Cuenta de Stellar',
    copy: 'Copiar enlace del perfil', copied: 'Enlace copiado.',
    copyError: 'Puedes copiar el enlace desde la barra de direcciones.',
    missing: 'Perfil no encontrado', unavailable: 'No pudimos cargar el perfil',
    retry: 'Volver a intentar', retrying: 'Consultando el perfil…',
  },
  en: {
    network: 'Rehearsal · Stellar testnet', account: 'Stellar account',
    copy: 'Copy profile link', copied: 'Link copied.',
    copyError: 'You can copy the link from the address bar.',
    missing: 'Profile not found', unavailable: 'Could not load this profile',
    retry: 'Try again', retrying: 'Checking the profile…',
  },
};

export default function ProfileView({ profile }: { profile: PublicProfile | null | undefined }) {
  const [lang, setLang] = useState<Lang>('es');
  const [copyStatus, setCopyStatus] = useState<'copied' | 'copyError'>();
  const [retrying, startRetry] = useTransition();
  const router = useRouter();
  const t = copy[lang];
  const account = useMobileIdentity()?.account;

  async function copyLink() {
    if (!profile) return;
    try {
      const url = new URL('/app/perfil/' + profile.account, window.location.origin);
      await navigator.clipboard.writeText(url.href);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('copyError');
    }
  }

  return (
    <main className="mobile-contributions" lang={lang}>
      <header className="mobile-top">
        <AppBrand />
        <div className="mobile-settings">
          <button type="button" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <ThemeSwitch lang={lang} />
        </div>
      </header>
      <div className="mobile-sheet">
        <div className="mobile-ledger">{t.network}</div>
        <section className="mobile-content" aria-labelledby="profile-heading">
          <h1 id="profile-heading" dir="auto">{profile?.displayName ?? (profile === null ? t.missing : t.unavailable)}</h1>
          {profile ? <>
            {profile.account === account && <MobileHistory lang={lang} account={account} />}
            <dl className="mobile-details">
              <dt>{t.account}</dt>
              <dd>{profile.account}</dd>
            </dl>
            <button className="mobile-action" type="button" onClick={copyLink}>{t.copy}</button>
            <p className="mobile-note" role="status" hidden={!copyStatus}>{copyStatus && t[copyStatus]}</p>
          </> : profile === undefined && (
            <div className="mobile-actions" aria-busy={retrying}>
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
