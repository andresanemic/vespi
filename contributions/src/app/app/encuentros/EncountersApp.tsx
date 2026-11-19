'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { StrKey } from '@stellar/stellar-sdk/base';
import BeeMark from '@/components/BeeMark';
import ThemeSwitch from '@/components/ThemeSwitch';
import { isEmbeddedBrowser, keypairFromPrf, signerFromKeypair, unlockPasskey } from '@/lib/contributions/keys';
import { loadDeviceKey } from '@/lib/contributions/device-key';
import type { Encounter, EncounterDraft } from '@/lib/contributions/encounters';
import type { Lang } from '@/lib/i18n';
import { getDisplayName, readProfilePage, readReceipt, type DirectoryProfile } from '../client';
import MobileContributions from '../MobileContributions';
import { getMobileSigner, keepMobileSigner, useMobileIdentity } from '../mobile-identity';
import ShareActions from '../ShareActions';
import EncounterSharePreview from './EncounterSharePreview';
import { anchorEncounter, confirmEncounter, listEncounters, openEncounterSession, publishEncounter, readEncounter, respondEncounter } from './encounter-client';
import '../mobile.css';
import './encounters.css';

const copy = {
  es: {
    continueDraft: 'Continuar borrador', editContext: 'Editar contexto', editEntries: 'Editar aportes',
    manualName: 'Invitar por nombre', manualHelp: 'Usa un nombre si todavía no tiene cuenta. Solo comparte este enlace con la persona invitada.',
    role: '¿Qué rol tuviste?', attendee: 'Asistente', speaker: 'Ponente', organizer: 'Organizador',
    correction: 'Cambios solicitados', declined: 'Encuentro no reconocido', suggest: 'Proponer corrección', reject: 'No reconozco este encuentro',
    note: '¿Qué quieres aclarar?', sendDecision: 'Enviar respuesta', revise: 'Preparar nueva versión', restoreList: 'Recuperar mis encuentros',
    anchor: 'Registrar huella en Stellar', anchored: 'Huella registrada en Stellar testnet', anchorFailed: 'Guardamos la firma. La huella aún no se pudo comprobar.',
    anchorPending: 'Huella pendiente de verificación', anchorCheck: 'Comprobando huella en Stellar…',
    home: 'Inicio', records: 'Mis encuentros', how: 'Cómo funciona', context: 'Contexto', contributions: 'Aportes', review: 'Revisar',
    lead: 'Que una buena conversación no se pierda.', intro: 'Registra una reunión, ayuda o charla. Cuenta qué aportó cada persona, invita a confirmarlo y conserva un recibo compartido.',
    start: 'Registrar encuentro', example: 'Probar con el caso Martín', exampleTitle: 'Una reunión · dos direcciones',
    exampleOne: 'Conexión con Pollar', exampleTwo: 'Repositorio Voice Ready', exampleEnd: 'Dos aportes, un encuentro.',
    noRequest: 'No necesitas solicitar un aporte antes de que ocurra.', steps: 'Simple para las personas',
    stepOne: 'Cuenta qué ocurrió', stepOneText: 'Reunión, charla, ayuda o encuentro espontáneo.',
    stepTwo: 'Registra los aportes', stepTwoText: 'En una o ambas direcciones. Añade enlaces si sirven.',
    stepThree: 'Confirmen y compartan', stepThreeText: 'Cada persona revisa. Un recibo muestra quién confirmó qué.',
    recent: 'Registros recientes', empty: 'Todavía no hay encuentros registrados.', all: 'Ver todos',
    next: 'Continuar', back: 'Anterior', send: 'Enviar a revisión', personalSign: 'Firmar registro personal',
    contextTitle: '¿Qué ocurrió?', contributionsTitle: '¿Qué aportó cada persona?', reviewTitle: 'Revisar antes de compartir',
    kind: '¿Qué ocurrió?', date: '¿Cuándo fue?', title: 'Dale un nombre al encuentro', yourName: 'Tu nombre visible',
    counterpart: 'Otra persona', optional: 'opcional', account: 'Cuenta pública G', paste: 'Pega la cuenta G', find: 'Buscar por nombre',
    check: 'Comprobar cuenta', more: 'Cargar más nombres', noNames: 'No hay coincidencias en los nombres cargados.',
    where: '¿Dónde ocurrió? (opcional)', summary: '¿De qué trataron?', pick: 'Elige el perfil de la persona que podrá revisar el encuentro.',
    noOther: 'Puedes dejarlo vacío para registrar la charla como declaración personal.', checkError: 'No encontramos esa cuenta. Comprueba la G y vuelve a intentar.',
    meet: 'Reunión o conversación', help: 'Ayuda espontánea', talk: 'Charla / evento', other: 'Otra colaboración',
    add: 'Añadir otro aporte', remove: 'Quitar', which: '¿Quién hizo este aporte?', what: '¿Qué aportó?',
    url: 'Enlace relacionado (opcional)', related: 'Abrir recurso', entry: 'Aporte',
    contributionHint: 'Si ambas personas aportaron algo, registra un aporte por dirección. Un enlace da contexto.',
    consent: 'Al firmar, compartes los nombres, cuentas y aportes con quien tenga el enlace. La persona invitada puede revisar y decidir. Stellar registra la huella cuando ambos confirman.',
    personalConsent: 'Al firmar, podrás compartir tu declaración por enlace. La constancia de Stellar muestra la huella sin incluir el contenido.',
    ready: 'Encuentro registrado', awaiting: 'Esperando confirmación', confirmed: 'Confirmado por ambos', personal: 'Declaración personal',
    detail: 'Revisar un encuentro', shared: 'Aportes compartidos', version: 'Versión 1',
    yes: 'Confirmó', pending: 'Pendiente', sign: 'Confirmar encuentro', signed: 'Ya confirmaste', whoReviews: 'Le toca revisar a',
    invite: 'Enviar enlace para revisar', inviteText: 'Te comparto este encuentro en Vespi Contributions. Revisa los aportes y confirma si estás de acuerdo.',
    share: 'Compartir constancia', shareText: 'Consulta la constancia verificada de este encuentro en Vespi Contributions.',
    event: 'Charla de Yerko · 19 de noviembre', signIn: 'Entrar para continuar', signing: 'Comprobando la firma…',
    reading: 'Cargando encuentros…', unavailable: 'No pudimos abrir el encuentro.', failed: 'No pudimos confirmar la operación. Revisa el enlace o vuelve a intentar.',
    authMismatch: 'Desbloquea la cuenta que corresponde al encuentro.', browser: 'Abre esta página en Safari o Chrome para desbloquear tu cuenta.',
    useDevice: 'Usar clave de este dispositivo', verify: 'Verificar recibo', confirmProof: 'Verificar confirmación',
    genericPerson: 'Participante', guide: 'Primero las personas. Después la tecnología.',
    confirmConsent: 'Al confirmar, firmas esta versión y autorizas que su huella se registre en Stellar.',
    notReviewer: 'La confirmación pendiente corresponde a la persona invitada.',
  },
  en: {
    continueDraft: 'Continue draft', editContext: 'Edit context', editEntries: 'Edit contributions',
    manualName: 'Invite by name', manualHelp: 'Use a name if they don’t have an account yet. Only share this link with the invited person.',
    role: 'What was your role?', attendee: 'Attendee', speaker: 'Speaker', organizer: 'Organizer',
    correction: 'Changes requested', declined: 'Encounter not recognized', suggest: 'Suggest a correction', reject: 'I don’t recognize this encounter',
    note: 'What would you like to clarify?', sendDecision: 'Send response', revise: 'Prepare a new version', restoreList: 'Recover my encounters',
    anchor: 'Register fingerprint on Stellar', anchored: 'Fingerprint registered on Stellar testnet', anchorFailed: 'The signature is saved. We haven’t verified the fingerprint yet.',
    anchorPending: 'Fingerprint pending verification', anchorCheck: 'Checking the fingerprint on Stellar…',
    home: 'Home', records: 'My encounters', how: 'How it works', context: 'Context', contributions: 'Contributions', review: 'Review',
    lead: 'Don’t let a good conversation disappear.', intro: 'Record a meeting, a helping hand, or a talk. Describe each person’s contribution, invite them to confirm it, and keep a shared receipt.',
    start: 'Record encounter', example: 'Try the Martín example', exampleTitle: 'One meeting · two directions',
    exampleOne: 'Introduction to Pollar', exampleTwo: 'Voice Ready repository', exampleEnd: 'Two contributions, one encounter.',
    noRequest: 'A contribution can happen before anyone asks for it.', steps: 'Simple for people',
    stepOne: 'Say what happened', stepOneText: 'A meeting, talk, helping hand, or unexpected encounter.',
    stepTwo: 'Record the contributions', stepTwoText: 'In one or both directions. Add useful links.',
    stepThree: 'Confirm and share', stepThreeText: 'Each person reviews. A receipt shows who confirmed what.',
    recent: 'Recent encounters', empty: 'There are no recorded encounters yet.', all: 'View all',
    next: 'Continue', back: 'Previous', send: 'Send for review', personalSign: 'Sign personal record',
    contextTitle: 'What happened?', contributionsTitle: 'What did each person contribute?', reviewTitle: 'Review before sharing',
    kind: 'What happened?', date: 'When was it?', title: 'Name the encounter', yourName: 'Your display name',
    counterpart: 'Other person', optional: 'optional', account: 'Public G account', paste: 'Paste their G account', find: 'Find by name',
    check: 'Check account', more: 'Load more names', noNames: 'No matches among the names loaded.',
    where: 'Where was it? (optional)', summary: 'What did you talk about?', pick: 'Choose the profile of the person who can review the encounter.',
    noOther: 'Leave it empty to record the talk as a personal statement.', checkError: 'We couldn’t find that account. Check the G account and try again.',
    meet: 'Meeting or conversation', help: 'Spontaneous help', talk: 'Talk / event', other: 'Other collaboration',
    add: 'Add another contribution', remove: 'Remove', which: 'Who made this contribution?', what: 'What did they contribute?',
    url: 'Related link (optional)', related: 'Open resource', entry: 'Contribution',
    contributionHint: 'If both people contributed, record one contribution in each direction. A link can add context.',
    consent: 'Signing shares the names, accounts and contributions with anyone who has the link. The invited person can review and decide. Stellar records the fingerprint once both confirm.',
    personalConsent: 'After signing, you can share your statement by link. The Stellar receipt shows the fingerprint without the details.',
    ready: 'Encounter recorded', awaiting: 'Awaiting confirmation', confirmed: 'Confirmed by both', personal: 'Personal statement',
    detail: 'Review an encounter', shared: 'Shared contributions', version: 'Version 1',
    yes: 'Confirmed', pending: 'Pending', sign: 'Confirm encounter', signed: 'You have confirmed', whoReviews: 'Next to review:',
    invite: 'Send review link', inviteText: 'I’m sharing this encounter in Vespi Contributions. Review the contributions and confirm if you agree.',
    share: 'Share verification', shareText: 'View the verified fingerprint of this encounter in Vespi Contributions.',
    event: 'Yerko’s talk · November 19', signIn: 'Sign in to continue', signing: 'Checking the signature…',
    reading: 'Loading encounters…', unavailable: 'We could not open the encounter.', failed: 'We could not confirm the operation. Check the link or try again.',
    authMismatch: 'Unlock the account that belongs to this encounter.', browser: 'Open this page in Safari or Chrome to unlock your account.',
    useDevice: 'Use the key on this device', verify: 'Verify receipt', confirmProof: 'Verify confirmation',
    genericPerson: 'Participant', guide: 'People first. Then technology.',
    confirmConsent: 'By confirming, you sign this version and authorize recording its fingerprint on Stellar.',
    notReviewer: 'The invited person is the one who can confirm next.',
  },
};

