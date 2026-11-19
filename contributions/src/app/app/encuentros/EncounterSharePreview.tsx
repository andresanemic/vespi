'use client';

import type { Lang } from '@/lib/i18n';
import ShareActions from '../ShareActions';

export default function EncounterSharePreview({ lang, url, label, message }: {
  lang: Lang; url: string; label: string; message: string;
}) {
  return <>
    <details>
      <summary>{lang === 'es' ? 'Así se verá tu invitación' : 'Preview your invitation'}</summary>
      <blockquote>
        {message}
        <p><strong>Vespi Contributions</strong><br />{lang === 'es' ? 'Revisa un encuentro compartido' : 'Review a shared encounter'}</p>
      </blockquote>
    </details>
    <ShareActions lang={lang} url={url} label={label} message={message} />
  </>;
}
