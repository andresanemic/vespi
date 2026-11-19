'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import BeeMark from '@/components/BeeMark';
import ThemeSwitch from '@/components/ThemeSwitch';
import { loadDeviceKey } from '@/lib/contributions/device-key';
import { isEmbeddedBrowser, keypairFromPrf, signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import type { SurveyCohort } from '@/lib/contributions/team-survey-authorization';
import type { SurveyRecord } from '@/lib/contributions/survey-intake';
import type { Lang } from '@/lib/i18n';
import { getDisplayName } from '../client';
import { downloadSurvey, querySurvey, TeamAccessDenied } from './survey-client';

const copy = {
  es: {
    title: 'Respuestas de la encuesta', private: 'Equipo · Acceso privado', cohort: 'Grupo de respuestas',
    rehearsal: 'Ensayo', event: 'Evento', enter: 'Entrar con passkey', device: 'Entrar con clave de este dispositivo',
    opening: 'Abriendo la vista del equipo…', loading: 'Consultando respuestas…', exporting: 'Preparando el CSV…',
    blocked: 'Esta cuenta no tiene acceso a la encuesta del equipo.',
    unavailable: 'No pudimos completar la consulta. Vuelve a intentar.',
    auth: 'No pudimos abrir tu cuenta. Usa la passkey o la clave que ya tienes en este dispositivo.',
    embedded: 'Abre esta página en Safari o Chrome para entrar con tu cuenta.',
    refresh: 'Consultar respuestas', download: 'Descargar CSV', exit: 'Cerrar acceso', back: 'Ir a Contributions',
    empty: 'Todavía no hay respuestas para este grupo.', count: (n: number) => n === 1 ? '1 respuesta' : n + ' respuestas',
    identity: 'Cuenta', usefulness: 'Utilidad', building: 'Está construyendo un proyecto', project: 'Proyecto',
    ambassador: 'Interés en ser embajador', topic: 'Próximo tema', email: 'Correo', yes: 'Sí', no: 'No',
  },
  en: {
    title: 'Survey responses', private: 'Team · Private access', cohort: 'Response group',
    rehearsal: 'Rehearsal', event: 'Event', enter: 'Sign in with a passkey', device: 'Sign in with this device key',
    opening: 'Opening the team view…', loading: 'Loading responses…', exporting: 'Preparing the CSV…',
    blocked: 'This account does not have access to the team survey.',
    unavailable: 'We could not complete the request. Try again.',
    auth: 'We could not open your account. Use your existing passkey or device key.',
    embedded: 'Open this page in Safari or Chrome to sign in with your account.',
    refresh: 'Load responses', download: 'Download CSV', exit: 'Close access', back: 'Go to Contributions',
    empty: 'There are no responses for this group yet.', count: (n: number) => n === 1 ? '1 response' : n + ' responses',
    identity: 'Account', usefulness: 'Usefulness', building: 'Building a project', project: 'Project',
    ambassador: 'Ambassador interest', topic: 'Next topic', email: 'Email', yes: 'Yes', no: 'No',
  },
};

type Work = 'opening' | 'loading' | 'exporting';
type Problem = 'auth' | 'blocked' | 'unavailable' | 'embedded';
type TeamRecord = Pick<SurveyRecord, 'createdAt' | 'answer'>;

export default function TeamSurvey() {
  const [lang, setLang] = useState<Lang>('es');
  const [cohort, setCohort] = useState<SurveyCohort>('rehearsal');
  const [records, setRecords] = useState<TeamRecord[]>();
  const [identity, setIdentity] = useState<string>();
  const [work, setWork] = useState<Work>();
  const [problem, setProblem] = useState<Problem>();
  const key = useRef<Signer | null>(null);
  const operation = useRef<AbortController | null>(null);
  const t = copy[lang];

  const closeAccess = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    key.current = null;
    setRecords(undefined);
    setIdentity(undefined);
    setProblem(undefined);
    setWork(undefined);
    setCohort('rehearsal');
  }, []);

  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (event.persisted) closeAccess();
    }
    window.addEventListener('pagehide', closeAccess);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', closeAccess);
      window.removeEventListener('pageshow', restore);
      operation.current?.abort();
      key.current = null;
    };
  }, [closeAccess]);

  async function run(mode: Work, unlock?: 'passkey' | 'device') {
    if (operation.current) return;
    if (isEmbeddedBrowser(navigator.userAgent)) {
      setProblem('embedded');
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    setProblem(undefined);
    setWork(mode);
    let signer = key.current;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (unlock === 'passkey') {
        const rpId = location.hostname;
        const prf = await unlockPasskey({ rpId });
        if (prf) signer = signerFromKeypair(await keypairFromPrf(prf, rpId));
      }
      if (unlock === 'device') signer = await loadDeviceKey();
      if (signal.aborted) return;
      if (!signer) {
        setProblem('auth');
        return;
      }

      deadline = setTimeout(() => controller.abort(), 15_000);
      const response = await querySurvey(signer, mode === 'exporting' ? 'csv' : 'json', cohort, signal);
      if (mode === 'exporting') await downloadSurvey(response, cohort, signal);
      else {
        const data: { cohort: SurveyCohort; records: TeamRecord[] } = await response.json();
        signal.throwIfAborted();
        if (data.cohort !== cohort || !Array.isArray(data.records)) throw new Error('unexpected-survey-response');
        setRecords(data.records);
        key.current = signer;
        if (unlock) {
          const account = signer.publicKey;
          setIdentity(account);
          void getDisplayName(account).then(name => {
            if (key.current === signer && name) setIdentity(name);
          }).catch(() => {});
        }
      }
    } catch (error) {
      if (operation.current !== controller) return;
      if (error instanceof TeamAccessDenied) {
        key.current = null;
        setIdentity(undefined);
        setRecords(undefined);
        setProblem('blocked');
      } else setProblem(signer ? 'unavailable' : 'auth');
    } finally {
      clearTimeout(deadline);
      if (operation.current === controller) {
        operation.current = null;
        setWork(undefined);
      }
    }
  }

  return (
    <main className="mobile-contributions" lang={lang}>
      <header className="mobile-top">
        <Link className="mobile-brand" href="/app" onNavigate={closeAccess}><BeeMark size={30} /> Vespi Contributions</Link>
        <div className="mobile-settings">
          <button type="button" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <ThemeSwitch lang={lang} />
        </div>
      </header>
      <div className="mobile-sheet">
        <div className="mobile-ledger">{t.private}</div>
        <section className="mobile-content" aria-labelledby="team-heading">
          <h1 id="team-heading">{t.title}</h1>
          {identity && <p className="mobile-note">{t.identity}: <bdi>{identity}</bdi></p>}
          <div className="mobile-actions">
            <label htmlFor="team-cohort">{t.cohort}</label>
            <select id="team-cohort" className="team-cohort" value={cohort} disabled={!!work}
              onChange={event => {
                setCohort(event.currentTarget.value as SurveyCohort);
                setRecords(undefined);
                setProblem(undefined);
              }}>
              <option value="rehearsal">{t.rehearsal}</option>
              <option value="event">{t.event}</option>
            </select>
            {identity ? <>
              <button className="mobile-action" type="button" disabled={!!work} onClick={() => run('loading')}>{t.refresh}</button>
              <button className="mobile-secondary" type="button" disabled={!!work || !records} onClick={() => run('exporting')}>{t.download}</button>
              <button className="mobile-text-action" type="button" onClick={closeAccess}>{t.exit}</button>
            </> : <>
              <button className="mobile-action" type="button" disabled={!!work} onClick={() => run('opening', 'passkey')}>{t.enter}</button>
              <button className="mobile-text-action" type="button" disabled={!!work} onClick={() => run('opening', 'device')}>{t.device}</button>
              {work && <button className="mobile-text-action" type="button" onClick={closeAccess}>{t.exit}</button>}
            </>}
          </div>
          {work && <p className="mobile-note" role="status">{t[work]}</p>}
          {problem && <p className="mobile-message" role="alert">{t[problem]}</p>}
          {records && <div className="team-responses">
            <p role="status">{records.length ? t.count(records.length) : t.empty}</p>
            {!!records.length && <ol>
              {records.map(({ createdAt, answer }, index) => (
                <li key={createdAt + '-' + index}>
                  <time dateTime={createdAt}>{new Date(createdAt).toLocaleString(lang)}</time>
                  <dl>
                    <dt>{t.usefulness}</dt><dd>{answer.usefulness}/5</dd>
                    <dt>{t.building}</dt><dd>{answer.building ? t.yes : t.no}</dd>
                    <dt>{t.project}</dt><dd dir="auto">{answer.project || '—'}</dd>
                    <dt>{t.ambassador}</dt><dd>{answer.ambassadorInterest ? t.yes : t.no}</dd>
                    <dt>{t.topic}</dt><dd dir="auto">{answer.nextTopic || '—'}</dd>
                    <dt>{t.email}</dt><dd dir="auto">{answer.email ?? '—'}</dd>
                  </dl>
                </li>
              ))}
            </ol>}
          </div>}
        </section>
        <footer className="mobile-footer"><Link href="/app" onNavigate={closeAccess}>{t.back}</Link></footer>
      </div>
    </main>
  );
}
