import type { ReactNode } from 'react';
import Link from 'next/link';
import AppBrand from './AppBrand';
import ThemeSwitch from '@/components/ThemeSwitch';
import type { Lang } from '@/lib/i18n';
import { withContributionNetwork } from './client';
import type { ContributionNetwork } from '@/lib/contributions/network';

export default function PublicContributionHeader({ lang, network, children }: {
  lang: Lang; network: ContributionNetwork; children: ReactNode;
}) {
  const es = lang === 'es';
  return <header className="mobile-top">
    <AppBrand />
    <div className="mobile-settings">
      {children}
      <ThemeSwitch lang={lang} />
      <details className="mobile-public-menu">
        <summary>{es ? 'Menú' : 'Menu'}</summary>
        <nav aria-label={es ? 'Navegación principal' : 'Main navigation'}>
          <Link prefetch={false} href={withContributionNetwork('/app?lang=' + lang, network)}>{es ? 'Inicio' : 'Home'}</Link>
          <Link prefetch={false} href={withContributionNetwork('/app?vista=aportes&lang=' + lang, network)}>
            {es ? 'Mis aportes' : 'My contributions'}
          </Link>
        </nav>
      </details>
    </div>
  </header>;
}
