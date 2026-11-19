'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Signer } from '@/lib/contributions/keys';
import type { Lang } from '@/lib/i18n';
import { anchorAttempt, FlowError, makeSurveyReceipt, prepareRequest, verifyPrepared } from '../client';
import { readSurveyState, saveSurveyState, submitSurvey, type Answer, type Cohort, type SurveyState } from './survey-client';

const copies = {
  es: {
    intro: 'Tus respuestas son privadas y solo las ve el equipo del evento.',
    usefulness: '¿Qué tan útil te resultó la tarde?',
    building: '¿Estás construyendo algo, o te gustaría? ¿Qué?',
    buildingLabel: 'Estoy construyendo un proyecto',
    project: 'Cuéntanos qué',
    ambassador: '¿Te interesa ser embajador o embajadora de Stellar Chile?',
    ambassadorLabel: 'Sí, me interesa',
    next: '¿Qué tema te gustaría para un próximo evento?',
    email: 'Tu correo, para avisarte del siguiente.',
    emailNote: 'Es opcional y se mantiene privado.',
    send: 'Enviar respuestas', sending: 'Guardando tus respuestas…',
    saved: 'Recibimos tus respuestas', anonymous: 'Gracias por responder la encuesta.',
    signNote: 'Si firmas, tu cuenta y la huella de tu respuesta aparecerán en un recibo público. Tus respuestas y correo seguirán siendo privados.',
    sign: 'Firmar «Respondí la encuesta»', signing: 'Comprobando la firma…',
    pending: 'Comprobar de nuevo', receipt: 'Abrir recibo público',
    code: 'Guardar mi código privado', downloadProof: 'Descargar mis respuestas y el código',
    proofNote: 'El archivo contiene tus respuestas, incluido el correo si lo escribiste. Guárdalo en privado.', codeNote: 'Conserva este código junto con tus respuestas exactas para verificar la huella más adelante. No lo publiques.',
    mismatch: 'La huella que recibimos no coincide con tus respuestas. Puedes intentar enviarlas otra vez.',
    unavailable: 'No pudimos confirmar el envío. Vuelve a intentar con las mismas respuestas.',
    used: 'Ya hay un envío con este código. Para reintentar, vuelve a escribir las mismas respuestas.',
    cohortChanged: 'Terminó el ensayo. Reabre la encuesta del evento para volver a ingresar tus respuestas.',
    reopen: 'Reabrir la encuesta',
    closed: 'La encuesta ya cerró.',
    signClosed: 'Tus respuestas quedaron guardadas. Cerró el plazo para firmar el recibo.',
    signError: 'No pudimos confirmar la firma. Puedes comprobarla de nuevo.',
    fresh: 'Ese intento no se registró. Puedes volver a firmar.',
  },
  en: {
    intro: 'Your answers stay private and are only visible to the event team.',
    usefulness: 'How useful was the event to you?',
    building: 'Are you building a project? Tell us about it if you like.',
    buildingLabel: 'I’m building a project',
    project: 'What are you building?',
    ambassador: 'Are you interested in becoming a Stellar ambassador?',
    ambassadorLabel: 'I’m interested in becoming a Stellar ambassador',
    next: 'What topic would you like for the next event?',
    email: 'Email address (optional)',
    emailNote: 'We’ll only use it to tell you about the next event.',
    send: 'Submit answers', sending: 'Saving your answers…',
    saved: 'We received your answers', anonymous: 'Thank you for filling out the survey.',
    signNote: 'If you sign, your account and the fingerprint of your answer will appear on a public receipt. Your answers and email stay private.',
    sign: 'Sign “I answered the survey”', signing: 'Checking your signature…',
    pending: 'Check again', receipt: 'Open public receipt',
    code: 'Save my private code', downloadProof: 'Download my answers and code',
    proofNote: 'This file contains your answers, including any email you entered. Keep it private.', codeNote: 'Keep this code with your exact answers to verify the fingerprint later. Do not publish it.',
    mismatch: 'The fingerprint we received does not match your answers. You can try sending them again.',
    unavailable: 'We couldn’t confirm the submission. Try again with the same answers.',
    used: 'This code already has a submission. Enter the same answers to try again.',
    cohortChanged: 'The rehearsal ended. Reopen the event survey to enter your answers again.',
    reopen: 'Reopen the survey',
    closed: 'The survey has closed.',
    signClosed: 'Your answers were saved. The receipt signing window has closed.',
    signError: 'We couldn’t confirm the signature. You can check again.',
    fresh: 'That attempt was not registered. You can sign again.',
  },
};

