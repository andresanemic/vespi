import type { Metadata } from 'next';
import MobileContributions from './MobileContributions';
import MeridianFront from './encuentros/MeridianFront';
import { yerkoStatement } from './evento/yerko/event';
import { readYerkoSettings } from '@/lib/contributions/yerko-event';
import { DEFAULT_NETWORK, parseContributionNetwork } from '@/lib/contributions/network';
import { isEncounterId } from '@/lib/contributions/encounters';
import { focusEvent, focusRegistration, focusRoot } from '@/lib/contributions/focus-event';
import { redirect } from 'next/navigation';
import './mobile.css';

export const metadata: Metadata = {
  title: 'Vespi Contributions | Registrar un aporte',
  description: 'Registra un aporte y compártelo con la otra persona. Se hace público en Vespi cuando firman las dos.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/app' },
  referrer: 'no-referrer',
  openGraph: { type: 'website', siteName: 'Vespi', url: '/app', title: 'Vespi Contributions', description: 'Open Vespi to review a shared encounter and confirm it.', images: [{ url: '/og-contributions.png', width: 1200, height: 630, alt: 'Vespi Contributions: good work deserves a record.' }] },
  twitter: { card: 'summary_large_image', title: 'Vespi Contributions', description: 'Open Vespi to review a shared encounter and confirm it.', images: [{ url: '/x-contributions.png', alt: 'Vespi Contributions: good work deserves a record.' }] },
};

export default async function AppPage({ searchParams }: { searchParams: Promise<{ receipt?: string | string[]; continue?: string | string[]; observe?: string | string[]; back?: string | string[]; mutual?: string | string[]; return?: string | string[]; evento?: string | string[]; encuentro?: string | string[]; vista?: string | string[]; lang?: string | string[]; accion?: string | string[]; permiso?: string | string[]; network?: string | string[]; revision?: string | string[] }> }) {
  const { receipt, continue: continuation, observe: observation, back, mutual, return: second, evento, encuentro, vista, lang, accion, permiso, network, revision } = await searchParams;
  function root(value?: string | string[]) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  }
  const mutualRoot = root(mutual);
  const secondRoot = root(second);
  const pair = mutualRoot && secondRoot ? { first: mutualRoot, second: secondRoot } : undefined;
  const backRoot = root(back);
  const digest = typeof receipt === 'string' ? receipt : undefined;
  const target = typeof continuation === 'string' && /^[0-9a-f]{64}$/.test(continuation) ? continuation : undefined;
  const observe = typeof observation === 'string' && /^[0-9a-f]{64}$/.test(observation) ? observation : undefined;
  const focusRecord = evento === 'focus-group' && accion === 'pedir' && !observe && !target && !digest;
  let selected = DEFAULT_NETWORK;
  let invalidNetwork = false;
  if (network !== undefined && observation === undefined && (evento === undefined || digest !== undefined || target)) {
    try { selected = parseContributionNetwork(network); }
    catch { invalidNetwork = true; }
  }
  if (selected === DEFAULT_NETWORK && focusRoot && target === focusRoot && !invalidNetwork) {
    redirect(`${focusEvent.path}?lang=${lang === 'en' ? 'en' : 'es'}`);
  }
  if (receipt === undefined && continuation === undefined && observation === undefined &&
    back === undefined && mutual === undefined && second === undefined && evento === undefined && (vista !== 'aportes' || encuentro !== undefined)) {
    if (vista === 'encuentros' && encuentro === undefined && !invalidNetwork) {
      const query = new URLSearchParams({ vista: 'aportes' });
      if (lang === 'es' || lang === 'en') query.set('lang', lang);
      if (selected === 'mainnet') query.set('network', selected);
      redirect('/app?' + query);
    }
    const encounterId = typeof encuentro === 'string' ? encuentro : undefined;
    return <MeridianFront network={selected} entry={{ id: encounterId, invalidNetwork,
      legacyDraft: vista === 'borrador-encuentro', revision: isEncounterId(revision) ? revision : undefined,
      view: encounterId ? 'detail' : vista === 'registro' || vista === 'borrador-encuentro' ? 'wizard' : vista === 'como' ? 'how' : vista === 'ejemplo' ? 'example' : 'home' }} />;
  }
  const composeReceived = vista === 'aportes' && accion === 'recibi' && permiso === 'borrador';
  if (vista === 'aportes' && accion === 'recibi' && !composeReceived && !invalidNetwork && !digest && !target && !observe && !pair && !backRoot && !evento) {
    const query = new URLSearchParams({ vista: 'registro' });
    if (typeof lang === 'string') query.set('lang', lang);
    if (selected === 'mainnet') query.set('network', selected);
    redirect('/app?' + query);
  }
  const compose = focusRecord || composeReceived || (vista === 'aportes' || evento === 'yerko') && accion === 'pedir';
  const composeFlow = focusRecord ? 'focus-group' : evento === 'yerko' ? 'yerko' : compose ? 'compose' : 'register';
  const flow = pair ? pair.first + ':' + pair.second : digest ?? (observe ? 'observe:' + observe : target ?? backRoot ?? composeFlow);
  return <MobileContributions key={selected + ':' + invalidNetwork + ':' + flow} initialNetwork={selected} invalidNetwork={invalidNetwork}
    focusRecord={focusRecord} initialStatement={focusRecord ? focusRegistration : evento === 'yerko' ? yerkoStatement : undefined}
    initialLang={lang === 'en' || lang === 'es' ? lang : undefined}
    yerko={selected === DEFAULT_NETWORK && (observe || target) ? readYerkoSettings(process.env) : undefined} eventAttendance={evento === 'asistencia' && !!observe}
    digest={digest} target={target} observe={observe} backRoot={backRoot} mutual={mutualRoot} pair={pair}
    composeRequest={compose} composeReceived={composeReceived} expectsAssignment={permiso === 'entrega'} brokenContinuation={continuation !== undefined && !target} />;
}
