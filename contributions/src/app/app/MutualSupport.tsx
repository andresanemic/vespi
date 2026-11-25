'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Lang } from '@/lib/i18n';
import type { ContributionNetwork } from '@/lib/contributions/network';
import { loadChain } from './ChainAction';
import { contributionLink, getDisplayName, withContributionNetwork } from './client';
import ShareActions from './ShareActions';

const copies = {
  es: {
    loading: 'Comprobando ambos aportes…', unavailable: 'No pudimos comprobar este apoyo mutuo.',
    mismatched: 'Estas cadenas no acreditan aportes entre las mismas dos cuentas en direcciones opuestas.',
    count: (n: number) => n + ' de 2 aportes aceptados', needs: 'debe revisar y decidir si acepta.',
    accepted: 'Aceptado', pending: 'Entregado, falta aceptación', awaiting: 'Falta la entrega',
    review: 'Revisar y aceptar este aporte', first: 'Primer aporte', second: 'Apoyo de vuelta', receipt: 'Verificar este aporte',
    share: 'Compartir apoyo mutuo', shareText: 'Estos son los dos aportes reunidos en Vespi Contributions.',
    explanation: 'Esta vista reúne dos cadenas independientes. Cada aceptación queda firmada en su propio recibo.',
  },
  en: {
    loading: 'Checking both contributions…', unavailable: 'We could not verify this mutual support.',
    mismatched: 'These chains do not establish contributions between the same two accounts in opposite directions.',
    count: (n: number) => n + ' of 2 contributions accepted', needs: 'reviews and decides whether to accept.',
    accepted: 'Accepted', pending: 'Delivered, awaiting acceptance', awaiting: 'Awaiting delivery',
    review: 'Review and accept this contribution', first: 'First contribution', second: 'Return contribution', receipt: 'Verify this contribution',
    share: 'Share mutual support', shareText: 'Here are the two contributions grouped in Vespi Contributions.',
    explanation: 'This view groups two independent chains. Each acceptance is signed in its own receipt.',
  },
};

type Chain = Awaited<ReturnType<typeof loadChain>>;
export function confirmedDelivery(chain: Chain) {
  return chain.acceptedDelivery ?? (chain.head.receipt.kind === 'CONTRIBUTE' ? chain.head : undefined);
}

export default function MutualSupport({ lang, first, second, network }: { lang: Lang; first: string; second: string; network: ContributionNetwork }) {
  const t = copies[lang];
  const [pair, setPair] = useState<{ first: Chain; second: Chain; people: Record<string, string> }>();
  const [error, setError] = useState<'unavailable' | 'mismatched'>();
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([loadChain(first, controller.signal, network), loadChain(second, controller.signal, network)]).then(([initial, returning]) => {
      if (controller.signal.aborted) return;
      const a = initial.request.receipt.actor;
      const b = returning.request.receipt.actor;
      const firstDelivery = confirmedDelivery(initial);
      const secondDelivery = confirmedDelivery(returning);
      if (first === second || initial.request.index.digest !== first || returning.request.index.digest !== second ||
        a === b || firstDelivery?.receipt.actor !== b || (secondDelivery && secondDelivery.receipt.actor !== a)) {
        setError('mismatched');
        return;
      }
      setPair({ first: initial, second: returning, people: {} });
      setShareUrl(location.origin + withContributionNetwork('/app?mutual=' + first + '&return=' + second, network));
      void Promise.all([getDisplayName(a).catch(() => null), getDisplayName(b).catch(() => null)]).then(([aName, bName]) => {
        if (!controller.signal.aborted) setPair({ first: initial, second: returning,
          people: { ...(aName && { [a]: aName }), ...(bName && { [b]: bName }) } });
      });
    }).catch(() => { if (!controller.signal.aborted) setError('unavailable'); });
    return () => controller.abort();
  }, [first, second, network]);

  if (error) return <p role="alert">{t[error]}</p>;
  if (!pair) return <p role="status">{t.loading}</p>;
  const a = pair.first.request.receipt.actor;
  const b = pair.second.request.receipt.actor;
  const name = (account: string) => pair.people[account] ?? account.slice(0, 6) + '…' + account.slice(-6);
  const accepted = [pair.first, pair.second].filter(chain => chain.head.receipt.kind === 'ACCEPT').length;
  return <>
    <p role="status"><strong>{t.count(accepted)}</strong></p>
    <dl className="mobile-chain-summary">
      {([{ chain: pair.first, title: t.first, from: b, to: a }, { chain: pair.second, title: t.second, from: a, to: b }])
        .map(({ chain, title, from, to }) => {
          const delivery = confirmedDelivery(chain);
          return <div key={chain.request.index.digest}>
            <dt>{title} · {name(from)} → {name(to)}</dt>
            <dd>
              <p>{chain.head.receipt.kind === 'ACCEPT' ? t.accepted : delivery ? t.pending : t.awaiting}</p>
              {delivery && chain.head.receipt.kind !== 'ACCEPT' && <p>{name(to)} {t.needs}</p>}
              <p>{delivery?.receipt.statement ?? chain.request.receipt.statement}</p>
              {delivery && chain.head.receipt.kind !== 'ACCEPT' && <Link className="mobile-secondary"
                href={contributionLink('continue', delivery.index.digest, chain === pair.second ? first : undefined, network)}>{t.review}</Link>}
              <Link href={contributionLink('receipt', chain.head.index.digest, chain === pair.second ? first : undefined, network)}>{t.receipt}</Link>
            </dd>
          </div>;
        })}
    </dl>
    <p className="mobile-note">{t.explanation}</p>
    {shareUrl && <ShareActions lang={lang} url={shareUrl} label={t.share} message={t.shareText} />}
  </>;
}