export default function SurveyParticipant({ lang, signer, cohort, deadline }: {
  lang: Lang;
  signer?: Signer;
  cohort: Cohort;
  deadline?: number | null;
}) {
  const actor = signer?.publicKey;
  const [state, setState] = useState<SurveyState | null>(() => readSurveyState(cohort, actor));
  const [canonical, setCanonical] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const t = copies[lang];
  const cohortChanged = problem === 'survey-cohort-changed';

  function update(value: SurveyState) {
    setState(value);
    saveSurveyState(cohort, actor, value);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || state?.saved || cohortChanged) return;
    const data = new FormData(event.currentTarget);
    const usefulness = Number(data.get('usefulness'));
    if (!Number.isInteger(usefulness) || usefulness < 1 || usefulness > 5) return;
    const answer: Answer = {
      usefulness, building: data.has('building'), project: String(data.get('project') ?? '').trim(),
      ambassadorInterest: data.has('ambassador'), nextTopic: String(data.get('nextTopic') ?? '').trim(),
      email: String(data.get('email') ?? '').trim() || null,
    };
    const id = state?.id ?? crypto.randomUUID();
    update({ id });
    setBusy(true);
    setProblem('');
    try {
      const { salt, commitment, canonical } = await submitSurvey(id, actor ?? null, cohort, answer);
      if (actor) setCanonical(canonical);
      update(actor ? { id, saved: true, salt, commitment, draft: makeSurveyReceipt(actor, commitment) } : { id, saved: true });
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : '';
      setProblem(reason === 'survey-mismatch' ? t.mismatch : reason === 'survey-closed' ? t.closed :
        reason === 'survey-id-in-use' ? t.used : reason === 'survey-cohort-changed' ? reason : t.unavailable);
    } finally {
      setBusy(false);
    }
  }

  function downloadProof() {
    if (!canonical || !state?.salt) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({
      salt: state.salt, commitment: state.commitment, canonicalAnswer: canonical,
    }, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vespi-encuesta-privada.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function sign() {
    if (busy || !signer || !state?.draft || state.receipt) return;
    setBusy(true);
    setProblem('');
    let attempt = state.attempt;
    try {
      if (attempt) await verifyPrepared(attempt.bytes, attempt.digest, state.draft);
      else {
        attempt = await prepareRequest(state.draft, signer, deadline);
        update({ ...state, attempt });
      }
      const index = await anchorAttempt(attempt, state.id);
      update({ ...state, attempt: undefined, receipt: index.digest });
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : '';
      if (['invalid-timebound', 'inner-failed', 'retry-with-fresh-transaction', 'survey-closed'].includes(reason)) {
        update({ ...state, attempt: undefined });
        setProblem(reason === 'survey-closed' ? t.signClosed : t.fresh);
      } else setProblem(t.signError);
    } finally {
      setBusy(false);
    }
  }

  return <>
    {state?.saved ? <>
      <p role="status"><strong>{t.saved}</strong></p>
      {!signer && <p>{t.anonymous}</p>}
      {signer && !state.receipt && <>
        <p>{t.signNote}</p>
        <button className="mobile-action" type="button" disabled={busy} onClick={sign}>{state.attempt ? t.pending : t.sign}</button>
      </>}
      {state.receipt && <Link className="mobile-action" href={'/app?receipt=' + state.receipt}>{t.receipt}</Link>}
      {state.salt && <details className="survey-private">
        <summary>{t.code}</summary>
        <p className="mobile-note">{t.codeNote}</p>
        <code>{state.salt}</code>
        {canonical && <>
          <p className="mobile-note">{t.proofNote}</p>
          <button className="mobile-secondary" type="button" onClick={downloadProof}>{t.downloadProof}</button>
        </>}
        <a className="mobile-text-action" download="vespi-encuesta-codigo.txt"
          href={'data:text/plain;charset=utf-8,' + encodeURIComponent(state.salt + '\n' + state.commitment)}>{t.code}</a>
      </details>}
    </> : <>
      <p>{t.intro}</p>
      <form className="mobile-actions survey-form" onSubmit={send}>
        <fieldset>
          <legend>{t.usefulness}</legend>
          <div className="survey-rating">{[1, 2, 3, 4, 5].map(value => (
            <label key={value}><input type="radio" name="usefulness" value={value} required disabled={busy} />{value}</label>
          ))}</div>
        </fieldset>
        <fieldset>
          <legend>{t.building}</legend>
          <label className="mobile-consent"><input type="checkbox" name="building" disabled={busy} />{t.buildingLabel}</label>
          <label htmlFor="survey-project">{t.project}</label>
          <textarea id="survey-project" name="project" maxLength={500} rows={2} disabled={busy} />
        </fieldset>
        <fieldset>
          <legend>{t.ambassador}</legend>
          <label className="mobile-consent"><input type="checkbox" name="ambassador" disabled={busy} />{t.ambassadorLabel}</label>
        </fieldset>
        <label htmlFor="survey-topic">{t.next}</label>
        <textarea id="survey-topic" name="nextTopic" maxLength={500} rows={2} disabled={busy} />
        <label htmlFor="survey-email">{t.email}</label>
        <input id="survey-email" type="email" name="email" inputMode="email" autoComplete="email"
          maxLength={254} aria-describedby="survey-email-purpose" disabled={busy} />
        <p id="survey-email-purpose" className="mobile-note">{t.emailNote}</p>
        <button className="mobile-action" type="submit" disabled={busy || cohortChanged}>{t.send}</button>
      </form>
    </>}
    {busy && <p className="mobile-note" role="status">{state?.saved ? t.signing : t.sending}</p>}
    {problem && <p className="mobile-message" role="alert">{cohortChanged ? t.cohortChanged : problem}</p>}
    {cohortChanged && <button className="mobile-action" type="button" onClick={() => location.reload()}>{t.reopen}</button>}
  </>;
}
