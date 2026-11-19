'use client';

import { useEffect, useRef, useState } from 'react';
import type { Lang } from '@/lib/i18n';

const copy = {
  es: { other: 'WhatsApp', copy: 'Copiar enlace', copied: 'Enlace copiado', manual: 'Selecciona y copia este enlace.', url: 'Enlace para compartir' },
  en: { other: 'WhatsApp', copy: 'Copy link', copied: 'Link copied', manual: 'Select and copy this link.', url: 'Link to share' },
};

export default function ShareActions({ lang, url, label, message }: { lang: Lang; url: string; label: string; message: string }) {
  const t = copy[lang];
  const [status, setStatus] = useState<'copied' | 'manual'>();
  const field = useRef<HTMLInputElement>(null);
  const manual = status === 'manual';

  useEffect(() => {
    if (manual) { field.current?.focus(); field.current?.select(); }
  }, [manual]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: message, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copyLink();
  }

  const whatsapp = new URL('https://wa.me/');
  whatsapp.searchParams.set('text', message + '\n' + url);
  return <div className="mobile-actions share-actions">
    <button className="mobile-action" type="button" onClick={share}>{label}</button>
    <div className="share-actions-options">
      <a className="mobile-secondary" href={whatsapp.toString()} target="_blank" rel="noopener noreferrer">{t.other}</a>
      <button className="mobile-secondary" type="button" onClick={copyLink}>{t.copy}</button>
    </div>
    {manual && <input ref={field} aria-label={t.url} value={url} readOnly onFocus={event => event.target.select()} />}
    {status && <p className="mobile-note" role="status">{t[status]}</p>}
  </div>;
}