type View = 'home' | 'records' | 'how' | 'wizard' | 'detail';
type Editable = Omit<EncounterDraft, 'a' | 'b'>;
type Party = EncounterDraft['a'];
type Item = EncounterDraft['contributions'][number];
type LocalDraft = { draft: Editable; party: Party | null; step: number };
const draftStorage = (account?: string) => 'vespi-encounter:draft:v1:' + (account ?? 'local');

function readDraft(account?: string): LocalDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftStorage(account)) ?? 'null') as LocalDraft | null;
    if (value?.draft && Array.isArray(value.draft.contributions) && value.step >= 0 && value.step <= 2) return value;
  } catch {}
  return null;
}

const blankItem = (from: Item['from'] = 'a'): Item => ({ from, text: '', url: '' });
const blank = (): Editable => ({
  type: 'reunion', title: '', date: new Date().toISOString().slice(0, 10),
  where: '', summary: '', contributions: [blankItem()],
});
function safeUrl(value: string) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; }
  catch { return null; }
}

export default function EncountersApp({ encounterId, initialView = 'home' }: {
  encounterId?: string;
  initialView?: 'home' | 'records' | 'how';
}) {
  const identity = useMobileIdentity();
  const [lang, setLang] = useState<Lang>('es');
  const [view, setView] = useState<View>(encounterId ? 'detail' : initialView);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Editable>(blank);
  const [party, setParty] = useState<Party | null>(null);
  const [input, setInput] = useState('');
  const [manual, setManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [decision, setDecision] = useState<'correction' | 'declined'>();
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [peopleCursor, setPeopleCursor] = useState<string>();
  const [record, setRecord] = useState<Encounter>();
  const [verifiedAnchor, setVerifiedAnchor] = useState<{ id: string; tx: string }>();
  const [records, setRecords] = useState<Encounter[]>([]);
  const [cursor, setCursor] = useState('0');
  const [listError, setListError] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState(false);
  const [auth, setAuth] = useState(false);
  const [error, setError] = useState<'unavailable' | 'failed' | 'checkError' | 'authMismatch' | 'browser' | 'anchorFailed'>();
  const heading = useRef<HTMLHeadingElement>(null);
  const t = copy[lang];
  const account = identity?.account;

  useEffect(() => { heading.current?.focus(); }, [step, view]);

  useEffect(() => {
    if (view !== 'wizard') return;
    try {
      localStorage.setItem(draftStorage(account), JSON.stringify({ draft, party, step }));
      if (account) localStorage.removeItem(draftStorage());
    } catch {}
  }, [view, account, draft, party, step]);

  useEffect(() => {
    if (view === 'wizard') return;
    const timer = setTimeout(() => setHasDraft(Boolean(readDraft(account))), 0);
    return () => clearTimeout(timer);
  }, [view, account]);

  useEffect(() => {
    if (!encounterId) return;
    let active = true;
    readEncounter(encounterId).then(value => { if (active) setRecord(value); })
      .catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, [encounterId]);

  useEffect(() => {
    if (!account) return;
    let active = true;
    listEncounters(account).then(page => {
      if (active) { setRecords(page.entries); setCursor(page.cursor); setListError(false); }
    }).catch(() => { if (active) setListError(true); });
    return () => { active = false; };
  }, [account]);

  useEffect(() => {
    if (!record?.anchor || !record.anchorCommitment) return;
    const controller = new AbortController();
    readReceipt(record.anchor, controller.signal).then(receipt => {
      const signer = record.status === 'personal' ? record.a.account : record.respondedBy?.account || record.b?.account;
      if (receipt.receipt.comment !== 'vespi:encuentro:' + record.anchorCommitment || receipt.receipt.actor !== signer) throw new Error('anchor-mismatch');
      if (!controller.signal.aborted) setVerifiedAnchor({ id: record.id, tx: receipt.index.txHash });
    }).catch(() => { if (!controller.signal.aborted) setError('anchorFailed'); });
    return () => controller.abort();
  }, [record]);

  function navigate(next: View) {
    setError(undefined);
    setView(next);
    if (next === 'home' || next === 'records' || next === 'how') {
      history.replaceState(null, '', next === 'home' ? '/app' : '/app?vista=' + (next === 'records' ? 'encuentros' : 'como'));
    }
  }

  function begin(example = false) {
    const saved = !example && readDraft(account);
    if (saved) {
      setDraft(saved.draft);
      setParty(saved.party);
      setInput(saved.party?.account ?? '');
      setManual(!!saved.party && !saved.party.account);
      setManualName(saved.party?.account ? '' : saved.party?.displayName ?? '');
      setStep(saved.step);
      navigate('wizard');
      return;
    }
    setDraft(example ? { ...blank(), title: 'Conversación entre Vespi y ChatterPay', where: 'Reunión virtual',
      summary: 'Compartimos recursos y contactos que pueden ayudar a nuestros proyectos.',
      contributions: [{ from: 'a', text: 'Compartí el contacto de Pollar para facilitar una conversación.', url: '' },
        { from: 'b', text: 'Me compartió el repositorio de Voice Ready.', url: '' }] } : blank());
    setParty(null);
    setManual(false);
    setManualName('');
    setInput('');
    setStep(0);
    navigate('wizard');
  }

  async function browse(next = '0') {
    setBusy(true);
    setError(undefined);
    try {
      const page = await readProfilePage(next);
      setPeopleCursor(page.cursor);
      setProfiles(old => [...new Map([...old, ...page.entries].map(p => [p.account, p])).values()]);
    } catch { setError('checkError'); }
    finally { setBusy(false); }
  }

  async function check() {
    const key = input.trim().toUpperCase();
    if (!StrKey.isValidEd25519PublicKey(key) || key === account) { setError('checkError'); return; }
    setBusy(true);
    setError(undefined);
    try {
      const name = await getDisplayName(key);
      if (name) setParty({ account: key, displayName: name });
      else setError('checkError');
    } catch { setError('checkError'); }
    finally { setBusy(false); }
  }

  function updateItem(index: number, patch: Partial<Item>) {
    setDraft(value => ({ ...value, contributions: value.contributions.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  }

  function show(value: Encounter) {
    setRecord(value);
    setDecision(undefined);
    setNote('');
    setView('detail');
    setRecords(old => [value, ...old.filter(item => item.id !== value.id)]);
    history.replaceState(null, '', '/app?encuentro=' + value.id);
  }

  function beginAuth() {
    if (isEmbeddedBrowser(navigator.userAgent)) {
      setError('browser');
      return;
    }
    setError(undefined);
    setAuth(true);
  }

  async function signerFor(expected: string, local = device) {
    if (isEmbeddedBrowser(navigator.userAgent)) { setError('browser'); return; }
    const cached = getMobileSigner(expected);
    if (cached) return cached.signer;
    const rpId = location.hostname;
    const prf = local ? null : await unlockPasskey({ rpId });
    const signer = local ? await loadDeviceKey() : prf ? signerFromKeypair(await keypairFromPrf(prf, rpId)) : null;
    if (!signer || signer.publicKey !== expected) { setError('authMismatch'); return; }
    keepMobileSigner(signer, local);
    return signer;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === 0 && !identity) { beginAuth(); return; }
    if (step < 2) { setStep(step + 1); setError(undefined); return; }
    if (!identity) return;
    setBusy(true);
    setError(undefined);
    try {
      const signer = await signerFor(identity.account);
      if (!signer) return;
      const published = await publishEncounter({ ...draft, title: draft.title.trim(), where: draft.where.trim(), summary: draft.summary.trim(),
        a: identity, b: party, contributions: draft.contributions.map(item => ({
          from: item.from, text: item.text.trim(), url: item.url.trim() ? safeUrl(item.url.trim()) ?? '' : '',
        })) }, signer);
      try { localStorage.removeItem(draftStorage(identity.account)); } catch {}
      setHasDraft(false);
      show(published);
      if (published.status === 'personal') {
        try { show(await anchorEncounter(published, signer)); } catch { setError('anchorFailed'); }
      }
    } catch { setError('failed'); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!record?.b || record.status !== 'pending' || busy) return;
    if (!identity) { beginAuth(); return; }
    if (identity.account === record.a.account || (record.b.account && identity.account !== record.b.account)) {
      setError('authMismatch');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const signer = await signerFor(identity.account);
      if (!signer) return;
      if (decision) { show(await respondEncounter(record, signer, decision, note)); return; }
      const accepted = await confirmEncounter(record, signer);
      show(accepted);
      try { show(await anchorEncounter(accepted, signer)); } catch { setError('anchorFailed'); }
    } catch { setError('failed'); }
    finally { setBusy(false); }
  }

  async function retryAnchor() {
    if (!record || !identity || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const signer = await signerFor(identity.account);
      if (signer) show(await anchorEncounter(record, signer));
    } catch { setError('anchorFailed'); }
    finally { setBusy(false); }
  }

  async function recoverList() {
    if (!identity || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const signer = await signerFor(identity.account);
      if (!signer) return;
      await openEncounterSession(signer);
      const page = await listEncounters(identity.account);
      setRecords(page.entries);
      setCursor(page.cursor);
      setListError(false);
    } catch { setError('failed'); }
    finally { setBusy(false); }
  }

  function revise() {
    if (!record || identity?.account !== record.a.account) return;
    setDraft({ type: record.type, title: record.title, date: record.date, where: record.where,
      summary: record.summary, contributions: record.contributions, role: record.role, revisionOf: record.id });
    const other = record.respondedBy ?? record.b;
    setParty(other);
    setInput(other?.account ?? '');
    setManual(!!other && !other.account);
    setManualName(other?.account ? '' : other?.displayName ?? '');
    setStep(0);
    navigate('wizard');
  }

  async function moreRecords() {
    if (!account || cursor === '0') return;
    try {
      const page = await listEncounters(account, cursor);
      setRecords(old => [...new Map([...old, ...page.entries].map(item => [item.id, item])).values()]);
      setCursor(page.cursor);
    } catch { setListError(true); }
  }

  const status = (encounter: Encounter) => ({
    pending: t.awaiting, confirmed: t.confirmed, personal: t.personal, correction: t.correction, declined: t.declined,
  })[encounter.status];
  const labels = { reunion: t.meet, ayuda: t.help, charla: t.talk, otro: t.other };
  const stepTitles = [t.contextTitle, t.contributionsTitle, t.reviewTitle];
  const contextValid = !!draft.title.trim() && !!draft.date && party?.account !== account && (draft.type === 'charla' || !!party);
  const entriesValid = draft.contributions.length > 0 && draft.contributions.every(item =>
    item.text.trim() && (item.from === 'a' || party) && (!item.url.trim() || safeUrl(item.url.trim())));
  const visibleProfiles = profiles.filter(p => p.account !== account && (p.displayName + ' ' + p.account)
    .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  function entries(items: Item[], a: string, b?: string) {
    return <div className="enc-directions">{items.map((item, index) => {
      const who = item.from === 'a' ? a : b;
      const to = item.from === 'a' ? b : a;
      const url = safeUrl(item.url);
      return <article className="enc-entry" key={index}>
        <h3>{who}{to && <> <span aria-hidden>→</span> {to}</>}</h3>
        <p>{item.text}</p>
        {url && <a href={url} target="_blank" rel="noopener noreferrer">{t.related} ↗</a>}
      </article>;
    })}</div>;
  }

  function cards(items: Encounter[]) {
    if (!items.length) return <div className="enc-panel"><p>{listError ? t.unavailable : t.empty}</p></div>;
    return <div className="enc-record-grid">{items.map(item => <Link className="enc-panel enc-card"
      key={item.id} href={'/app?encuentro=' + item.id}>
      <span className="enc-status">{status(item)}</span><h3>{item.title}</h3>
      <p>{item.date} · {item.a.displayName}{item.b && ' y ' + item.b.displayName}</p>
    </Link>)}</div>;
  }

  if (auth && !identity) return <MobileContributions />;
  const detailUrl = record && typeof window !== 'undefined' ? location.origin + '/app?encuentro=' + record.id : '';
  const reviewAllowed = record?.b && record.status === 'pending' && (!identity ||
    (identity.account !== record.a.account && (!record.b.account || identity.account === record.b.account)));
  const canAnchor = record && identity && !record.anchor &&
    (record.status === 'personal' ? record.a.account === identity.account :
      record.status === 'confirmed' && (record.respondedBy?.account || record.b?.account) === identity.account);

  return <main className="enc-shell" lang={lang}>
    <aside className="enc-sidebar">
      <Link href="/app" className="mobile-brand"><BeeMark size={30} /> Vespi Contributions</Link>
      <nav aria-label={lang === 'es' ? 'Vespi' : 'Vespi menu'} className="enc-nav">
        {([{ route: 'home', label: t.home }, { route: 'records', label: t.records }, { route: 'how', label: t.how }] as const)
          .map(({ route, label }) => <button type="button" key={route}
            aria-current={view === route || (route === 'records' && view === 'detail') ? 'page' : undefined}
            onClick={() => navigate(route)}>{label}</button>)}
      </nav>
      <Link className="enc-event" href="/app/evento/yerko">{t.event}</Link>
    </aside>
    <div className="enc-main">
      <header className="enc-top">
        <span>Stellar testnet</span>
        <div className="mobile-settings">
          <button type="button" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <ThemeSwitch lang={lang} />
        </div>
      </header>
      <div className="enc-content">
        {view === 'home' && <>
          <section className="enc-hero">
            <div className="enc-stack">
              <h1 ref={heading} tabIndex={-1}>{t.lead}</h1>
              <p>{t.intro}</p>
              <div className="enc-actions">
                <button type="button" className="mobile-action" onClick={() => begin()}>{hasDraft ? t.continueDraft : t.start}</button>
                {!hasDraft && <button type="button" className="mobile-secondary" onClick={() => begin(true)}>{t.example}</button>}
              </div>
              <p className="mobile-note">{t.noRequest}</p>
            </div>
            <div className="enc-example">
              <p>{t.exampleTitle}</p>
              <div><strong>Andrés → Martín</strong><p>{t.exampleOne}</p></div>
              <div><strong>Martín → Andrés</strong><p>{t.exampleTwo}</p></div>
              <p>{t.exampleEnd}</p>
            </div>
          </section>
          <h2>{t.steps}</h2>
          <div className="enc-steps">{[[t.stepOne,t.stepOneText],[t.stepTwo,t.stepTwoText],[t.stepThree,t.stepThreeText]]
            .map(([title, intro]) => <article className="enc-panel" key={title}><h3>{title}</h3><p>{intro}</p></article>)}</div>
          <div className="enc-row"><h2>{t.recent}</h2><button className="mobile-text-action" type="button" onClick={() => navigate('records')}>{t.all}</button></div>
          {cards(records.slice(0, 3))}
        </>}
        {view === 'records' && <>
          <div className="enc-row"><h1 ref={heading} tabIndex={-1}>{t.records}</h1>
            <button className="mobile-action" type="button" onClick={() => begin()}>{hasDraft ? t.continueDraft : t.start}</button></div>
          {!identity && <button className="mobile-secondary" type="button" onClick={beginAuth}>{t.signIn}</button>}
          {identity && listError && <button className="mobile-secondary" type="button" disabled={busy} onClick={recoverList}>{t.restoreList}</button>}
          {cards(records)}
          <Link className="mobile-profile-link" href="/app?vista=aportes">
            {lang === 'es' ? 'Ver aportes anteriores' : 'View earlier contributions'}
          </Link>
          {cursor !== '0' && <button className="mobile-secondary" type="button" onClick={moreRecords}>{t.all}</button>}
        </>}
        {view === 'how' && <section className="enc-panel enc-stack">
          <h1 ref={heading} tabIndex={-1}>{t.guide}</h1>
          <p>{t.noRequest}</p><p>{t.intro}</p>
          <button className="mobile-action" type="button" onClick={() => begin()}>{hasDraft ? t.continueDraft : t.start}</button>
        </section>}
        {view === 'wizard' && <>
          <h1 ref={heading} tabIndex={-1}>{stepTitles[step]}</h1>
          <ol className="enc-progress" aria-label={t.start}>{[t.context, t.contributions, t.review].map((label, i) =>
            <li key={label} aria-current={i === step ? 'step' : undefined}>{i + 1}. {label}</li>)}</ol>
          <form className="enc-stack" onSubmit={send}>
            {step === 0 && <div className="enc-panel enc-form">
              <label>{t.kind}<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value as Editable['type'], role: e.target.value === 'charla' ? 'asistente' : undefined })}>
                {Object.entries(labels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
              </select></label>
              <label>{t.date}<input type="date" value={draft.date} required onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
              <label className="enc-wide">{t.title}<input required maxLength={140} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
              <div className="enc-wide"><strong>{t.yourName}</strong><p>{identity?.displayName ?? t.genericPerson}</p>
                {!identity && <button className="mobile-secondary" type="button" onClick={beginAuth}>{t.signIn}</button>}
              </div>
              <div className="enc-wide enc-stack">
                <strong>{t.counterpart}{draft.type === 'charla' && ' (' + t.optional + ')'}</strong>
                <p className="mobile-note">{draft.type === 'charla' ? t.noOther : t.pick}</p>
                {party && <p role="status"><strong>{party.displayName}</strong> · {party.account.slice(0,6)}…{party.account.slice(-6)}</p>}
                <div className="enc-actions">
                  <label className="enc-grow">{t.account}<input placeholder={t.paste} maxLength={56} value={input}
                    disabled={busy} onChange={e => { setInput(e.target.value); setParty(null); }} /></label>
                  <button type="button" className="mobile-secondary" disabled={busy || !input.trim()} onClick={check}>{t.check}</button>
                </div>
                <button className="mobile-text-action" type="button" disabled={busy} onClick={() => {
                  setManual(!manual); setManualName(''); setParty(null); setInput('');
                }}>{t.manualName}</button>
                {manual && <label>{t.manualName}<input maxLength={80} value={manualName} onChange={e => {
                  setManualName(e.target.value);
                  setParty(e.target.value.trim() ? { account: '', displayName: e.target.value.trim() } : null);
                }} /><span className="mobile-note">{t.manualHelp}</span></label>}
                {peopleCursor === undefined ? <button className="mobile-text-action" type="button" disabled={busy} onClick={() => browse()}>{t.find}</button> : <>
                  <label>{t.find}<input value={query} onChange={e => setQuery(e.target.value)} /></label>
                  {visibleProfiles.map(p => <button type="button" className="mobile-secondary" key={p.account}
                    onClick={() => { setManual(false); setManualName(''); setParty(p); setInput(p.account); }}>{p.displayName} · {p.account.slice(0,6)}…{p.account.slice(-6)}</button>)}
                  {visibleProfiles.length === 0 && <p className="mobile-note">{t.noNames}</p>}
                  {peopleCursor !== '0' && <button type="button" className="mobile-text-action" disabled={busy} onClick={() => browse(peopleCursor)}>{t.more}</button>}
                </>}
              </div>
              {draft.type === 'charla' && <label className="enc-wide">{t.role}
                <select value={draft.role ?? 'asistente'} onChange={e => setDraft({ ...draft, role: e.target.value as Editable['role'] })}>
                  <option value="asistente">{t.attendee}</option><option value="ponente">{t.speaker}</option>
                  <option value="organizador">{t.organizer}</option>
                </select></label>}
              <label className="enc-wide">{t.where}<input value={draft.where} maxLength={160} onChange={e => setDraft({ ...draft, where: e.target.value })} /></label>
              <label className="enc-wide">{t.summary}<textarea rows={3} maxLength={1000} value={draft.summary}
                onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
            </div>}
            {step === 1 && <>
              <p>{t.contributionHint}</p>
              {draft.contributions.map((item,index) => <div className="enc-panel enc-stack" key={index}>
                <div className="enc-row"><h2>{t.entry} {index + 1}</h2>
                  <button className="mobile-text-action" type="button" disabled={draft.contributions.length === 1}
                    onClick={() => setDraft({ ...draft, contributions: draft.contributions.filter((_,i) => i !== index) })}>{t.remove}</button></div>
                <label>{t.which}<select value={item.from} onChange={e => updateItem(index, { from: e.target.value as Item['from'] })}>
                  <option value="a">{identity?.displayName ?? t.genericPerson}</option>
                  {party && <option value="b">{party.displayName}</option>}
                </select></label>
                <label>{t.what}<textarea required value={item.text} rows={3} maxLength={1000} onChange={e => updateItem(index, { text: e.target.value })} /></label>
                <label>{t.url}<input type="url" value={item.url} maxLength={500} onChange={e => updateItem(index, { url: e.target.value })} /></label>
              </div>)}
              <button className="mobile-secondary" type="button" disabled={draft.contributions.length >= 12}
                onClick={() => setDraft({ ...draft, contributions: [...draft.contributions, blankItem(party && draft.contributions.length === 1 ? 'b' : 'a')] })}>{t.add}</button>
            </>}
            {step === 2 && <div className="enc-panel enc-stack">
              <h2>{draft.title}</h2><p>{draft.date}{draft.where && ' · ' + draft.where}</p>
              {draft.summary && <p>{draft.summary}</p>}
              {entries(draft.contributions, identity?.displayName ?? t.genericPerson, party?.displayName)}
              <p className="mobile-note">{party ? t.consent : t.personalConsent}</p>
              <div className="enc-actions">
                <button type="button" className="mobile-secondary" disabled={busy} onClick={() => setStep(0)}>{t.editContext}</button>
                <button type="button" className="mobile-secondary" disabled={busy} onClick={() => setStep(1)}>{t.editEntries}</button>
              </div>
            </div>}
            <div className="enc-actions">
              <button className="mobile-secondary" type="button" disabled={busy || step === 0} onClick={() => setStep(step - 1)}>{t.back}</button>
              <button className="mobile-action" disabled={busy || (step === 0 ? !!identity && !contextValid : !entriesValid)}>
                {busy ? t.signing : step < 2 ? t.next : party ? t.send : t.personalSign}
              </button>
            </div>
          </form>
        </>}
        {view === 'detail' && <section className="enc-stack">
          <h1 ref={heading} tabIndex={-1}>{record ? record.title : t.detail}</h1>
          {!record ? !error && <p role="status">{t.reading}</p> : <>
            <div className="enc-panel enc-stack">
              <p role="status"><strong>{status(record)}</strong></p>
              <p>{record.date}{record.where && ' · ' + record.where}</p>
              {record.summary && <p>{record.summary}</p>}
              <h2>{t.shared}</h2>{entries(record.contributions, record.a.displayName, record.b?.displayName)}
            </div>
            <section className="enc-panel enc-stack">
              <h2>{t.review}</h2>
              <div className="enc-row"><strong>{record.a.displayName}</strong><span className="enc-status">{t.yes}</span></div>
              {record.b && <div className="enc-row"><strong>{record.respondedBy?.displayName ?? record.b.displayName}</strong>
                <span className="enc-status">{record.status === 'confirmed' ? t.yes : status(record)}</span></div>}
              {record.respondedBy && record.b && record.respondedBy.displayName !== record.b.displayName &&
                <p className="mobile-note">{record.b.displayName} → {record.respondedBy.displayName}</p>}
              {record.note && <blockquote>{record.note}</blockquote>}
              {record.b && record.status === 'pending' && <p>{t.whoReviews} <strong>{record.b.displayName}</strong>.</p>}
              {reviewAllowed && <>
                {identity && !decision && <p className="mobile-note">{t.confirmConsent}</p>}
                {identity && decision && <label>{t.note}<textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>}
                <button className="mobile-action" type="button" disabled={busy || (decision === 'correction' && !note.trim())} onClick={confirm}>
                  {busy ? t.signing : identity ? decision ? t.sendDecision : t.sign : t.signIn}
                </button>
              </>}
              {reviewAllowed && identity && <div className="enc-actions">
                <button className="mobile-secondary" type="button" aria-pressed={decision === 'correction'} onClick={() => setDecision(decision === 'correction' ? undefined : 'correction')}>{t.suggest}</button>
                <button className="mobile-secondary" type="button" aria-pressed={decision === 'declined'} onClick={() => setDecision(decision === 'declined' ? undefined : 'declined')}>{t.reject}</button>
              </div>}
              {record.status === 'correction' && identity?.account === record.a.account &&
                <button className="mobile-action" type="button" onClick={revise}>{t.revise}</button>}
              {identity && record.b && record.status === 'pending' && !reviewAllowed && identity.account !== record.a.account && <p>{t.notReviewer}</p>}
              {(record.status === 'confirmed' || record.status === 'personal') &&
                <p role="status">{verifiedAnchor?.id === record.id ? t.anchored : record.anchor && !error ? t.anchorCheck : t.anchorPending}</p>}
              {record.anchor && verifiedAnchor?.id === record.id &&
                <Link className="mobile-secondary" href={'https://stellar.expert/explorer/testnet/tx/' + verifiedAnchor.tx}>{t.verify}</Link>}
              {canAnchor && <button className="mobile-secondary" type="button" disabled={busy} onClick={retryAnchor}>{t.anchor}</button>}
            </section>
            {detailUrl && record.status === 'pending' && identity?.account === record.a.account &&
              <EncounterSharePreview lang={lang} url={detailUrl} label={t.invite} message={t.inviteText} />}
            {record.receiptToken && verifiedAnchor?.id === record.id && <ShareActions lang={lang}
              url={location.origin + '/app/constancia/' + record.receiptToken} label={t.share} message={t.shareText} />}
          </>}
        </section>}
        {error && <p role="alert" className="mobile-message">{t[error]}</p>}
        {(error === 'failed' || error === 'authMismatch' || error === 'anchorFailed') && <label className="enc-device">
          <input type="checkbox" checked={device} onChange={e => setDevice(e.target.checked)} /> {t.useDevice}
        </label>}
        {error === 'browser' && <input className="enc-full-url" aria-label="URL" value={location.href} readOnly onFocus={e => e.target.select()} />}
      </div>
    </div>
  </main>;
}
