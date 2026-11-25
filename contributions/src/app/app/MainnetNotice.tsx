import Link from 'next/link';
import type { Lang } from '@/lib/i18n';

const copy = {
  es: {
    warning: 'Esto queda en Stellar mainnet de forma permanente y se publica con su recibo.',
    passkey: 'La misma passkey abre tu cuenta en ambas redes. Sin la passkey no hay recuperación.',
    setup: 'Si activas tu cuenta por primera vez en mainnet, su dirección también quedará pública.',
    assignment: 'La autorización de entrega se comparte con la invitación. Este es el texto público de la solicitud.',
    account: 'Cuenta',
    testnet: 'Seguir en testnet',
    'mainnet-unavailable': 'Stellar mainnet no está disponible ahora.',
    'account-not-allowed': 'Esta cuenta no está habilitada para firmar en Stellar mainnet.',
    'mainnet-not-supported': 'Este paso solo está disponible en testnet.',
  },
  en: {
    warning: 'This stays on Stellar mainnet permanently and is published with its receipt.',
    passkey: 'The same passkey opens your account on both networks. There is no recovery without it.',
    setup: 'If you activate your account on mainnet for the first time, its address will also become public.',
    assignment: 'The delivery authorization is shared with the invitation. This is the public request text.',
    account: 'Account',
    testnet: 'Continue on testnet',
    'mainnet-unavailable': 'Stellar mainnet is unavailable right now.',
    'account-not-allowed': 'This account is not enabled to sign on Stellar mainnet.',
    'mainnet-not-supported': 'This step is only available on testnet.',
  },
};

export function PasskeyNetworkNote({ lang }: { lang: Lang }) {
  return <p className="mobile-note">{copy[lang].passkey}</p>;
}

export function mainnetBlocked(reason: string) {
  return reason === 'mainnet-unavailable' || reason === 'account-not-allowed' || reason === 'mainnet-not-supported';
}

export function testnetAccountMissing(lang: Lang) {
  return lang === 'es'
    ? 'Tu cuenta ya no existe en Stellar testnet. La red de pruebas puede haberse reiniciado. Sal y vuelve a entrar para reactivarla.'
    : 'Your account no longer exists on Stellar testnet. The test network may have reset. Sign out and back in to reactivate it.';
}

export function MainnetFailure({ lang, reason, showTestnet = true }: { lang: Lang; reason: string; showTestnet?: boolean }) {
  if (!mainnetBlocked(reason)) return null;
  return <>
    <p className="mobile-message" role="alert">{copy[lang][reason]}</p>
    {showTestnet && <Link className="mobile-secondary" href="/app?vista=aportes">{copy[lang].testnet}</Link>}
  </>;
}

export default function MainnetNotice({ lang, actor, statement, comment, assignment, previewFirst }: {
  lang: Lang;
  actor: string;
  statement: string;
  comment?: string | null;
  assignment?: boolean;
  previewFirst?: boolean;
}) {
  const t = copy[lang];
  const preview = <>
    <blockquote>{statement}</blockquote>
    {comment && <p className="mobile-public-comment">{comment}</p>}
  </>;
  return <>
    {previewFirst && preview}
    <div className="mobile-mainnet-notice">
      <p><strong>{t.warning}</strong></p>
      <p>{t.account} <code>{actor}</code></p>
      {assignment && <p>{t.assignment}</p>}
      {!previewFirst && preview}
      <PasskeyNetworkNote lang={lang} />
      {!assignment && <p className="mobile-note">{t.setup}</p>}
    </div>
  </>;
}
