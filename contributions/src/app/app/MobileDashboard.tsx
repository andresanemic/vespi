'use client';

import Link from 'next/link';
import type { Lang } from '@/lib/i18n';
import type { ContributionNetwork } from '@/lib/contributions/network';
import MobileHistory from './MobileHistory';
import { withContributionNetwork } from './client';
import { draftKey, readComposerDraft, readDraft } from './composer-draft';
import type { MobileIdentity } from './mobile-identity';

const copy = {
  es: { action: 'Registrar un aporte', request: '¿Necesitas ayuda? Pide un aporte', profile: 'Mi perfil', leave: 'Salir de la cuenta',
    legacy: 'Continuar borrador privado', received: 'Continuar borrador de ayuda recibida' },
  en: { action: 'Record a contribution', request: 'Need help? Request a contribution', profile: 'My profile', leave: 'Sign out',
    legacy: 'Resume private draft', received: 'Resume received contribution draft' },
};

export default function MobileDashboard({ lang, identity, busy, network, onLeave }: {
  lang: Lang;
  identity: MobileIdentity;
  busy: boolean;
  network: ContributionNetwork;
  onLeave: () => void;
}) {
  const t = copy[lang];
  const path = (query: string) => withContributionNetwork('/app?' + query + '&lang=' + lang, network);
  const legacy = readDraft(draftKey(identity.account, network, 'encounter'));
  const received = readComposerDraft(identity.account, network, 'received') ?? readComposerDraft(identity.account, network, 'request');
  return <>
    <Link className="mobile-action" href={path('vista=registro')}>{t.action}</Link>
    <Link className="mobile-text-action" href={withContributionNetwork('/app?vista=aportes&lang=' + lang + '&accion=pedir', network)}>{t.request}</Link>
    {Boolean(legacy) && <Link className="mobile-text-action" href={path('vista=borrador-encuentro')}>{t.legacy}</Link>}
    {received?.received && <Link className="mobile-text-action" href={path('vista=aportes&accion=recibi&permiso=borrador')}>{t.received}</Link>}
    <MobileHistory key={identity.account + ':' + network} lang={lang} account={identity.account} network={network} includeEncounters />
    <div className="mobile-dashboard-intro">
      <Link className="mobile-profile-link" href={withContributionNetwork('/app/perfil/' + identity.account + (lang === 'en' ? '?lang=en' : ''), network)}
        aria-label={t.profile + ' · ' + identity.displayName}>{identity.displayName}</Link>
      <button type="button" className="mobile-text-action" disabled={busy} onClick={onLeave}>{t.leave}</button>
    </div>
  </>;
}
