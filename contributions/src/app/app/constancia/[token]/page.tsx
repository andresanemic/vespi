import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ThemeSwitch from '@/components/ThemeSwitch';
import AppBrand from '../../AppBrand';
import AppFooter from '../../AppFooter';
import { createEncounterRegistry } from '@/lib/contributions/encounter-registry';
import { isEncounterFingerprint, isEncounterId } from '@/lib/contributions/encounters';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import { contributionNetwork, DEFAULT_NETWORK, parseContributionNetwork } from '@/lib/contributions/network';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { signedPublicEncounter } from '@/lib/contributions/public-encounters';
import { withContributionNetwork } from '../../client';
import '../../mobile.css';

export const dynamic = 'force-dynamic';
type ProofProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string | string[]; network?: string | string[] }>;
};

function proofNetwork(value: string | string[] | undefined) {
  if (value === undefined) return DEFAULT_NETWORK;
  try { return parseContributionNetwork(value); } catch { notFound(); }
}

export async function generateMetadata({ searchParams }: ProofProps): Promise<Metadata> {
  const { lang, network } = await searchParams;
  const name = 'Stellar ' + proofNetwork(network);
  const title = lang === 'en' ? 'Vespi Contributions receipt' : 'Constancia de Vespi Contributions';
  return {
    title: network === 'mainnet' ? title + ' | ' + name : title,
    description: lang === 'en' ? `Check the fingerprint of a collaboration recorded on ${name}.`
      : `Consulta la huella de una colaboración registrada en ${name}.`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function EncounterProof({ params, searchParams }: ProofProps) {
  const [{ token }, { lang, network: selected }] = await Promise.all([params, searchParams]);
  const network = proofNetwork(selected);
  const mainnet = network === 'mainnet';
  const { id, explorer } = contributionNetwork(network);
  const name = 'Stellar ' + network;
  const english = lang === 'en';
  const t = (es: string, en: string) => english ? en : es;
  if (!isEncounterId(token)) notFound();
  const row = await createEncounterRegistry(process.env, fetch, network).proof(token);
  if (!row?.anchor) notFound();
  const record = await createReceiptRegistry(process.env, fetch, network).get(row.anchor);
  if (!record?.index || record.index.network !== id ||
      (mainnet && !isEncounterFingerprint(parseContribution(record.intent.bytes)))) notFound();
  const publicEntry = signedPublicEncounter(row, network);
  const switchLanguage = mainnet ? '?network=mainnet' + (english ? '' : '&lang=en') : english ? '?' : '?lang=en';
  const verify = withContributionNetwork('/app?receipt=' + row.anchor + (mainnet && english ? '&lang=en' : ''), network);
  return <main className="mobile-contributions mobile-compact" lang={english ? 'en' : 'es'}>
    <header className="mobile-top">
      <AppBrand />
      <div className="mobile-settings">
        <Link href={switchLanguage} aria-label={t('Read in English', 'Leer en español')}>{english ? 'ES' : 'EN'}</Link>
        <ThemeSwitch lang={english ? 'en' : 'es'} />
      </div>
    </header>
    <div className="mobile-sheet">
      <div className="mobile-network" data-mainnet={mainnet || undefined}>
        <span className="mobile-network-label">{mainnet && <span className="mobile-network-dot" aria-hidden="true" />}
          {mainnet ? 'Mainnet' : 'Testnet'}
        </span>
      </div>
      <section className="mobile-content">
        <h1>{t('Constancia de colaboración', 'Collaboration receipt')}</h1>
        <p>{row.draft.b ? t('Dos participantes confirmaron la misma versión del encuentro.', 'Two participants confirmed the same version of the encounter.') : t('El autor firmó su propia declaración.', 'The author signed their own statement.')}</p>
        <p>{row.draft.contributions.length} {row.draft.contributions.length === 1 ? t('aporte registrado', 'contribution recorded') : t('aportes registrados', 'contributions recorded')}</p>
        <p>{publicEntry ? t(`Huella registrada en ${name}. El aporte firmado está disponible en Vespi.`,
          `The fingerprint is recorded on ${name}. The signed contribution is available on Vespi.`)
          : t(`Huella registrada en ${name}. El contenido del encuentro se conserva en el enlace privado.`,
            `The fingerprint is recorded on ${name}. Encounter details are available through the private link.`)}</p>
        <div className="mobile-actions">
          <a className="mobile-action" href={explorer + '/tx/' + record.index.txHash}>{t('Ver transacción en Stellar', 'View Stellar transaction')}</a>
          <Link className="mobile-secondary" href={verify}>{t('Verificar huella y firma de anclaje', 'Verify fingerprint and anchoring signature')}</Link>
          {publicEntry && <Link prefetch={false} className="mobile-secondary" href={withContributionNetwork('/app/aporte/' + row.id + '?lang=' + (english ? 'en' : 'es'), network)}>
            {t('Abrir aporte público', 'Open public contribution')}</Link>}
        </div>
      </section>
    </div>
    <AppFooter lang={english ? 'en' : 'es'} />
  </main>;
}
