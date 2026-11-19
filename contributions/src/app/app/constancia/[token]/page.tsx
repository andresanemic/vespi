import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ThemeSwitch from '@/components/ThemeSwitch';
import AppBrand from '../../AppBrand';
import AppFooter from '../../AppFooter';
import { createEncounterRegistry } from '@/lib/contributions/encounter-registry';
import { isEncounterId } from '@/lib/contributions/encounters';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import '../../mobile.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Constancia de Vespi Contributions',
  description: 'Consulta la huella de una colaboración registrada en Stellar testnet.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function EncounterProof({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  const english = lang === 'en';
  const t = (es: string, en: string) => english ? en : es;
  if (!isEncounterId(token)) notFound();
  const row = await createEncounterRegistry(process.env).proof(token);
  if (!row?.anchor) notFound();
  const record = await createReceiptRegistry(process.env).get(row.anchor);
  if (!record?.index || record.index.network !== 'stellar:testnet') notFound();
  return <main className="mobile-contributions" lang={english ? 'en' : 'es'}>
    <header className="mobile-top">
      <AppBrand />
      <div className="mobile-settings">
        <Link href={english ? '?' : '?lang=en'} aria-label={t('Read in English', 'Leer en español')}>{english ? 'ES' : 'EN'}</Link>
        <ThemeSwitch lang={english ? 'en' : 'es'} />
      </div>
    </header>
    <div className="mobile-sheet">
      <div className="mobile-ledger">Stellar testnet</div>
      <section className="mobile-content">
        <h1>{t('Constancia de colaboración', 'Collaboration receipt')}</h1>
        <p>{row.draft.b ? t('Dos participantes confirmaron la misma versión del encuentro.', 'Two participants confirmed the same version of the encounter.') : t('El autor firmó su propia declaración.', 'The author signed their own statement.')}</p>
        <p>{row.draft.contributions.length} {row.draft.contributions.length === 1 ? t('aporte registrado', 'contribution recorded') : t('aportes registrados', 'contributions recorded')}</p>
        <p>{t('Huella registrada en Stellar testnet. El contenido del encuentro se conserva en el enlace privado.', 'The fingerprint is recorded on Stellar testnet. Encounter details are available through the private link.')}</p>
        <div className="mobile-actions">
          <a className="mobile-action" href={'https://stellar.expert/explorer/testnet/tx/' + record.index.txHash}>{t('Ver transacción en Stellar', 'View Stellar transaction')}</a>
          <Link className="mobile-secondary" href={'/app?receipt=' + row.anchor}>{t('Verificar huella y firma de anclaje', 'Verify fingerprint and anchoring signature')}</Link>
        </div>
      </section>
    </div>
    <AppFooter lang={english ? 'en' : 'es'} />
  </main>;
}
