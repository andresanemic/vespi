'use client';

import Link from 'next/link';
import type { Lang } from '@/lib/i18n';
import MobileHistory from './MobileHistory';
import type { MobileIdentity } from './mobile-identity';

const copy = {
  es: { action: 'Registrar algo que pasó', profile: 'Mi perfil' },
  en: { action: 'Record something that happened', profile: 'My profile' },
};

export function MobileEventLink({ lang }: { lang: Lang }) {
  return <Link className="mobile-secondary" href="/app/evento/yerko">
    {lang === 'es' ? 'Charla de Yerko · 19 de noviembre' : 'Yerko’s talk · November 19'}
  </Link>;
}

export default function MobileDashboard({ lang, identity, onCompose, busy }: {
  lang: Lang;
  identity: MobileIdentity;
  onCompose: () => void;
  busy: boolean;
}) {
  const t = copy[lang];
  return <>
    <div className="mobile-dashboard-intro">
      <p><strong>{identity.displayName}</strong></p>
      <Link className="mobile-profile-link" href={'/app/perfil/' + identity.account}>{t.profile}</Link>
    </div>
    <button className="mobile-action" type="button" disabled={busy} onClick={onCompose}>{t.action}</button>
    <MobileEventLink lang={lang} />
    <MobileHistory key={identity.account} lang={lang} account={identity.account} />
  </>;
}
