import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import ThemeSwitch from '@/components/ThemeSwitch';
import AppBrand from '@/app/app/AppBrand';
import { GET as readHead } from '@/app/api/contributions/chains/[digest]/route';
import { GET as readReceipt } from '@/app/api/contributions/receipts/[digest]/route';
import { GET as readProfile } from '@/app/api/contributions/profiles/[account]/route';
import { chainEvidenceScope, evidenceApiUrl, readEvidenceChain } from '@/lib/contributions/chain-evidence.mjs';
import { contributionNetwork, DEFAULT_NETWORK, parseContributionNetwork, type ContributionNetwork } from '@/lib/contributions/network';
import { SITE_URL } from '@/lib/seo';
const copy = {
  es: {
    title: 'Resultado de la cadena', description: 'Consulta las huellas, las cuentas firmantes y las transacciones de la cadena de aportes.',
    pending: 'Cadena en curso', pendingBody: 'El resultado estará disponible cuando se confirmen los tres pasos.',
    unavailable: 'Resultado no disponible', unavailableBody: 'No se pudo verificar la cadena. Vuelve a intentarlo más tarde.',
    roles: ['Solicitud', 'Aporte', 'Aceptación'], actors: ['Solicitante', 'Colaborador', 'Solicitante'],
    verified: '3 pasos verificados', fingerprint: 'Huella', transaction: 'Transacción', revision: 'Versión', accepted: 'aceptada',
    checks: 'El servidor comprobó la huella de cada recibo, el memo y la firma de su transacción, y el enlace con el recibo anterior.',
    repository: 'Paquete de evidencia',
  },
  en: {
    title: 'Chain result', description: 'See the receipt hashes, signing accounts and transactions in this contribution chain.',
    pending: 'Chain in progress', pendingBody: 'The result will be available when all three steps are confirmed.',
    unavailable: 'Result unavailable', unavailableBody: 'The chain could not be verified. Try again later.',
    roles: ['Request', 'Contribution', 'Acceptance'], actors: ['Requester', 'Contributor', 'Requester'],
    verified: '3 verified steps', fingerprint: 'Digest', transaction: 'Transaction', revision: 'Version', accepted: 'accepted',
    checks: 'The server checked each receipt digest, its transaction memo and signature, and its link to the previous receipt.',
    repository: 'Evidence package',
  },
};

type Step = {
  actor: string;
  name: string | null;
  createdAt: string;
  digest: string;
  txHash: string;
  accepted: boolean;
};

type Props = {
  lang: keyof typeof copy;
  network: ContributionNetwork;
  path: string;
  explorer: string;
  scope: string;
  state: 'complete' | 'pending' | 'unavailable';
  steps: Step[][];
  repository: string | null;
};

async function displayName(account: string, network: ContributionNetwork) {
  const url = evidenceApiUrl(SITE_URL, '/profiles/' + account, network);
  const response = await readProfile(new Request(url), { params: Promise.resolve({ account }) });
  if (!response.ok) return undefined;
  const profile = await response.json();
  const name = profile.displayName;
  return profile.account === account && typeof name === 'string' && /^[\p{L}\p{M}\p{N} .'’-]{3,40}$/u.test(name) ? name : undefined;
}

export const getServerSideProps: GetServerSideProps<Props, { digest: string }> = async ({ params, query, res }) => {
  if (!params) return { notFound: true };
  let network;
  try { network = parseContributionNetwork(query.network ?? DEFAULT_NETWORK); }
  catch { return { notFound: true }; }

  const { digest } = params;
  const lang = query.lang === 'en' ? 'en' : 'es';
  const path = '/app/cadena/' + digest + (network === 'mainnet' ? '?network=mainnet' : '');
  const { explorer } = contributionNetwork(network);
  const base = { lang, network, path, explorer, scope: chainEvidenceScope[lang] } as const;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await readEvidenceChain(path => {
      const url = evidenceApiUrl(SITE_URL, path, network);
      const context = { params: Promise.resolve({ digest: url.pathname.split('/').at(-1)! }) };
      return (path.startsWith('/chains/') ? readHead : readReceipt)(new Request(url), context);
    }, digest, network);
    if (result.state === 'missing') return { notFound: true };
    if (result.state === 'pending') return { props: { ...base, state: 'pending', steps: [], repository: null } };

    const { entries } = result;
    const accepted = entries.at(-1)?.receipt.subject;
    const accounts = [...new Set<string>(entries.map(({ receipt }) => receipt.actor))];
    const names = new Map(await Promise.all(accounts.map(async account => [account, await displayName(account, network)] as const)));
    // Pages Router serializes props to the browser. Keep signed text and profile mismatches on the server.
    const publicSteps: Step[] = entries.map(({ receipt, index }) => {
      const name = names.get(receipt.actor);
      const signedName = name && new RegExp('(?<![\\p{L}\\p{M}\\p{N}\\p{Pc}])' + name.replaceAll('.', '\\.') +
        '(?![\\p{L}\\p{M}\\p{N}\\p{Pc}])', 'iu').test(receipt.statement);
      return {
        actor: receipt.actor, name: signedName ? name : null, createdAt: receipt.createdAt,
        digest: index.digest, txHash: index.txHash, accepted: index.digest === accepted,
      };
    });
    const steps = [publicSteps.slice(0, 1), publicSteps.slice(1, -1), publicSteps.slice(-1)];
    const configured = process.env.CONTRIB_EVIDENCE_REPO_URL;
    const url = network === 'mainnet' && configured && URL.canParse(configured) ? new URL(configured) : null;
    const repository = url && ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    return { props: { ...base, state: 'complete', steps, repository } };
  } catch {
    res.statusCode = 503;
    return { props: { ...base, state: 'unavailable', steps: [], repository: null } };
  }
};

