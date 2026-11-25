'use client';

import Link from 'next/link';
import { StrKey, type Keypair } from '@stellar/stellar-sdk/base';
import MobileDashboard from './MobileDashboard';
import { clearMobileIdentity, getMobileSigner, hasPendingSubmission, keepMobileSigner, mobileIdentityChanged, mobilePageRestored, readMobileIdentity, rememberMobileIdentity, requireMobileSigner, restoreMobileSession, unlockedNow, unlockIsRecent, useMobileIdentity } from './mobile-identity';
import { legacyReceivedDraft, readComposerDraft, saveComposerDraft } from './composer-draft';
import { MobileNetworkControl, SigningButton } from './MobileFlowControls';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import AppBrand from './AppBrand';
import AppFooter from './AppFooter';
import ThemeSwitch from '@/components/ThemeSwitch';
import type { Lang } from '@/lib/i18n';
import { createDeviceKey, loadDeviceKey } from '@/lib/contributions/device-key';
import { createPasskey, isEmbeddedBrowser, keypairFromPrf, resolvePasskeyPrf,
  signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import { contributionNetwork, DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import { isEncounterFingerprint } from '@/lib/contributions/encounters';
import { focusEvent, focusPhase, focusRegistration, focusRoot, isFocusRegistration } from '@/lib/contributions/focus-event';
import { watchLumaChange } from '@/lib/luma-event';
import { anchorAttempt, canUseMainnet, clearAttempt, contributionLink, FlowError, getDisplayName, loadAttempt, makeRequest, onboard, prepareRequest, publishDisplayName, readObservationTarget, readReceipt, storeAttempt, validDisplayName, withContributionNetwork, type Attempt, type PublicReceipt, type ReturnContext } from './client';
import MainnetNotice, { mainnetBlocked, MainnetFailure, testnetAccountMissing } from './MainnetNotice';
import VoiceDraftControl from './VoiceDraftControl';
import { mergeVoiceText } from './voice-recorder';

import ChainAction, { loadChain } from './ChainAction';
import MutualSupport, { confirmedDelivery } from './MutualSupport';
import ShareActions from './ShareActions';
import { rememberMutual } from './saved-invitations';
import ObservationAction from './ObservationAction';
import { yerkoTitle } from './evento/yerko/event';
import SurveyParticipant from './encuesta/SurveyParticipant';

const copy = {
  es: {
    authorizeAccount: 'Autorizar cuenta para entregar', sendRequest: 'Compartir solicitud',
    noAccountYet: 'Si aún no tiene cuenta, comparte la solicitud para que pueda crearla.',
    requestMessage: 'Te pido un aporte en Vespi Contributions. Si aún no tienes cuenta, créala desde este enlace y compárteme tu cuenta por aquí.',
    incompleteLink: 'Reabre el enlace original', incompleteInfo: 'Abre el enlace completo que te enviaron para continuar.', homeLink: 'Volver a Inicio',
    prepareTalk: 'Preparar registro de la charla', prepareTalkIntro: 'Entra para preparar el registro de la charla y revisar el texto antes de firmar.',
    inviteWitness: 'Invitar a dar testimonio', witnessMessage: 'Si viste esta charla o aporte, abre el enlace para dar tu testimonio en Vespi Contributions.',
    receivedTitle: '¿Qué aporte recibiste?', dashboard: 'Mis aportes', differentAccount: 'Desbloqueaste otra cuenta. Usa la cuenta con la que vas a firmar el recibo.',
    counterpartCheck: 'Comprobar cuenta', chooseCounterparty: '¿Con quién fue? (opcional)',
    counterpartNotFound: 'No encontramos un perfil para esa cuenta.', counterpartBusy: 'Comprobando la otra cuenta…',
    mutualTitle: 'Apoyo mutuo', returnTitle: 'Registrar el apoyo de vuelta',
    returnIntro: 'Registra el aporte que recibiste de la misma persona. Tú firmas la solicitud y esa persona firma su entrega.',
    returnOnly: 'El apoyo de vuelta lo inicia quien entregó el primer aporte.',
    returnUnavailable: 'No pudimos comprobar el primer aporte. Reabre el enlace e inténtalo de nuevo.',
    both: 'Ver ambos aportes',
    incomingRequestBy: 'te pide un aporte.', incomingDeliveryBy: 'pidió este aporte y le toca revisarlo.', copyOpen: 'Copiar enlace para abrir en el navegador', copyOpenDone: 'Pega el enlace en Safari o Chrome.', copyOpenManual: 'Selecciona el enlace completo y cópialo.',
    inviteTitle: 'Invita a quien entrega', inviteNext: 'Ya firmaste lo que pediste. Ahora invítale a firmar su entrega.',
    recapRequest: 'Lo pedido', recapDelivery: 'La entrega vigente', recapAcceptedDelivery: 'La entrega aceptada',
    recapAcceptance: 'La aceptación', recapVerify: 'Verificar',
    observeTitle: 'Dar testimonio', observeIntro: 'Si viste esta charla o aporte, puedes dejar tu testimonio.',
    observeAction: 'Dar testimonio de esta entrega', observed: 'Testimonio verificado sobre una entrega.',
    observationIndependent: 'La aceptación del aporte se registra por separado.', observedDelivery: 'Ver la entrega observada',
    myProfile: 'Mi perfil', request: 'Pedir un aporte', received: 'Registrar un aporte que recibí',
    receivedPrefix: 'Aporte recibido antes de la solicitud: ',
    pendingAcceptance: 'Aporte entregado. Está pendiente de aceptación.',
    accepted: 'Aporte aceptado por quien lo pidió.', openRequest: 'Solicitud firmada. Falta la entrega.',
    statusUnavailable: 'Estado actual no disponible.', otherVersion: 'Se aceptó otra versión de este aporte.', exactDelivery: 'Ver la versión aceptada',
    manage: 'Compartir o entregar este aporte', decide: 'Revisar este aporte',
    chainTitle: 'Continuar con el aporte', seeLatest: 'Ver el último paso firmado',
    surveyTitle: 'Encuesta del evento', surveyIntro: 'Cuéntanos qué te pareció el evento.', withoutAccount: 'Responder sin cuenta', commitment: 'Huella de la respuesta',
    profileTitle: 'Elige tu nombre visible', profileName: 'Nombre visible', profileConsent: 'Acepto que este nombre se publique junto a mi cuenta de Stellar.',
    profilePermanent: 'Elige un nombre o alias. Una vez publicado, el nombre de esta cuenta no se puede cambiar.',
    profilePublish: 'Publicar nombre y continuar', profileChecking: 'Consultando tu nombre visible…', profilePublishing: 'Publicando tu nombre…',
    profileRetry: 'Volver a consultar', profileError: 'No pudimos consultar tu nombre. Vuelve a intentar.',
    profileWriteError: 'No pudimos confirmar la publicación. Puedes volver a intentarlo.', profileInvalid: 'Usa hasta 40 caracteres visibles.',
    profileSaved: 'El nombre publicado de esta cuenta es',
    intro: 'Pide un aporte y comparte el recibo firmado.',
    enter: 'Entrar con passkey', create: 'Crear una passkey', existingAccount: 'Si ya tienes una cuenta, entra con ella.', name: 'Nombre para tu passkey', createTitle: 'Crea tu passkey',
    nameInfo: 'Este nombre te ayuda a reconocer la passkey en tu teléfono.',
    deviceTitle: 'Clave en este dispositivo', device: 'Tu passkey no permite generar la clave de la cuenta. Si usas una clave en este dispositivo, perderás el acceso a la cuenta si borras los datos del sitio.',
    useDevice: 'Usar clave en este dispositivo', existingDevice: 'Entrar con clave de este dispositivo',
    back: 'Volver', welcome: '¿Qué aporte necesitas?', statement: 'Escribe tu solicitud', receivedStatement: 'Describe lo que recibiste',
    placeholder: 'Escribe aquí…', voiceSuggestion: 'Propuesto por IA', details: 'Más detalles', comment: 'Comentario opcional', review: 'Continuar', reviewTitle: 'Revisa tu solicitud', reviewReceived: 'Revisa tu aporte', sign: 'Firmar',
    leave: '¿Salir de tu cuenta? Se borrarán los borradores de este navegador.', leavePending: 'Hay un envío pendiente. Si sales, perderás la opción de reintentarlo desde este navegador.',
    consent: 'Al firmar aceptas que tu cuenta, la declaración y el comentario queden públicos.', prefix: 'Ensayo: ',
    opening: 'Abriendo tu cuenta…', anchoring: 'Registrando tu firma…', pending: 'La firma todavía está pendiente de confirmación.', retry: 'Comprobar de nuevo',
    done: 'Solicitud registrada', pendingLink: 'Enlace de esta solicitud', receipt: 'Abrir recibo público', checking: 'Comprobando recibo…', verified: 'Firma y recibo verificados',
    transaction: 'Ver transacción en Stellar Expert', account: 'Cuenta', digest: 'Huella del recibo',
    help: 'Abre esta página en Safari o Chrome para usar tu passkey.', authError: 'No pudimos abrir tu cuenta. Puedes volver a intentar.',
    failed: 'No pudimos registrar o comprobar el recibo. Vuelve a intentar.', missing: 'El recibo no está disponible.',
    fresh: 'Este intento terminó sin registrar la solicitud. Puedes volver a firmar o editarla.',
    mismatch: 'El contenido no coincide con la firma esperada.', edit: 'Editar',

  },
  en: {
    authorizeAccount: 'Authorize account to deliver', sendRequest: 'Share request',
    noAccountYet: 'If they need an account, share the request so they can create one.',
    requestMessage: 'I’m asking you for a contribution in Vespi Contributions. If you don’t have an account yet, create one from this link and share your account with me here.',
    incompleteLink: 'Reopen the original link', incompleteInfo: 'Open the full link you received to continue.', homeLink: 'Back to Home',
    prepareTalk: 'Prepare the talk record', prepareTalkIntro: 'Sign in to prepare the talk record and review the text before signing.',
    inviteWitness: 'Invite people to give testimony', witnessMessage: 'If you saw this talk or contribution, open the link to give testimony in Vespi Contributions.',
    receivedTitle: 'What contribution did you receive?', dashboard: 'My contributions', differentAccount: 'You unlocked a different account. Use the account that will sign the receipt.',
    counterpartCheck: 'Check account', chooseCounterparty: 'Who was involved? (optional)',
    counterpartNotFound: 'We could not find a profile for that account.', counterpartBusy: 'Checking the other account…',
    mutualTitle: 'Mutual support', returnTitle: 'Record the return contribution',
    returnIntro: 'Record the contribution you received from the same person. You sign the request and they sign their delivery.',
    returnOnly: 'The person who delivered the first contribution starts the return.',
    returnUnavailable: 'We could not verify the first contribution. Reopen the link and try again.',
    both: 'View both contributions',
    incomingRequestBy: 'is asking you for a contribution.', incomingDeliveryBy: 'requested this contribution and reviews it next.', copyOpen: 'Copy link to open in a browser', copyOpenDone: 'Paste the link in Safari or Chrome.', copyOpenManual: 'Select the full link and copy it.',
    inviteTitle: 'Invite the person delivering', inviteNext: 'You’ve signed the request. Invite them to sign their delivery.',
    recapRequest: 'The request', recapDelivery: 'The current delivery', recapAcceptedDelivery: 'The accepted delivery',
    recapAcceptance: 'The acceptance', recapVerify: 'Verify',
    observeTitle: 'Give testimony', observeIntro: 'If you saw this talk or contribution, you can give testimony.',
    observeAction: 'Give testimony about this delivery', observed: 'Verified testimony about a delivery.',
    observationIndependent: 'Acceptance of the contribution is recorded separately.', observedDelivery: 'View the observed delivery',
    myProfile: 'My profile', request: 'Request a contribution', received: 'Record a contribution I received',
    receivedPrefix: 'Contribution received before the request: ',
    pendingAcceptance: 'Contribution delivered. Awaiting acceptance.',
    accepted: 'Contribution accepted by the requester.', openRequest: 'Request signed. Awaiting delivery.',
    statusUnavailable: 'Current status unavailable.', otherVersion: 'A different version of this contribution was accepted.', exactDelivery: 'View the accepted version',
    manage: 'Share or deliver this contribution', decide: 'Review this contribution',
    chainTitle: 'Continue with the contribution', seeLatest: 'View the latest signed step',
    surveyTitle: 'Event survey', surveyIntro: 'Tell us what you thought of the event.', withoutAccount: 'Answer without an account', commitment: 'Answer fingerprint',
    profileTitle: 'Choose your display name', profileName: 'Display name', profileConsent: 'I agree to publish this name alongside my Stellar account.',
    profilePermanent: 'Choose a name or alias. Once published, the name for this account cannot be changed.',
    profilePublish: 'Publish name and continue', profileChecking: 'Checking your display name…', profilePublishing: 'Publishing your name…',
    profileRetry: 'Check again', profileError: 'We could not check your name. Try again.',
    profileWriteError: 'We could not confirm the publication. You can try again.', profileInvalid: 'Use up to 40 visible characters.',
    profileSaved: 'This account’s published name is',
    intro: 'Ask for a contribution and share the signed receipt.',
    enter: 'Sign in with a passkey', create: 'Create a passkey', existingAccount: 'If you already have an account, sign in with it.', name: 'Name for your passkey', createTitle: 'Create your passkey',
    nameInfo: 'This name helps you recognise the passkey on your phone.',
    deviceTitle: 'Key on this device', device: 'Your passkey cannot generate the account key. If you use a key on this device, clearing site data will remove access to the account.',
    useDevice: 'Use key on this device', existingDevice: 'Sign in with key on this device',
    back: 'Back', welcome: 'What do you need?', statement: 'Write your request', receivedStatement: 'Describe what you received',
    placeholder: 'Write here…', voiceSuggestion: 'Proposed by AI', details: 'More details', comment: 'Optional comment', review: 'Continue', reviewTitle: 'Review your request', reviewReceived: 'Review your contribution', sign: 'Sign',
    leave: 'Sign out of your account? Drafts in this browser will be deleted.', leavePending: 'A submission is pending. If you sign out, you won’t be able to retry it from this browser.',
    consent: 'By signing, you agree to make your account, statement and comment public.', prefix: 'Rehearsal: ',
    opening: 'Opening your account…', anchoring: 'Submitting your signature…', pending: 'Your signature is pending confirmation.', retry: 'Check again',
    done: 'Request registered', pendingLink: 'Link to this request', receipt: 'Open public receipt', checking: 'Checking receipt…', verified: 'Signature and receipt verified',
    transaction: 'View transaction on Stellar Expert', account: 'Account', digest: 'Receipt hash',
    help: 'Open this page in Safari or Chrome to use your passkey.', authError: 'We could not open your account. Try again.',
    failed: 'We could not register or verify the receipt. Try again.', missing: 'This receipt is unavailable.',
    fresh: 'This attempt ended before the request was registered. Sign again or edit it.',
    mismatch: 'The content does not match the expected signature.', edit: 'Edit',
  },
};

type Step = 'home' | 'dashboard' | 'create' | 'device' | 'profile-check' | 'profile' | 'write' | 'chain' | 'return-check' | 'observation' | 'survey' | 'review' | 'done';
type Receipt = Awaited<ReturnType<typeof readReceipt>>;

const subscribeToHydration = () => () => {};
const afterHydration = () => true;
const beforeHydration = () => false;
const readAppLanguage = (): Lang => document.documentElement.lang === 'en' ? 'en' : 'es';
const readFocusPhase = () => focusPhase(Date.now());
const readAssignment = () => new URLSearchParams(location.hash.slice(1)).get('assignment');
const noAssignment = () => null;
function subscribeToFragment(update: () => void) {
  window.addEventListener('hashchange', update);
  window.addEventListener('popstate', update);
  return () => {
    window.removeEventListener('hashchange', update);
    window.removeEventListener('popstate', update);
  };
}

export default function MobileContributions({ digest, target, observe, backRoot, mutual, pair, survey, surveyDeadline, initialStatement, initialLang, yerko, eventAttendance, focusRecord, composeRequest, composeReceived, expectsAssignment, brokenContinuation, initialNetwork = DEFAULT_NETWORK, invalidNetwork }: {
  digest?: string;
  target?: string;
  observe?: string;
  backRoot?: string;
  mutual?: string;
  pair?: { first: string; second: string };
  survey?: 'rehearsal' | 'event';
  surveyDeadline?: number | null;
  initialLang?: Lang;
  yerko?: { root: string; account: string; closed: boolean };
  eventAttendance?: boolean;
  focusRecord?: boolean;
  initialStatement?: string;
  composeRequest?: boolean;
  composeReceived?: boolean;
  expectsAssignment?: boolean;
  brokenContinuation?: boolean;
  initialNetwork?: ContributionNetwork;
  invalidNetwork?: boolean;
}) {
  const hydrated = useSyncExternalStore(subscribeToHydration, afterHydration, beforeHydration);
  const identity = useMobileIdentity();
  const browserLang = useSyncExternalStore(subscribeToHydration, readAppLanguage, () => 'es' as const);
  const [chosenLang, setChosenLang] = useState<Lang>();
  const lang = chosenLang ?? initialLang ?? browserLang;
  const proof = useSyncExternalStore(subscribeToFragment, readAssignment, noAssignment);
  const [step, setStep] = useState<Step>('home');
  const [network, setNetwork] = useState(initialNetwork);
  const [networkAccess, setNetworkAccess] = useState<{ account: string; allowed: boolean | 'unavailable' }>();
  const [networkRetry, setNetworkRetry] = useState(0);
  const [, setSessionReady] = useState(false);
  const [received, setReceived] = useState(false);
  const [name, setName] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileConsent, setProfileConsent] = useState(false);
  const [publishedName, setPublishedName] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [confirmedCounterparty, setConfirmedCounterparty] = useState<{ account: string; name: string }>();
  const [checkingCounterparty, setCheckingCounterparty] = useState(false);
  const [statement, setStatement] = useState('');
  const [comment, setComment] = useState('');
  const [voiceSuggested, setVoiceSuggested] = useState(false);
  const [draftScope, setDraftScope] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof makeRequest>>();
  const [signer, setSigner] = useState<Signer>();
  const [device, setDevice] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<{ key: Signer; local: boolean; pair?: Keypair; at: number }>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [registered, setRegistered] = useState('');
  const [returning, setReturning] = useState<ReturnContext>();
  const [acceptedDelivery, setAcceptedDelivery] = useState<Receipt>();
  const [observedTarget, setObservedTarget] = useState<Awaited<ReturnType<typeof readObservationTarget>>>();
  const [chainRequest, setChainRequest] = useState<Receipt>();
  const [incoming, setIncoming] = useState<Receipt>();
  const [incomingRequester, setIncomingRequester] = useState('');
  const [copyIncoming, setCopyIncoming] = useState<'copied' | 'manual'>();
  const [chainHead, setChainHead] = useState<Receipt>();
  const [publicReceipt, setPublicReceipt] = useState<PublicReceipt>();
  const [readVersion, setReadVersion] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const statementField = useRef<HTMLTextAreaElement>(null);
  const previousStep = useRef(step);
  const t = copy[lang];
  const incompleteLink = invalidNetwork || brokenContinuation || (hydrated && target && !returning &&
    (expectsAssignment || proof !== null) && !/^[a-f0-9]{128}$/.test(proof ?? ''));
  const dashboard = step === 'dashboard' || (step === 'home' && identity && !composeRequest && !digest && !target && !observe && !backRoot && !pair && !survey);
  const account = identity?.account ?? signer?.publicKey;
  const showChain = step === 'chain' || (step === 'home' && !!target && !!identity && !observe && !incompleteLink);
  const mainnet = network === 'mainnet';
  const focusSign = !mainnet && !!observe && observe === focusRoot;
  const focusStatus = useSyncExternalStore(focusSign ? watchLumaChange : subscribeToHydration, readFocusPhase, () => null);
  const focusLink = focusEvent.path + '?lang=' + lang;
  const explorer = contributionNetwork(network).explorer;
  const networkChoiceFlow = !initialStatement && !returning && !target && !digest && !survey && !observe && !incompleteLink;
  const canChooseNetwork = networkChoiceFlow && (step === 'write' || dashboard);
  const checkMainnet = !incompleteLink && (mainnet && !digest && !showChain && !pair || canChooseNetwork || networkChoiceFlow && step === 'review');
  const allowed = networkAccess?.account === account ? networkAccess?.allowed : undefined;
  const mainnetEnabled = !!account && allowed === true;
  const mainnetGate = mainnet && !!account && !showChain && !digest && !pair && !incompleteLink && !mainnetEnabled;
  const draftFlow = returning?.first ?? backRoot ?? (focusRecord ? 'focus-group' : initialStatement ? 'talk' : composeReceived ? 'received' : 'request');

  useEffect(() => {
    function syncIdentity(event: StorageEvent) {
      if (mobileIdentityChanged(event)) location.reload();
    }
    window.addEventListener('storage', syncIdentity);
    window.addEventListener('pageshow', mobilePageRestored);
    return () => {
      window.removeEventListener('storage', syncIdentity);
      window.removeEventListener('pageshow', mobilePageRestored);
    };
  }, []);

  const identityAccount = identity?.account;
  useEffect(() => {
    let current = true;
    void restoreMobileSession().then(() => { if (current) setSessionReady(true); });
    return () => { current = false; };
  }, [identityAccount]);

  useEffect(() => {
    if (!account || readMobileIdentity()?.account !== account || draftScope !== [account, network, draftFlow].join(':') ||
      attempt || (step !== 'write' && step !== 'review')) return;
    if (!statement.trim() && !comment.trim() && !counterparty.trim()) {
      saveComposerDraft(account, network, draftFlow);
      return;
    }
    saveComposerDraft(account, network, draftFlow, {
      statement, comment, counterparty, received, voiceSuggested, review: step === 'review',
    });
  }, [account, draftScope, draftFlow, network, attempt, step, statement, comment, counterparty, received, voiceSuggested]);

  useEffect(() => {
    if (!checkMainnet || !account) return;
    const controller = new AbortController();
    void canUseMainnet(account, controller.signal).then(allowed => {
      if (!controller.signal.aborted) setNetworkAccess({ account, allowed });
    }).catch(() => {
      if (!controller.signal.aborted) setNetworkAccess({ account, allowed: 'unavailable' });
    });
    return () => controller.abort();
  }, [account, checkMainnet, networkRetry]);

  useEffect(() => {
    if (step !== previousStep.current || incompleteLink) heading.current?.focus();
    previousStep.current = step;
  }, [step, incompleteLink]);

  useEffect(() => {
    if (digest === undefined || invalidNetwork) return;
    const controller = new AbortController();
    readReceipt(digest, controller.signal, 'all', network).then(async entry => {
      if (controller.signal.aborted) return;
      if (entry.receipt.kind === 'ATTEST') {
        const { actor, chain, subject, role, prev } = entry.receipt;
        const linked = await readObservationTarget(subject, controller.signal);
        const { delivery, request } = linked;
        if (request.index.digest !== chain || role !== 'observer' || prev !== null ||
          actor === request.receipt.actor || actor === delivery?.receipt.actor) throw new FlowError('receipt-mismatch');
        if (!controller.signal.aborted) {
          setObservedTarget(linked);
          setPublicReceipt(entry);
        }
        return;
      }
      setPublicReceipt(entry);
      if (!mainnet && entry.receipt.kind === 'REQUEST' && isFocusRegistration(entry.receipt.statement, digest)) return;
      if (entry.receipt.kind === 'SURVEY' || (network === 'mainnet' && isEncounterFingerprint(entry.receipt))) return;
      return loadChain(digest, controller.signal, network, { receipt: entry.receipt, index: entry.index }).then(({ request, head, acceptedDelivery }) => {
        if (!controller.signal.aborted) {
          setChainRequest(request);
          setChainHead(head);
          setAcceptedDelivery(acceptedDelivery);
        }
      }).catch(() => {});
    }).catch(error => {
      if (!controller.signal.aborted) setProblem(error instanceof FlowError ? error.message : 'failed');
    });
    return () => controller.abort();
  }, [digest, invalidNetwork, mainnet, network, readVersion]);

  useEffect(() => {
    if (!target || observe || digest || invalidNetwork) return;
    const controller = new AbortController();
    readReceipt(target, controller.signal, undefined, network).then(async entry => {
      const request = entry.receipt.kind === 'REQUEST' ? entry : await readReceipt(entry.receipt.chain, controller.signal, undefined, network);
      if (request.receipt.kind !== 'REQUEST' || controller.signal.aborted) return;
      setIncoming(entry);
      setIncomingRequester(request.receipt.actor.slice(0, 6) + '…' + request.receipt.actor.slice(-6));
      const name = await getDisplayName(request.receipt.actor);
      if (name && !controller.signal.aborted) setIncomingRequester(name);
    }).catch(error => {
      if (!controller.signal.aborted && error instanceof FlowError && mainnetBlocked(error.message)) setProblem(error.message);
    });
    return () => controller.abort();
  }, [target, observe, digest, invalidNetwork, network]);

  function go(next: Step) {
    setProblem('');
    setStep(next);
  }

  function changeLanguage() {
    const next = lang === 'es' ? 'en' : 'es';
    setChosenLang(next);
    document.documentElement.lang = next;
    try { localStorage.setItem('vespi-lang', next); } catch {}
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', next);
      history.replaceState(history.state, '', url);
    }
  }

  async function enter(mode: 'create' | 'unlock' | 'device-create' | 'device-unlock' | 'retry') {
    if (busy) return;
    setProblem('');
    if (isEmbeddedBrowser(navigator.userAgent)) {
      setProblem('embedded');
      return;
    }
    setBusy(true);
    try {
      let key: Signer;
      let pair: Keypair | undefined;
      let at = unlockedNow();
      let local = mode === 'device-create' || mode === 'device-unlock';
      if (mode === 'retry') {
        if (!pendingAccount) return;
        ({ key, local, pair, at } = pendingAccount);
        // A retry is not a new passkey: after two minutes it no longer opens a session.
        if (!unlockIsRecent(pendingAccount.at)) pair = undefined;
      } else if (local) {
        const loaded = mode === 'device-create' ? await createDeviceKey() : await loadDeviceKey();
        if (!loaded) throw new Error('no-device-key');
        key = loaded;
      } else {
        const rpId = location.hostname;
        const prf = mode === 'create'
          ? await resolvePasskeyPrf({ rpId, created: await createPasskey({ rpId, userName: name.trim() }) })
          : await unlockPasskey({ rpId });
        if (!prf) {
          if (mode === 'create') go('device');
          else setProblem('device-required');
          return;
        }
        at = unlockedNow();
        pair = await keypairFromPrf(prf, rpId);
        key = signerFromKeypair(pair);
      }
      if (!mainnet) {
        if (mode !== 'retry') setPendingAccount({ key, local, pair, at });
        await onboard(key);
        setPendingAccount(undefined);
      }
      setDevice(local);
      setSigner(key);
      if (mainnet) {
        const displayName = identity?.account === key.publicKey ? identity.displayName : await getDisplayName(key.publicKey).catch(() => null);
        await openRequests(key.publicKey, displayName ?? undefined, local, key, pair, at);
      } else {
        keepMobileSigner(key, local, pair, at);
        await checkProfile(key, local);
      }
    } catch {
      setProblem('auth');
    } finally {
      setBusy(false);
    }
  }

  function startReturn(first: string, counterparty: string) {
    history.replaceState(null, '', withContributionNetwork('/app?back=' + first, network));
    const context = { first, counterparty };
    setReturning(context);
    if (account) restoreComposer(account, network, first, true);
  }

  async function openRequests(actor: string, displayName?: string, local?: boolean, key?: Signer, pair?: Keypair, at?: number) {
    if (displayName) rememberMobileIdentity(actor, displayName, local);
    if (key) keepMobileSigner(key, local === true, pair, at);
    setPublishedName(displayName ?? '');
    if (observe || survey || target) {
      go(observe ? 'observation' : target ? 'chain' : 'survey');
      return;
    }
    if (!backRoot) {
      if (composeRequest) await openComposer(actor, composeReceived === true);
      else go('dashboard');
      return;
    }
    go('return-check');
    try {
      const first = await loadChain(backRoot, AbortSignal.timeout(20_000), network);
      const delivery = confirmedDelivery(first);
      if (first.request.index.digest !== backRoot || delivery?.receipt.actor !== actor || first.request.receipt.actor === actor) {
        setProblem('return-ineligible');
        return;
      }
      if (readMobileIdentity()?.account !== actor) return;
      setReturning({ first: backRoot, counterparty: first.request.receipt.actor });
      const saved = await loadAttempt(actor, network);
      if (saved?.attempt.returning?.first === backRoot) restoreRequest(saved);
      else restoreComposer(actor, network, backRoot, true);
    } catch {
      setProblem('return-unavailable');
    }
  }

  function restoreRequest(saved: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>) {
    setVoiceSuggested(false);
    setDraftScope('');
    setAttempt(saved.attempt);
    setReturning(saved.attempt.returning);
    setDraft(saved.draft);
    const receivedPrefix = /^(Aporte recibido antes de la solicitud: |Contribution received before the request: )/;
    setReceived(receivedPrefix.test(saved.draft.statement));
    const savedStatement = saved.draft.statement.replace(receivedPrefix, '');
    setStatement(saved.attempt.network === 'mainnet' ? savedStatement : savedStatement.replace(/^(Ensayo: |Rehearsal: )/, ''));
    setComment(saved.draft.comment ?? '');
    go('review');
    setProblem('anchor-pending');
  }

  async function compose(recordReceived?: boolean) {
    if (!account || busy) return;
    setBusy(true);
    try { await openComposer(account, recordReceived); }
    finally { setBusy(false); }
  }

  function makeDraft(actor: string, value: string, note: string, alreadyReceived: boolean, selected: ContributionNetwork) {
    const prefix = initialStatement ? '' : alreadyReceived ? t.receivedPrefix : selected === 'mainnet' ? '' : t.prefix;
    return makeRequest(actor, (prefix + value.trim()).normalize('NFC'), note.trim().normalize('NFC') || null);
  }

  function restoreComposer(actor: string, selected: ContributionNetwork, flow: string, recordReceived?: boolean, fallbackReceived = false) {
    const saved = readComposerDraft(actor, selected, flow);
    const value = saved?.statement ?? initialStatement ?? '';
    const note = saved?.comment ?? '';
    const alreadyReceived = recordReceived ?? saved?.received ?? fallbackReceived;
    const onReview = !!(saved?.review && value.trim() && (recordReceived === undefined || saved.received === recordReceived));
    setDraftScope([actor, selected, flow].join(':'));
    setReceived(alreadyReceived);
    setRegistered('');
    setDraft(onReview ? makeDraft(actor, value, note, alreadyReceived, selected) : undefined);
    setAttempt(null);
    setCounterparty(saved?.counterparty ?? '');
    setConfirmedCounterparty(undefined);
    setShowDetails(Boolean(saved?.counterparty));
    setStatement(value);
    setComment(note);
    setVoiceSuggested(saved?.voiceSuggested === true);
    go(onReview ? 'review' : 'write');
  }

  async function openComposer(actor: string, recordReceived?: boolean) {
    const saved = await loadAttempt(actor, network, focusRecord);
    if (identity && readMobileIdentity()?.account !== actor) return;
    if (draftFlow === 'request' || draftFlow === 'received') legacyReceivedDraft(actor, network);
    const url = new URL(location.href);
    url.searchParams.set('accion', (recordReceived ?? composeReceived) && !initialStatement ? 'recibi' : 'pedir');
    history.replaceState(null, '', url);
    setReturning(undefined);
    if (focusRecord && saved?.draft.statement !== focusRegistration) {
      setDraft(makeRequest(actor, focusRegistration, null));
      go('review');
    } else if (saved) restoreRequest(saved);
    else restoreComposer(actor, network, draftFlow, recordReceived);
  }

  const restoreEntry = useEffectEvent(async (actor: string) => {
    if (backRoot) await openRequests(actor, identity?.displayName, identity?.local);
    else await openComposer(actor, composeReceived === true);
  });
  useEffect(() => {
    if (step === 'home' && identity?.account && !incompleteLink && (composeRequest || backRoot)) {
      void restoreEntry(identity.account);
    }
  }, [step, identity?.account, incompleteLink, composeRequest, backRoot]);

  async function accountSigner(fresh = false) {
    if (!account) throw new FlowError('auth');
    try { return await requireMobileSigner(account, device, fresh); }
    catch (error) {
      if (error instanceof FlowError && error.message === 'embedded') setProblem('embedded');
      throw error;
    }
  }

  async function leave() {
    if (!window.confirm(t.leave + (hasPendingSubmission(account) ? '\n\n' + t.leavePending : ''))) return;
    setBusy(true);
    const previous = location.href;
    await clearMobileIdentity();
    if (location.href === previous && !readMobileIdentity()) location.replace('/app?vista=aportes&lang=' + lang);
  }

  function updateNetwork(next: ContributionNetwork) {
    const url = new URL(location.href);
    url.searchParams.delete('network');
    history.replaceState(null, '', withContributionNetwork(url.pathname + url.search, next) + url.hash);
    setNetwork(next);
  }

  async function chooseNetwork(next: ContributionNetwork) {
    if (busy || next === network || !mainnetEnabled || !account) return;
    setBusy(true);
    try {
      if (step === 'write') {
        const saved = await loadAttempt(account, next);
        if (readMobileIdentity()?.account !== account) return;
        updateNetwork(next);
        if (saved) restoreRequest(saved);
        else restoreComposer(account, next, draftFlow, undefined, received);
      } else updateNetwork(next);
    } finally {
      setBusy(false);
    }
  }

  async function checkCounterparty() {
    const account = counterparty.trim().toUpperCase();
    if (!StrKey.isValidEd25519PublicKey(account) || account === (signer?.publicKey ?? identity?.account)) {
      setProblem('counterparty');
      return;
    }
    setCheckingCounterparty(true);
    setProblem('');
    try {
      const name = await getDisplayName(account);
      if (name) setConfirmedCounterparty({ account, name });
      else setProblem('counterparty');
    } catch { setProblem('counterparty'); }
    finally { setCheckingCounterparty(false); }
  }

  async function checkProfile(key: Signer, local = device) {
    go('profile-check');
    setBusy(true);
    try {
      const displayName = await getDisplayName(key.publicKey);
      if (displayName === null) go('profile');
      else await openRequests(key.publicKey, displayName, local, key);
    } catch {
      setProblem('profile-read');
    } finally {
      setBusy(false);
    }
  }

  async function publishProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = profileName.trim();
    if (busy || !signer || !profileConsent || !validDisplayName(displayName)) return;
    setBusy(true);
    setProblem('');
    try {
      const key = await requireMobileSigner(signer.publicKey, device, mainnet);
      await openRequests(key.publicKey, await publishDisplayName(key, displayName), device);
    } catch {
      setProblem('profile-write');
    } finally {
      setBusy(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = signer?.publicKey ?? identity?.account;
    if (!account || !statement.trim() || (counterparty.trim() && !confirmedCounterparty)) return;
    setDraft(makeDraft(account, statement, comment, received, network));
    go('review');
  }

  async function submit() {
    if (busy || !draft || draft.actor !== account) return;
    setBusy(true);
    setProblem('');
    let signed = attempt;
    try {
      if (!signed) {
        // The passkey comes first: iOS may refuse it after a network wait.
        const key = await requireMobileSigner(draft.actor, device, mainnet);
        if (mainnet && !await canUseMainnet(draft.actor)) throw new FlowError('account-not-allowed');
        signed = { ...await prepareRequest(draft, key, undefined, network), ...(returning && { returning }) };
        if (!getMobileSigner(draft.actor)) return;
        storeAttempt(draft.actor, signed, focusRecord);
        saveComposerDraft(draft.actor, network, draftFlow);
        setDraftScope('');
        setAttempt(signed);
      }
      const index = await anchorAttempt(signed);
      clearAttempt(draft.actor, signed, focusRecord);
      if (focusRecord) {
        history.replaceState(null, '', contributionLink('receipt', index.digest) + '&lang=' + lang);
      } else if (returning) {
        rememberMutual(draft.actor, index.digest, returning.first, network);
        history.replaceState(null, '', contributionLink('continue', index.digest, returning.first, network));
      } else {
        history.replaceState(null, '', contributionLink('continue', index.digest, mutual, network));
      }
      setRegistered(index.digest);
      setAttempt(null);
      go('done');
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : 'failed';
      if (['retry-with-fresh-transaction', 'invalid-timebound', 'inner-failed'].includes(reason)) {
        if (signed) clearAttempt(draft.actor, signed, focusRecord);
        setAttempt(null);
        setDraftScope([draft.actor, network, draftFlow].join(':'));
        setProblem('fresh');
      } else {
        setProblem(reason);
      }
    } finally {
      setBusy(false);
    }
  }

  const messages: Record<string, string> = {
    'different-account': t.differentAccount, counterparty: t.counterpartNotFound,
    'return-ineligible': t.returnOnly, 'return-unavailable': t.returnUnavailable,
    'profile-read': t.profileError, 'profile-write': t.profileWriteError,
    embedded: t.help, auth: t.authError, 'device-required': t.device, fresh: t.fresh,
    'anchor-pending': t.pending, 'receipt-not-found': t.missing, 'receipt-mismatch': t.mismatch,
    'testnet-account-missing': testnetAccountMissing(lang),
  };
  const delivery = acceptedDelivery ?? (chainHead?.receipt.kind === 'CONTRIBUTE' ? chainHead : undefined);
  const publicFocus = !mainnet && publicReceipt?.receipt.kind === 'REQUEST' && isFocusRegistration(publicReceipt.receipt.statement, publicReceipt.index.digest);
  const focusAttendanceReceipt = observedTarget && !observedTarget.delivery;
  const incomingFocus = !mainnet && incoming?.receipt.kind === 'REQUEST' && isFocusRegistration(incoming.receipt.statement, incoming.index.digest);
  const fingerprint = mainnet && publicReceipt && isEncounterFingerprint(publicReceipt.receipt);
  const recap = [
    { label: t.recapRequest, entry: chainRequest },
    { label: acceptedDelivery ? t.recapAcceptedDelivery : t.recapDelivery, entry: delivery },
    { label: t.recapAcceptance, entry: chainHead?.receipt.kind === 'ACCEPT' ? chainHead : undefined },
  ];
  const prompt = !!account && !identity?.local && !device && !getMobileSigner(account);
  const composing = step === 'write' || step === 'review';
  const compact = !survey && !observe;
  const title = incompleteLink ? t.incompleteLink : pair ? t.mutualTitle : dashboard ? t.dashboard : digest !== undefined ? (publicReceipt ? t.verified : t.receipt) : {
    dashboard: t.dashboard,
    home: focusRecord ? (lang === 'es' ? 'Registrar el evento' : 'Register the event') : focusSign || incomingFocus ? focusEvent.copy[lang].title : initialStatement ? t.prepareTalk : backRoot ? t.returnTitle : eventAttendance
      ? lang === 'es' ? 'Entra para firmar tu testimonio' : 'Sign in to sign your testimony'
      : observe ? t.observeTitle : target ? t.chainTitle : survey ? t.surveyTitle : composeReceived ? t.received : composeRequest ? t.request : t.dashboard, create: t.createTitle, device: t.deviceTitle,
    write: returning ? t.returnTitle : received ? t.receivedTitle : t.welcome, 'return-check': t.returnTitle, chain: target ? t.chainTitle : t.inviteTitle, observation: focusSign ? focusEvent.copy[lang].attend : t.observeTitle, survey: t.surveyTitle,
    'profile-check': t.profileName, profile: t.profileTitle,
    review: focusRecord ? (lang === 'es' ? 'Revisa el registro del evento' : 'Review the event record') : received ? t.reviewReceived : t.reviewTitle,
    done: focusRecord ? (lang === 'es' ? 'Registro del evento firmado' : 'Event record signed') : t.done,
  }[step];
  const firstTimeRequest = !identity && incoming?.receipt.kind === 'REQUEST' && proof === null;
  const suggestedAccount = returning?.counterparty ?? confirmedCounterparty?.account ??
    (StrKey.isValidEd25519PublicKey(counterparty.trim().toUpperCase()) ? counterparty.trim().toUpperCase() : undefined);
  const canShareRequest = !initialStatement && !returning && !suggestedAccount;

  return (
    <main className={'mobile-contributions' + (survey ? ' survey-page' : '') + (compact ? ' mobile-compact' : '') + (composing ? ' mobile-composing' : '')} lang={lang}>
      <header className="mobile-top">
        <AppBrand />
        <div className="mobile-settings">
          <button type="button" onClick={changeLanguage}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <ThemeSwitch lang={lang} />
        </div>
      </header>
      <div className="mobile-sheet">
        {!survey && !observe && !(digest && !mainnet) ? <MobileNetworkControl lang={lang} network={network} busy={busy}
          showTestnet={networkChoiceFlow && mainnetEnabled}
          choose={canChooseNetwork && mainnetEnabled && !attempt ? chooseNetwork : undefined} /> :
          <div className={'mobile-ledger' + (mainnet ? ' mobile-ledger-mainnet' : '')}>
            {survey === 'event' || (digest && !mainnet && !publicReceipt?.index.rehearsal) ? 'Stellar testnet' :
              mainnet ? 'Stellar mainnet' : focusSign || publicFocus || focusAttendanceReceipt ? 'Stellar testnet' : lang === 'es' ? 'Ensayo · Stellar testnet' : 'Rehearsal · Stellar testnet'}
          </div>}
        <section className="mobile-content" aria-labelledby="mobile-heading">
          <h1 id="mobile-heading" ref={heading} tabIndex={-1}>{title}</h1>
          {incompleteLink ? <>
            <p>{t.incompleteInfo}</p>
            <Link className="mobile-action" href="/app">{t.homeLink}</Link>
          </> : mainnetGate ? <>
            {allowed === undefined ? <p className="mobile-note" role="status">{t.opening}</p> : <>
              <MainnetFailure lang={lang} reason={allowed === false ? 'account-not-allowed' : 'mainnet-unavailable'} />
              {allowed === 'unavailable' && <button className="mobile-secondary" type="button" onClick={() => {
                setNetworkAccess(undefined);
                setNetworkRetry(networkRetry + 1);
              }}>{t.retry}</button>}
              <button className="mobile-text-action" type="button" onClick={leave}>{lang === 'es' ? 'Salir' : 'Sign out'}</button>
            </>}
          </> : pair ? <MutualSupport lang={lang} first={pair.first} second={pair.second} network={network} /> : digest !== undefined ? (
            publicReceipt ? <>
              {!publicFocus && !fingerprint && publicReceipt.receipt.kind !== 'SURVEY' && publicReceipt.receipt.kind !== 'ATTEST' && <p>{chainHead?.receipt.kind === 'ACCEPT' ? (publicReceipt.receipt.kind === 'CONTRIBUTE' && acceptedDelivery?.index.digest !== digest ? t.otherVersion : t.accepted) : chainHead?.receipt.kind === 'CONTRIBUTE' ? t.pendingAcceptance :
                chainHead?.receipt.kind === 'REQUEST' ? t.openRequest : t.statusUnavailable}</p>}
              {observedTarget?.delivery && <p>{t.observed} {t.observationIndependent}</p>}
              {focusAttendanceReceipt && <p>{lang === 'es' ? 'Asistencia firmada' : 'Signed attendance'}</p>}
              <blockquote>{publicReceipt.receipt.statement}</blockquote>
              {publicReceipt.receipt.comment && <p>{publicReceipt.receipt.comment}</p>}
              {publicReceipt.receipt.kind === 'ATTEST' && publicReceipt.receipt.evidence &&
                <a className="mobile-secondary" href={publicReceipt.receipt.evidence.uri}>
                  {lang === 'es' ? 'Ver foto adjunta' : 'View attached photo'}
                </a>}
              <dl className="mobile-details">
                <dt>{t.account}</dt><dd>{fingerprint ? publicReceipt.receipt.actor :
                  <Link href={withContributionNetwork('/app/perfil/' + publicReceipt.receipt.actor + (lang === 'en' ? '?lang=en' : ''), network)}>{publicReceipt.receipt.actor}</Link>}</dd>
                <dt>{t.digest}</dt><dd>{digest}</dd>
                {publicReceipt.receipt.kind === 'SURVEY' && <>
                  <dt>{t.commitment}</dt><dd>{publicReceipt.receipt.evidence.commitment}</dd>
                </>}
              </dl>
              {observedTarget?.delivery &&
                <Link className="mobile-secondary" href={'/app?receipt=' + observedTarget.delivery.index.digest}>{t.observedDelivery}</Link>}
              {focusAttendanceReceipt && <Link className="mobile-secondary" href={'/app?receipt=' + observedTarget.request.index.digest + '&lang=' + lang}>
                {lang === 'es' ? 'Ver el registro del evento' : 'View the event record'}
              </Link>}
              {publicFocus && <Link className="mobile-action" href={focusLink}>{focusEvent.copy[lang].details}</Link>}
              {!mainnet && publicReceipt.receipt.kind === 'CONTRIBUTE' &&
                <Link className="mobile-action" href={'/app?observe=' + digest}>{t.observeAction}</Link>}
              {!mainnet && hydrated && publicReceipt.receipt.kind === 'CONTRIBUTE' && <details className="mobile-counterparty">
                <summary>{t.inviteWitness}</summary>
                <ShareActions lang={lang} url={location.origin + '/app?observe=' + digest}
                  label={t.inviteWitness} message={t.witnessMessage} />
              </details>}
              {chainRequest && <dl className="mobile-chain-summary">
                {recap.map(({ label, entry }) => entry && <div key={entry.index.digest}>
                  <dt>{label}</dt>
                  <dd>
                    {entry.index.digest !== digest && <p>{entry.receipt.statement}</p>}
                    <Link href={explorer + '/tx/' + entry.index.txHash}>{t.recapVerify}: {label}</Link>
                  </dd>
                </div>)}
              </dl>}
              {acceptedDelivery && acceptedDelivery.index.digest !== digest &&
                <Link className="mobile-secondary" href={contributionLink('receipt', acceptedDelivery.index.digest, mutual, network)}>{t.exactDelivery}</Link>}
              {publicReceipt.receipt.kind === 'ACCEPT' && chainHead?.index.digest === digest && chainRequest && acceptedDelivery &&
                <Link className="mobile-secondary" href={withContributionNetwork('/app/cadena/' + chainRequest.index.digest + '?lang=' + lang, network)}>
                  {lang === 'es' ? 'Ver resultado de la cadena' : 'View chain result'}
                </Link>}
              {chainHead && chainHead.index.digest !== digest &&
                <Link className="mobile-secondary" href={contributionLink('receipt', chainHead.index.digest, mutual, network)}>{t.seeLatest}</Link>}
              {chainHead && chainHead.index.digest === digest && chainHead.receipt.kind !== 'ACCEPT' &&
                <Link className="mobile-action" href={contributionLink('continue', digest, mutual, network)}>
                  {chainHead.receipt.kind === 'REQUEST' ?
                    (identity?.account === chainHead.receipt.actor ? t.authorizeAccount : t.manage) : t.decide}
                </Link>}
              {hydrated && chainHead?.index.digest === digest && chainHead.receipt.kind === 'REQUEST' &&
                identity?.account === chainHead.receipt.actor && <>
                  <p>{t.noAccountYet}</p>
                  <ShareActions lang={lang} url={location.origin + contributionLink('continue', digest, mutual, network)}
                    label={t.sendRequest} message={t.requestMessage} />
                </>}
              {mutual && chainRequest && <Link className="mobile-secondary"
                href={withContributionNetwork('/app?mutual=' + mutual + '&return=' + chainRequest.index.digest, network)}>{t.both}</Link>}
              {!mutual && delivery && chainRequest && <Link className="mobile-secondary"
                href={withContributionNetwork('/app?back=' + chainRequest.index.digest, network)}>{t.returnTitle}</Link>}
              <a className="mobile-secondary" href={explorer + '/tx/' + publicReceipt.index.txHash}>{t.transaction}</a>
            </> : problem ? <button className="mobile-secondary" type="button" onClick={() => {
              setProblem('');
              setReadVersion(readVersion + 1);
            }}>{t.retry}</button> : <p role="status">{t.checking}</p>
          ) : <>
            {pendingAccount && !busy && <button type="button" className="mobile-action" onClick={() => enter('retry')}>
              {lang === 'es' ? 'Reintentar el alta' : 'Retry account setup'}
            </button>}
            {dashboard && account && (initialStatement ? <>
              <blockquote>{initialStatement}</blockquote>
              <button className="mobile-action" type="button" disabled={busy} onClick={() => compose()}>
                {lang === 'es' ? 'Revisar el registro de Yerko' : 'Review Yerko’s talk record'}
              </button>
            </> : <MobileDashboard lang={lang} identity={{ account, displayName: publishedName ||
              (identity?.account === account ? identity.displayName : account) }} network={network}
              onLeave={leave} busy={busy} />)}
            {step === 'home' && incomingFocus ? <Link className="mobile-action" href={focusLink}>{focusEvent.copy[lang].details}</Link>
              : step === 'home' && focusSign && focusStatus !== 'open' ? <Link className="mobile-action" href={focusLink}>{focusEvent.copy[lang].details}</Link>
              : step === 'home' && !dashboard && !showChain && !(identity && (composeRequest || backRoot)) && !pendingAccount && <>
              {incoming ? <>
                <p><strong>{incomingRequester}</strong> {incoming.receipt.kind === 'REQUEST' ? t.incomingRequestBy : t.incomingDeliveryBy}</p>
                <blockquote>{incoming.receipt.statement}</blockquote>
              </> : <p>{focusRecord ? focusRegistration : focusSign ? (lang === 'es' ? 'Entra o crea tu cuenta para firmar tu asistencia.' : 'Sign in or create your account to sign your attendance.') : initialStatement ? t.prepareTalkIntro : backRoot ? t.returnIntro : eventAttendance ? yerkoTitle
                : observe ? t.observeIntro : survey ? t.surveyIntro : t.intro}</p>}
              <div className="mobile-actions">
                {survey && <button type="button" className="mobile-action" disabled={busy} onClick={() => go('survey')}>{t.withoutAccount}</button>}
                {firstTimeRequest && <>
                  <button type="button" className="mobile-action" disabled={busy} onClick={() => go('create')}>{t.create}</button>
                  <p className="mobile-note">{t.existingAccount}</p>
                </>}
                <button type="button" className={survey || firstTimeRequest ? 'mobile-secondary' : 'mobile-action'} disabled={busy || !hydrated} onClick={() => enter('unlock')}>
                  {survey ? lang === 'es' ? 'Entrar para responder y obtener un recibo' : 'Sign in to answer and get a receipt' : t.enter}
                </button>
                {hydrated && !identity && !firstTimeRequest && <button type="button" className="mobile-text-action" disabled={busy} onClick={() => go('create')}>{t.create}</button>}
                <details className="mobile-counterparty">
                  <summary>{lang === 'es' ? 'Ayuda para entrar' : 'Sign-in help'}</summary>
                  <p className="mobile-note">{lang === 'es' ? 'Si pierdes tu passkey, no hay recuperación.' : 'If you lose your passkey, there is no recovery.'}</p>
                  <button type="button" className="mobile-text-action" disabled={busy || !hydrated} onClick={() => enter('device-unlock')}>{t.existingDevice}</button>
                </details>
              </div>
            </>}
            {step === 'create' && !pendingAccount && <form className="mobile-actions" onSubmit={event => { event.preventDefault(); if (name.trim()) void enter('create'); }}>
              <label htmlFor="passkey-name">{t.name}</label>
              <input id="passkey-name" value={name} onChange={event => setName(event.target.value)} maxLength={60}
                autoComplete="nickname" required aria-describedby="name-info" disabled={busy} />
              <p id="name-info" className="mobile-note">{t.nameInfo}</p>
              <button className="mobile-action" disabled={busy || !name.trim()}>{t.create}</button>
              <button type="button" className="mobile-text-action" disabled={busy} onClick={() => go('home')}>{t.back}</button>
            </form>}
            {step === 'device' && !pendingAccount && <>
              <p>{t.device}</p>
              <button type="button" className="mobile-action" disabled={busy} onClick={() => enter('device-create')}>{t.useDevice}</button>
              <button type="button" className="mobile-text-action" disabled={busy} onClick={() => go('home')}>{t.back}</button>
            </>}
            {step === 'profile-check' && problem && signer && <button type="button" className="mobile-action"
              onClick={() => checkProfile(signer)}>{t.profileRetry}</button>}
            {step === 'profile' && <form className="mobile-actions" onSubmit={publishProfile}>
              <label htmlFor="profile-name">{t.profileName}</label>
              <input id="profile-name" value={profileName} onChange={event => {
                setProfileName(event.target.value);
                setProfileConsent(false);
              }}
                maxLength={80} required aria-describedby="profile-rule" disabled={busy} />
              <p id="profile-rule" className="mobile-note">{t.profilePermanent}</p>
              {profileName.trim() && !validDisplayName(profileName.trim()) && <p role="status">{t.profileInvalid}</p>}
              <p className="mobile-note"><strong>{t.account}</strong> {signer?.publicKey}</p>
              <label className="mobile-consent">
                <input type="checkbox" checked={profileConsent} required disabled={busy}
                  onChange={event => setProfileConsent(event.target.checked)} />
                <span>{t.profileConsent}</span>
              </label>
              <SigningButton lang={lang} label={t.profilePublish} prompt={prompt} disabled={busy || !profileConsent || !validDisplayName(profileName.trim())} />
            </form>}
            {showChain && (target || registered) && account && <ChainAction lang={lang} network={network}
              key={returning ? registered : target ?? registered} target={returning ? registered : target ?? registered}
              account={account} prompt={!identity?.local && !device} getSigner={() => accountSigner(mainnet)} getVoiceSigner={() => accountSigner()} proof={proof ?? ''} heading={heading} mutual={returning?.first ?? mutual} suggestedAccount={suggestedAccount}
              yerko={target && yerko?.root === target ? yerko : undefined} onReturn={startReturn} />}
            {step === 'observation' && observe && signer && <ObservationAction lang={lang} subject={observe} account={signer.publicKey} getSigner={() => accountSigner()}
              name={publishedName || identity?.displayName} yerko={yerko} focusPhase={focusSign ? focusStatus : undefined} />}
            {step === 'return-check' && !problem && <p role="status">{t.checking}</p>}
            {step === 'survey' && survey && <SurveyParticipant lang={lang} signer={signer} getSigner={signer && (() => accountSigner())} cohort={survey} deadline={surveyDeadline} />}
            {step === 'write' && <form className="mobile-actions mobile-composer" onSubmit={review}>
              <div className="mobile-composer-field">
                <label className="sr-only" htmlFor="statement">{received && !returning ? t.receivedStatement : t.statement}</label>
                <textarea id="statement" ref={statementField} value={statement} placeholder={t.placeholder}
                  onChange={event => { setStatement(event.target.value); setVoiceSuggested(false); }}
                  rows={4} maxLength={970} aria-describedby={voiceSuggested ? 'request-voice-suggestion' : undefined} required />
                <VoiceDraftControl composer lang={lang} account={account} network={network} kind={received ? 'delivery' : 'request'}
                  getSigner={() => accountSigner()} needsPasskey={() => !!account && !device && !identity?.local && !getMobileSigner(account)}
                  hasWritten={draft => Boolean(statement.trim() || draft.comment && comment.trim())}
                  onDraft={(draft, choice) => {
                    const nextStatement = mergeVoiceText(statement, draft.statement, choice, 970);
                    const nextComment = mergeVoiceText(comment, draft.comment ?? '', choice, 280);
                    if (nextStatement !== statement || nextComment !== comment) {
                      setStatement(nextStatement);
                      setComment(nextComment);
                      setVoiceSuggested(true);
                    }
                    statementField.current?.focus();
                  }} />
              </div>
              {voiceSuggested && <p id="request-voice-suggestion" className="voice-suggestion">{t.voiceSuggestion}</p>}
              <button className="mobile-action" disabled={busy || !statement.trim() || !!(counterparty.trim() && !confirmedCounterparty)}>{t.review}</button>
              <details className="mobile-composer-details" open={showDetails} onToggle={event => setShowDetails(event.currentTarget.open)}>
                <summary>{t.details}</summary>
                <div className="mobile-composer-extra">
                  <label htmlFor="comment">{t.comment}</label>
                  <textarea id="comment" rows={2} value={comment}
                    onChange={event => { setComment(event.target.value); setVoiceSuggested(false); }} maxLength={280} />
                  {!returning && <>
                    <label htmlFor="counterparty">{t.chooseCounterparty}</label>
                    <input id="counterparty" value={counterparty} maxLength={56} autoCapitalize="characters"
                      disabled={checkingCounterparty} onChange={event => { setCounterparty(event.target.value); setConfirmedCounterparty(undefined); }} />
                    <button type="button" className="mobile-secondary" disabled={checkingCounterparty || !counterparty.trim()}
                      onClick={checkCounterparty}>{checkingCounterparty ? t.counterpartBusy : t.counterpartCheck}</button>
                    {confirmedCounterparty && <p role="status"><strong>{confirmedCounterparty.name}</strong> · {confirmedCounterparty.account}</p>}
                  </>}
                </div>
              </details>
            </form>}
            {step === 'review' && draft && <>
              {voiceSuggested && <p className="voice-suggestion">{t.voiceSuggestion}</p>}
              {mainnet ? <MainnetNotice previewFirst lang={lang} actor={draft.actor} statement={draft.statement} comment={draft.comment} /> : <>
                <blockquote>{draft.statement}</blockquote>
                {draft.comment && <p className="mobile-public-comment">{draft.comment}</p>}
                <details className="mobile-review-account">
                  <summary>{t.account} <code>{draft.actor.slice(0, 6)}…{draft.actor.slice(-6)}</code></summary>
                  <code>{draft.actor}</code>
                </details>
                <p className="mobile-note">{focusRecord ? (lang === 'es' ? 'Tu cuenta y el registro del evento quedarán públicos.' : 'Your account and the event record will be public.') : t.consent}</p>
              </>}
              <SigningButton type="button" lang={lang} label={attempt ? t.retry : t.sign} prompt={!attempt && (mainnet && !identity?.local && !device || prompt)}
                disabled={busy} onClick={submit} />
              {attempt ? <a className="mobile-text-action" href={contributionLink('receipt', attempt.digest, returning?.first, network)}
                target="_blank" rel="noreferrer">{t.pendingLink}</a> :
                !focusRecord && <button type="button" className="mobile-text-action mobile-review-edit" disabled={busy} onClick={() => go('write')}>{t.edit}</button>}
            </>}
            {step === 'done' && (focusRecord ? <>
              <blockquote>{focusRegistration}</blockquote>
              <Link className="mobile-action" href={contributionLink('receipt', registered) + '&lang=' + lang}>{t.receipt}</Link>
              <Link className="mobile-secondary" href={focusLink}>{focusEvent.copy[lang].details}</Link>
            </> : <>
              <p>{initialStatement ? lang === 'es' ? 'Firmaste el registro de la charla. Ahora puedes invitar a Yerko.' :
                'You signed the talk record. You can now invite Yerko.' : canShareRequest ? t.noAccountYet : t.inviteNext}</p>
              {canShareRequest &&
                <ShareActions lang={lang} url={location.origin + contributionLink('continue', registered, mutual, network)}
                  label={t.sendRequest} message={t.requestMessage} />}
              <button type="button" className={canShareRequest ? 'mobile-secondary' : 'mobile-action'} onClick={() => go('chain')}>
                {initialStatement ? lang === 'es' ? 'Invitar a Yerko a firmar' : 'Invite Yerko to sign' : t.inviteTitle}
              </button>
              <Link className="mobile-secondary" href={contributionLink('receipt', registered, returning?.first, network)}>{t.receipt}</Link>
            </>)}
            {busy && <p role="status" className="mobile-note">{step === 'review' ? t.anchoring : step === 'profile' ? t.profilePublishing : step === 'profile-check' ? t.profileChecking : t.opening}</p>}
          </>}
          {problem === 'embedded' && (target || observe || backRoot || initialStatement) && <div className="mobile-actions">
            <button type="button" className="mobile-secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(location.href); setCopyIncoming('copied'); }
              catch { setCopyIncoming('manual'); }
            }}>{t.copyOpen}</button>
            {copyIncoming === 'manual' &&
              <input aria-label={t.copyOpen} readOnly value={location.href} onFocus={event => event.target.select()} />}
            {copyIncoming && <p role="status">{copyIncoming === 'copied' ? t.copyOpenDone : t.copyOpenManual}</p>}
          </div>}
          {problem && (mainnet && mainnetBlocked(problem) ? <MainnetFailure lang={lang} reason={problem} />
            : <p className="mobile-message" role="alert">{messages[problem] ?? t.failed}</p>)}
        </section>
      </div>
      {(compact || digest) && !dashboard && account && <nav className="mobile-flow-footer" aria-label={t.dashboard}>
        <Link className="mobile-profile-link" href={withContributionNetwork('/app?vista=aportes&lang=' + lang, network)}>{t.dashboard}</Link>
        {identity && <Link className="mobile-profile-link" href={withContributionNetwork('/app/perfil/' + identity.account + (lang === 'en' ? '?lang=en' : ''), network)}>{identity.displayName}</Link>}
      </nav>}
      <AppFooter lang={lang} />
    </main>
  );
}
