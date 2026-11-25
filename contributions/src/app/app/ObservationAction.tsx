'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { Signer } from '@/lib/contributions/keys';
import type { Lang } from '@/lib/i18n';
import { anchorAttempt, FlowError, makeObservation, prepareRequest, readObservationTarget, uploadContributionPhoto, verifyPrepared, type Attempt } from './client';
import { yerkoSpeaker, yerkoTitle } from './evento/yerko/event';
import { focusAttendance, focusEvent, type focusPhase as getFocusPhase } from '@/lib/contributions/focus-event';

const copy = {
  es: {
    delivered: 'Entrega observada', statement: 'Observé el aporte descrito en este recibo.',
    consent: 'Al firmar, tu cuenta, la declaración y tu comentario quedarán públicos. El testimonio no acepta el aporte.',
    comment: 'Comentario opcional', sign: 'Firmar testimonio', retry: 'Comprobar de nuevo',
    loading: 'Comprobando la entrega…', signing: 'Comprobando el testimonio…',
    failed: 'No pudimos verificar esta entrega.', retryRead: 'Volver a comprobar la entrega',
    ineligible: 'El testimonio lo firma una tercera persona. Quien pidió o entregó el aporte no puede firmarlo.',
    pending: 'Todavía no pudimos confirmar el testimonio.', fresh: 'Ese intento no se registró. Puedes volver a firmar.',
    verified: 'Testimonio registrado', receipt: 'Abrir recibo del testimonio',
    photo: 'Adjuntar foto', talkPhoto: 'Adjuntar foto de la charla', remove: 'Quitar foto', preview: 'Foto que adjuntarás al testimonio',
    photoPublic: 'La foto también se podrá ver en el recibo.', photoError: 'No se pudo preparar o subir la foto. Prueba de nuevo o quítala para continuar.',
    photoReady: 'Foto lista para firmar', photoLoading: 'Preparando la foto…',
    closed: 'El registro de testimonios está cerrado.', signer: 'Firmarás como',
    focusConsent: 'Firmar es opcional. Tu nombre y tu cuenta quedarán públicos como asistente y no se podrán borrar; lo que digas en la conversación no se publica aquí.',
    focusEarly: 'Podrás firmar tu asistencia cuando empiece.', focusClosed: 'El registro de asistencia está cerrado.',
    alreadySigned: 'Tu cuenta ya firmó la asistencia. Puedes ver la firma en tu perfil.',
    focusIneligible: 'La cuenta que registró el evento no puede firmar como asistente.',
  },
  en: {
    delivered: 'Observed delivery', statement: 'I observed the contribution described in this receipt.',
    consent: 'Signing makes your account, statement and comment public. A testimony does not accept the contribution.',
    comment: 'Optional comment', sign: 'Sign testimony', retry: 'Check again',
    loading: 'Checking the delivery…', signing: 'Checking the testimony…',
    failed: 'We could not verify this delivery.', retryRead: 'Check the delivery again',
    ineligible: 'A third person signs the testimony. The requester and contributor cannot sign it.',
    pending: 'We could not confirm the testimony yet.', fresh: 'That attempt was not registered. You can sign again.',
    verified: 'Testimony registered', receipt: 'Open the testimony receipt',
    photo: 'Attach a photo', talkPhoto: 'Attach a photo of the talk', remove: 'Remove photo', preview: 'Photo you will attach to the testimony',
    photoPublic: 'The photo will also be visible on the receipt.', photoError: 'We could not prepare or upload the photo. Try again or remove it to continue.',
    photoReady: 'Photo ready to sign', photoLoading: 'Preparing the photo…',
    closed: 'Testimonies are closed.', signer: 'You will sign as',
    focusConsent: 'Signing is optional. Your name and account will be public as an attendee and cannot be deleted. What you say in the conversation will not be published here.',
    focusEarly: 'You can sign your attendance once the event starts.', focusClosed: 'Attendance signing is closed.',
    alreadySigned: 'Your account has already signed attendance. You can see the signature on your profile.',
    focusIneligible: 'The account that registered the event cannot sign as an attendee.',
  },
};

type Target = Awaited<ReturnType<typeof readObservationTarget>>;
type Draft = ReturnType<typeof makeObservation>;
type Signed = { draft: Draft; attempt: Attempt };

async function preparePhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Photo could not be decoded');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    if (!photo || photo.size > 2 * 1024 * 1024) throw new Error('Photo could not be prepared');
    return photo;
  } finally {
    bitmap.close();
  }
}

