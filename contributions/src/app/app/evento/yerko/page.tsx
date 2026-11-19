import Link from 'next/link';
import AppBrand from '../../AppBrand';
import AppFooter from '../../AppFooter';
import ThemeSwitch from '@/components/ThemeSwitch';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { readYerkoSettings, yerkoSlides, yerkoSlidesReference } from '@/lib/contributions/yerko-event';
import { yerkoSpeaker, yerkoTitle } from './event';
import '../../mobile.css';

export const dynamic = 'force-dynamic';

async function speakerDelivery() {
  const settings = readYerkoSettings(process.env);
  if (!settings) return {};
  try {
    const registry = createReceiptRegistry(process.env);
    const head = await registry.head(settings.root);
    if (!head?.index) return settings;
    const latest = parseContribution(head.intent.bytes);
    const record = latest.kind === 'ACCEPT' ? await registry.get(latest.subject) : head;
    if (!record?.index) return settings;
    const delivery = parseContribution(record.intent.bytes);
    if (delivery.kind === 'CONTRIBUTE' && delivery.actor === settings.account && delivery.chain === settings.root &&
      delivery.comment === yerkoSlidesReference) {
      return { ...settings, digest: record.index.digest };
    }
  } catch {
    return { ...settings, unavailable: true };
  }
  return settings;
}

export default async function YerkoEventPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const en = (await searchParams).lang === 'en';
  const status: { digest?: string; closed?: boolean; unavailable?: boolean } = await speakerDelivery();
  return <main className="mobile-contributions event-page" lang={en ? 'en' : 'es'}>
    <header className="mobile-top">
      <AppBrand />
      <div className="mobile-settings">
        <Link href={en ? '/app/evento/yerko' : '/app/evento/yerko?lang=en'}
          aria-label={en ? 'Leer en español' : 'Read in English'}>{en ? 'ES' : 'EN'}</Link>
        <ThemeSwitch lang={en ? 'en' : 'es'} />
      </div>
    </header>
    <div className="mobile-sheet">
      <section className="mobile-content" aria-labelledby="event-title">
        <p>Stellar Barrio 2026 · Tellus Coop Blockchain Hub</p>
        <h1 id="event-title">{yerkoTitle}</h1>
        <p>{yerkoSpeaker} · {en ? 'November 19, 2026' : '19 de noviembre de 2026'}</p>
        <p>{en ? 'AI, privacy and quantum computing in Stellar.' : 'IA, privacidad y computación cuántica en Stellar.'}</p>
        <a className="mobile-secondary" href={yerkoSlides}>{en ? 'Open slides (PDF)' : 'Abrir presentación (PDF)'}</a>
        <h2>{en ? 'Did you attend?' : '¿Viste la charla?'}</h2>
        {status.unavailable ? <p>{en ? 'We could not check the speaker’s signature. Try reloading.' : 'No pudimos comprobar la firma del ponente. Vuelve a cargar la página.'}</p>
          : status.closed ? <p>{en ? 'Testimonies are closed.' : 'El registro de testimonios está cerrado.'}</p>
          : status.digest ? <>
              <p>{en ? 'Yerko signed this talk. You can now record that you attended and add a photo.' : 'Yerko ya firmó la charla. Puedes registrar que asististe y adjuntar una foto.'}</p>
              <Link href={'/app?observe=' + status.digest + '&evento=asistencia' + (en ? '&lang=en' : '&lang=es')} className="mobile-action">
                {en ? 'Sign that I attended' : 'Firmar que asistí'}
              </Link>
            </> : <p>{en ? 'You can sign your testimony once Yerko signs as speaker.' : 'Podrás firmar tu testimonio cuando Yerko firme como ponente.'}</p>}
        {status.digest && <Link className="mobile-text-action" href={'/app?receipt=' + status.digest + (en ? '&lang=en' : '&lang=es')}>
          {en ? 'See Yerko’s signed record' : 'Ver el registro firmado por Yerko'}
        </Link>}
      </section>
      <div className="event-page-art" aria-hidden="true" />
    </div>
    <AppFooter lang={en ? 'en' : 'es'} />
  </main>;
}
