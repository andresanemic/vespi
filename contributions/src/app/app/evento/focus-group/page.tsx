import type { Metadata } from 'next';
import Link from 'next/link';
import ThemeSwitch from '@/components/ThemeSwitch';
import { focusEvent, focusRoot, focusSignPath } from '@/lib/contributions/focus-event';
import AppBrand from '../../AppBrand';
import AppFooter from '../../AppFooter';
import '../../mobile.css';

export const metadata: Metadata = {
  title: focusEvent.copy.es.title + ' · Vespi',
  robots: { index: false, follow: true },
};

export default async function FocusGroupPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const en = (await searchParams).lang === 'en';
  const lang = en ? 'en' : 'es';
  const copy = focusEvent.copy[lang];
  return <main className="mobile-contributions focus-event-page" lang={lang}>
    <header className="mobile-top">
      <AppBrand />
      <div className="mobile-settings">
        <Link href={`${focusEvent.path}?lang=${en ? 'es' : 'en'}`}
          aria-label={en ? 'Leer en español' : 'Read in English'}>{en ? 'ES' : 'EN'}</Link>
        <ThemeSwitch lang={lang} />
      </div>
    </header>
    <div className="mobile-sheet">
      <div className="mobile-ledger">Stellar testnet</div>
      <section className="mobile-content" aria-labelledby="focus-event-title">
        <h1 id="focus-event-title">{copy.title}</h1>
        <p><time dateTime={focusEvent.startsAt}>{copy.schedule}</time></p>
        <p>{en ? 'Organized by Francisco Toro and Andrés Peña, from Vespi.' : 'Organizado por Francisco Toro y Andrés Peña, de Vespi.'}</p>
        <div className="mobile-actions" data-focus-status="before">
          <p>{en ? 'You can sign your attendance once the event starts.' : 'Podrás firmar tu asistencia cuando empiece.'}</p>
        </div>
        <div className="mobile-actions" data-focus-status="open">
          {focusRoot ? <Link className="mobile-action" href={focusSignPath(focusRoot, lang)}>{copy.attend}</Link>
            : <p>{en ? 'The event record is still being prepared. Check back here to sign.' : 'El registro del evento todavía se está preparando. Puedes volver aquí para firmar.'}</p>}
        </div>
        <p data-focus-status="closed">{en ? 'Attendance signing is closed.' : 'El registro de asistencia está cerrado.'}</p>
      </section>
    </div>
    <AppFooter lang={lang} />
  </main>;
}