export default function ObservationAction({ lang, subject, account, getSigner, name, yerko, focusPhase }: {
  lang: Lang; subject: string; account: string; getSigner(): Promise<Signer>; name?: string; yerko?: { root: string; account: string; closed: boolean };
  focusPhase?: ReturnType<typeof getFocusPhase> | null;
}) {
  const t = copy[lang];
  const [target, setTarget] = useState<Target>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'pending' | 'fresh' | 'photoError' | 'closed' | 'focusEarly' | 'focusClosed' | 'alreadySigned'>();
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState<{ file: Blob; preview: string }>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [signed, setSigned] = useState<Signed>();
  const [done, setDone] = useState('');
  const key = 'vespi-contributions:observation:' + account + ':' + subject;
  const ineligible = target && [target.request.receipt.actor, target.delivery?.receipt.actor].includes(account);
  const event = yerko && target?.request.index.digest === yerko.root && target.delivery?.receipt.actor === yerko.account;
  const focus = focusPhase !== undefined;
  const closed = focus ? focusPhase !== 'open' : event && yerko?.closed;
  const statement = focus ? focusAttendance[lang] : event ? lang === 'es' ? `Asistí a la charla «${yerkoTitle}» de ${yerkoSpeaker}.`
    : `I attended “${yerkoTitle}” by ${yerkoSpeaker}.` : t.statement;
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  useEffect(() => {
    const controller = new AbortController();
    readObservationTarget(subject, controller.signal).then(async linked => {
      if (controller.signal.aborted) return;
      try {
        const saved: Signed | null = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (saved && saved.draft.kind === 'ATTEST' && saved.draft.actor === account &&
          saved.draft.chain === linked.request.index.digest && saved.draft.subject === subject &&
          (linked.delivery || saved.draft.comment === null && saved.draft.evidence === null && Object.values(focusAttendance).includes(saved.draft.statement))) {
          await verifyPrepared(saved.attempt.bytes, saved.attempt.digest, saved.draft);
          if (!controller.signal.aborted) setSigned(saved);
        }
      } catch {}
      if (!controller.signal.aborted) setTarget(linked);
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [key, reload, account, subject]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || photoBusy || !target || ineligible || (closed && !signed)) return;
    setBusy(true);
    setProblem(undefined);
    let pending = signed;
    try {
      if (!pending) {
        let evidence = null;
        if (!focus && photo) {
          try {
            evidence = await uploadContributionPhoto(photo.file, await getSigner());
          } catch {
            setProblem('photoError');
            return;
          }
        }
        const draft = makeObservation(account, target.request.index.digest, subject, statement,
          focus ? null : comment.trim().normalize('NFC') || null, evidence);
        pending = { draft, attempt: await prepareRequest(draft, await getSigner()) };
        setSigned(pending);
        try { localStorage.setItem(key, JSON.stringify(pending)); } catch {}
      }
      const index = await anchorAttempt(pending.attempt);
      try { localStorage.removeItem(key); } catch {}
      setDone(index.digest);
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : '';
      if (['invalid-timebound', 'inner-failed', 'retry-with-fresh-transaction'].includes(reason)) {
        setSigned(undefined);
        try { localStorage.removeItem(key); } catch {}
        if (pending) setComment(pending.draft.comment ?? '');
        setProblem('fresh');
      } else if (focus && ['event-not-open', 'event-closed', 'attendance-already-signed'].includes(reason)) {
        setProblem(reason === 'attendance-already-signed' ? 'alreadySigned' : reason === 'event-closed' ? 'focusClosed' : 'focusEarly');
        setSigned(undefined);
        try { localStorage.removeItem(key); } catch {}
      } else setProblem(reason === 'event-closed' ? 'closed' : 'pending');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <>
    <p role="status">{t.verified}</p>
    <Link className="mobile-action" href={'/app?receipt=' + done + (focus ? '&lang=' + lang : '')}>{t.receipt}</Link>
  </>;
  if (loading) return <p role="status">{t.loading}</p>;
  if (!target) return <>
    <p role="alert">{t.failed}</p>
    <button className="mobile-action" type="button" onClick={() => { setLoading(true); setReload(reload + 1); }}>{t.retryRead}</button>
  </>;
  return <>
    {!focus && <><p><strong>{t.delivered}</strong></p><blockquote>{target.delivery?.receipt.statement}</blockquote></>}
    {ineligible ? <p>{focus ? t.focusIneligible : t.ineligible}</p> : closed && !signed ? <p>{focus ? focusPhase === 'closed' ? t.focusClosed : t.focusEarly : t.closed}</p>
      : problem === 'alreadySigned' ? <Link className="mobile-secondary" href={'/app/perfil/' + account + '?lang=' + lang}>{lang === 'es' ? 'Ver mi perfil' : 'View my profile'}</Link>
      : <form className="mobile-actions" onSubmit={publish}>
      <blockquote>{signed?.draft.statement ?? statement}</blockquote>
      {!focus && (signed ? signed.draft.comment && <p>{signed.draft.comment}</p> : <>
        <label htmlFor="observation-comment">{t.comment}</label>
        <input id="observation-comment" autoComplete="off" maxLength={280} value={comment}
          onChange={event => setComment(event.target.value)} disabled={busy} />
      </>)}
      {!focus && !signed && <>
        <label htmlFor="testimony-photo">{event ? t.talkPhoto : t.photo}</label>
        <input id="testimony-photo" type="file" accept="image/*" disabled={busy || photoBusy} onChange={async event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setPhotoBusy(true);
          setProblem(undefined);
          try {
            const ready = await preparePhoto(file);
            setPhoto({ file: ready, preview: URL.createObjectURL(ready) });
          } catch {
            setProblem('photoError');
          } finally {
            setPhotoBusy(false);
          }
        }} />
        {photoBusy && <p role="status">{t.photoLoading}</p>}
        {photo && <>
          {/* eslint-disable-next-line @next/next/no-img-element -- local file, not a server image */}
          <img className="testimony-photo" src={photo.preview} alt={t.preview} />
          <p role="status">{t.photoReady}</p>
          <button type="button" className="mobile-text-action" disabled={busy || photoBusy} onClick={() => { setPhoto(undefined); setProblem(undefined); }}>{t.remove}</button>
        </>}
      </>}
      {name && <p><strong>{t.signer} {name}</strong></p>}
      <p className="mobile-note">{focus ? t.focusConsent : t.consent}</p>
      {(photo || signed?.draft.evidence) && <p className="mobile-note">{t.photoPublic}</p>}
      <button className="mobile-action" type="submit" disabled={busy || photoBusy}>{signed ? t.retry : focus ? focusEvent.copy[lang].attend : t.sign}</button>
    </form>}
    {busy && <p role="status">{t.signing}</p>}
    {problem && <p className="mobile-message" role="alert">{t[problem]}</p>}
  </>;
}
