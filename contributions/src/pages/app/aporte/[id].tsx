import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import AppFooter from '@/app/app/AppFooter';
import ShareActions from '@/app/app/ShareActions';
import PublicContributionHeader from '@/app/app/PublicContributionHeader';
import { contributionNetwork, DEFAULT_NETWORK, parseContributionNetwork, type ContributionNetwork } from '@/lib/contributions/network';
import { createPublicEncounters, publicEncounterLimiter, type PublicEncounterDetail } from '@/lib/contributions/public-encounters';
import { SITE_URL } from '@/lib/seo';

type Props = { lang: 'es' | 'en'; network: ContributionNetwork; entry: PublicEncounterDetail | null };

export const getServerSideProps: GetServerSideProps<Props, { id: string }> = async ({ params, query, req, res }) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const hit = publicEncounterLimiter.take(String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown', null);
  let network;
  try { network = parseContributionNetwork(query.network ?? DEFAULT_NETWORK); }
  catch { return { notFound: true }; }
  if (!params) return { notFound: true };
  const lang = query.lang === 'en' ? 'en' : 'es';
  if (!hit.ok) {
    res.statusCode = 429;
    res.setHeader('Retry-After', String(hit.retryAfter));
    return { props: { lang, network, entry: null } };
  }
  try {
    const entry = await createPublicEncounters(network).get(params.id, true);
    return entry ? { props: { lang, network, entry } } : { notFound: true };
  } catch {
    res.statusCode = 503;
    return { props: { lang, network, entry: null } };
  }
};

export default function ContributionPage({ lang, network, entry }: Props) {
  const t = (es: string, en: string) => lang === 'es' ? es : en;
  const title = t('Aporte público', 'Public contribution') + ' · Vespi Contributions';
  const description = t('Consulta un aporte firmado por dos personas en Vespi.', 'View a contribution signed by two people on Vespi.');
  const mainnet = network === 'mainnet';
  const path = (base: string, language = lang) => base + (mainnet ? '?network=mainnet&lang=' : '?lang=') + language;
  const url = new URL(path('/app/aporte/' + (entry?.id ?? '')), SITE_URL).href;
  const date = entry && new Intl.DateTimeFormat(lang === 'es' ? 'es-CL' : 'en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(entry.date));
  return <main className="mobile-contributions mobile-compact mobile-public-view" lang={lang}>
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={new URL('/og-contributions.png', SITE_URL).href} />
    </Head>
    <PublicContributionHeader lang={lang} network={network}>
        {entry && <a href={path('/app/aporte/' + entry.id, lang === 'es' ? 'en' : 'es')}
          aria-label={t('Read in English', 'Leer en español')}>{t('EN', 'ES')}</a>}
    </PublicContributionHeader>
    <div className="mobile-sheet">
      <div className="mobile-network" data-mainnet={mainnet || undefined}>
        <span className="mobile-network-label">{mainnet && <span className="mobile-network-dot" aria-hidden="true" />}
          {mainnet ? 'Mainnet' : 'Testnet'}
        </span>
      </div>
      <section className="mobile-content">
        {!entry ? <h1>{t('Aporte temporalmente no disponible', 'Contribution temporarily unavailable')}</h1> : <>
          <h1>{entry.a.displayName} {t('y', 'and')} {entry.b.displayName}</h1>
          <p className="mobile-note"><time dateTime={entry.date}>{date}</time>{entry.where && (' · ' + entry.where)}</p>
          {entry.contributions.map(({ from, text, url }, index) => {
            const [helper, recipient] = from === 'a' ? [entry.a, entry.b] : [entry.b, entry.a];
            return <section key={index} className="mobile-public-article">
              <h2><a href={path('/app/perfil/' + helper.account)}>{helper.displayName}</a> {t('ayudó a', 'helped')}{' '}
                <a href={path('/app/perfil/' + recipient.account)}>{recipient.displayName}</a></h2>
              <p dir="auto">{text}</p>
              {url && <a className="mobile-public-url" dir="ltr" href={url} rel="nofollow noreferrer">{url}</a>}
            </section>;
          })}
          <p><strong>{t('Firmado por los dos', 'Signed by both')}</strong></p>
          {entry.anchor ? <a className="mobile-secondary" href={contributionNetwork(network).explorer + '/tx/' + entry.anchor.txHash}>
            {t('Ver transacción en Stellar', 'View Stellar transaction')}</a> :
            <p>{t('Registro en Stellar pendiente', 'Stellar record pending')}</p>}
          <details className="mobile-public-article">
            <summary>{t('Comprobación', 'Verification')}</summary>
            <p>{entry.anchor ? t('Vespi comprobó las dos firmas y su huella en Stellar.', 'Vespi verified both signatures and their fingerprint on Stellar.')
              : t('Vespi comprobó las dos firmas. El anclaje está sin verificar.', 'Vespi verified both signatures. The anchor is unverified.')}</p>
            <dl className="mobile-details">
              <dt>{t('Huella', 'Fingerprint')}</dt><dd>{entry.commitment}</dd>
              <dt>{t('Firma de la propuesta', 'Proposal signature')}</dt><dd>{entry.proposalSignature}</dd>
              {entry.messages?.proposal && <><dt>{t('Mensaje firmado de la propuesta', 'Signed proposal message')}</dt><dd><code>{entry.messages.proposal}</code></dd></>}
              <dt>{t('Firma de la confirmación', 'Confirmation signature')}</dt><dd>{entry.decisionSignature}</dd>
              {entry.messages?.confirmation && <><dt>{t('Mensaje firmado de la confirmación', 'Signed confirmation message')}</dt><dd><code>{entry.messages.confirmation}</code></dd></>}
              {entry.anchor && <><dt>{t('Huella del recibo de anclaje', 'Anchor receipt digest')}</dt><dd>{entry.anchor.digest}</dd></>}
            </dl>
          </details>
          <ShareActions lang={lang} url={url} label={t('Compartir aporte', 'Share contribution')} message={description} />
        </>}
      </section>
    </div>
    <AppFooter lang={lang} />
  </main>;
}