function ChainMetadata({ lang, network, path, state }: Props) {
  const t = copy[lang];
  const title = (state === 'complete' ? t.title : t[state]) + ' | Vespi Contributions';
  const description = state === 'complete' ? t.description : t[state === 'pending' ? 'pendingBody' : 'unavailableBody'];
  const url = new URL(path, SITE_URL).href;
  const image = new URL('/og-chain-' + network + '-' + lang + '.png', SITE_URL).href;
  const alt = 'Vespi Contributions · Stellar ' + network + ' · ' + t.verified;
  return <Head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <link rel="canonical" href={url} />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Vespi" />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={url} />
    <meta property="og:locale" content={lang === 'es' ? 'es_CL' : 'en_US'} />
    <meta name="twitter:card" content={state === 'complete' ? 'summary_large_image' : 'summary'} />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    {state === 'complete' && <>
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={alt} />
      <meta name="twitter:image" content={image} />
    </>}
  </Head>;
}

const short = (value: string) => value.slice(0, 6) + '…' + value.slice(-6);

export default function ChainResult(props: Props) {
  const { lang, network, path, state, steps, explorer, scope, repository } = props;
  const t = copy[lang];
  const complete = state === 'complete';
  const date = new Intl.DateTimeFormat(lang === 'es' ? 'es-CL' : 'en', { dateStyle: 'medium', timeZone: 'UTC' });
  return <main className="mobile-contributions chain-result" lang={lang}>
    <ChainMetadata {...props} />
    <header className="mobile-top">
      <AppBrand />
      <div className="mobile-settings">
        <a href={path + (path.includes('?') ? '&' : '?') + 'lang=' + (lang === 'es' ? 'en' : 'es')}
          aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</a>
        <ThemeSwitch lang={lang} />
      </div>
    </header>
    <div className="mobile-sheet">
      <div className="mobile-network" data-mainnet={network === 'mainnet' || undefined}>
        <span className="mobile-network-label">{network === 'mainnet' && <span className="mobile-network-dot" aria-hidden="true" />}
          {network === 'mainnet' ? 'Mainnet' : 'Testnet'}
        </span>
      </div>
      <section className="mobile-content" aria-labelledby="chain-heading">
        <h1 id="chain-heading">{state === 'complete' ? t.title : t[state]}</h1>
        {complete ? <>
          <ol className="chain-steps" role="list">
            {steps.map((step, i) => <li key={t.roles[i]}>
              <h2>{t.roles[i]}</h2>
              {step.map(({ actor, name, createdAt, digest, txHash, accepted }, j) =>
                <div className="chain-step" key={digest}>
                  {step.length > 1 && <h3>{t.revision} {j + 1}{accepted ? ' (' + t.accepted + ')' : ''}</h3>}
                  <div className="chain-step-meta">
                    <a href={explorer + '/account/' + actor}
                      aria-label={t.actors[i] + ' ' + (name ? name + ' ' : '') + actor}>
                      {t.actors[i]}{name ? ' · ' + name : ''} <span>{short(actor)}</span>
                    </a>
                    <time dateTime={createdAt}>{date.format(new Date(createdAt))} UTC</time>
                  </div>
                  <dl>
                    <div><dt>{t.fingerprint}</dt><dd><code>{digest}</code></dd></div>
                    <div><dt className="sr-only">{t.transaction}</dt><dd><a href={explorer + '/tx/' + txHash}
                      aria-label={t.transaction + ' ' + txHash}>{t.transaction} <span>{short(txHash)}</span></a></dd></div>
                  </dl>
                </div>)}
            </li>)}
          </ol>
          <section className="chain-verification" aria-labelledby="chain-verification">
            <h2 id="chain-verification">{t.verified}</h2>
            <p>{t.checks}</p>
            <p>{scope}</p>
            {repository && <a href={repository}>{t.repository}</a>}
          </section>
        </> : <p>{state === 'pending' ? t.pendingBody : t.unavailableBody}</p>}
      </section>
    </div>
  </main>;
}
