import type { Lang } from '@/lib/i18n';

export const vespiSocialLinks = [
  ['GitHub', 'https://github.com/andresanemic/vespi'],
  ['X', 'https://x.com/vespi_xyz'],
  ['LinkedIn', 'https://www.linkedin.com/company/vespi-kernel/'],
] as const;

export default function AppFooter({ lang }: { lang: Lang }) {
  return <footer className="mobile-footer">
    <div className="footer-site">
      <a href="/">{lang === 'es' ? 'Escritorio de Vespi' : 'Vespi desktop'}</a>
      <a href={lang === 'es' ? '/contributions/es' : '/contributions'}>
        {lang === 'es' ? '¿Qué es Vespi Contributions?' : 'What is Vespi Contributions?'}
      </a>
    </div>
    <div className="footer-social">{vespiSocialLinks.map(([name, url]) =>
      <a key={name} href={url}>{name}</a>)}
    </div>
  </footer>;
}
