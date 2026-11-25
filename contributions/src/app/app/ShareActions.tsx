'use client';

import { useEffect, useRef, useState } from 'react';
import type { Lang } from '@/lib/i18n';

const copy = {
  es: { other: 'WhatsApp', copy: 'Copiar enlace', copied: 'Enlace copiado', manual: 'Selecciona y copia este enlace.', url: 'Enlace para compartir',
    account: 'Copiar cuenta', accountCopied: 'Cuenta copiada', accountManual: 'Selecciona y copia esta cuenta.', accountValue: 'Cuenta para compartir' },
  en: { other: 'WhatsApp', copy: 'Copy link', copied: 'Link copied', manual: 'Select and copy this link.', url: 'Link to share',
    account: 'Copy account', accountCopied: 'Account copied', accountManual: 'Select and copy this account.', accountValue: 'Account to share' },
};

export default function ShareActions({ lang, url, account, label, message }: { lang: Lang; label: string; message: string } &
  ({ url: string; account?: never } | { account: string; url?: never })) {
  const t = copy[lang];
  const [status, setStatus] = useState<'copied' | 'manual'>();
  const field = useRef<HTMLInputElement>(null);
  const manual = status === 'manual';

  useEffect(() => {
    if (manual) { field.current?.focus(); field.current?.select(); }
  }, [manual]);

  const value = account ?? url;

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  async function share() {
    const text = account ? message + '\n' + account : message;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copyValue();
  }

  const whatsapp = new URL('https://wa.me/');
  whatsapp.searchParams.set('text', message + '\n' + value);
  return <div className="mobile-actions share-actions">
    <button className="mobile-action" type="button" onClick={share}>{label}</button>
    <div className="share-actions-options">
      <a className="mobile-secondary" href={whatsapp.toString()} target="_blank" rel="noopener noreferrer">{t.other}</a>
      <button className="mobile-secondary" type="button" onClick={copyValue}>{account ? t.account : t.copy}</button>
    </div>
    {manual && <input ref={field} aria-label={account ? t.accountValue : t.url} value={value} readOnly onFocus={event => event.target.select()} />}
    {status && <p className="mobile-note" role="status">{account ? (manual ? t.accountManual : t.accountCopied) : t[status]}</p>}
  </div>;
}
