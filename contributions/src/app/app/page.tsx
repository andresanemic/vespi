import type { Metadata } from 'next';
import MobileContributions from './MobileContributions';
import MeridianFront from './encuentros/MeridianFront';
import { yerkoStatement } from './evento/yerko/event';
import { readYerkoSettings } from '@/lib/contributions/yerko-event';
import './mobile.css';

export const metadata: Metadata = {
  title: 'Vespi Contributions · Ensayo',
  description: 'Registra encuentros y aportes, compártelos para que cada persona pueda confirmarlos.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/app' },
  referrer: 'no-referrer',
  openGraph: { title: 'Vespi Contributions', description: 'Abre Vespi para revisar un encuentro compartido.' },
};

export default async function AppPage({ searchParams }: { searchParams: Promise<{ receipt?: string | string[]; continue?: string | string[]; observe?: string | string[]; back?: string | string[]; mutual?: string | string[]; return?: string | string[]; evento?: string | string[]; encuentro?: string | string[]; vista?: string | string[]; lang?: string | string[] }> }) {
  const { receipt, continue: continuation, observe: observation, back, mutual, return: second, evento, encuentro, vista, lang } = await searchParams;
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
  if (receipt === undefined && continuation === undefined && observation === undefined &&
    back === undefined && mutual === undefined && second === undefined && evento === undefined && vista !== 'aportes') {
    const encounterId = typeof encuentro === 'string' ? encuentro : undefined;
    return <MeridianFront entry={{ id: encounterId,
      view: encounterId ? 'detail' : vista === 'encuentros' ? 'records' : vista === 'como' ? 'how' : vista === 'ejemplo' ? 'example' : 'home' }} />;
  }
  return <MobileContributions key={pair ? pair.first + ':' + pair.second : digest ?? (observe ? 'observe:' + observe : target ?? backRoot ?? (evento === 'yerko' ? 'yerko' : 'register'))}
    initialStatement={evento === 'yerko' ? yerkoStatement : undefined} initialLang={lang === 'en' || lang === 'es' ? lang : undefined}
    yerko={observe || target ? readYerkoSettings(process.env) : undefined} eventAttendance={evento === 'asistencia' && !!observe}
    digest={digest} target={target} observe={observe} backRoot={backRoot} mutual={mutualRoot} pair={pair} />;
}
