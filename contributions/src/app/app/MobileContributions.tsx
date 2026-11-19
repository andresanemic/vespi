'use client';

import Link from 'next/link';
import { StrKey } from '@stellar/stellar-sdk/base';
import MobileDashboard, { MobileEventLink } from './MobileDashboard';
import { getMobileSigner, keepMobileSigner, rememberMobileIdentity, useMobileIdentity } from './mobile-identity';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import AppBrand from './AppBrand';
import AppFooter from './AppFooter';
import ThemeSwitch from '@/components/ThemeSwitch';
import type { Lang } from '@/lib/i18n';
import { createDeviceKey, loadDeviceKey } from '@/lib/contributions/device-key';
import { createPasskey, isEmbeddedBrowser, keypairFromPrf, resolvePasskeyPrf,
  signerFromKeypair, unlockPasskey, type Signer } from '@/lib/contributions/keys';
import { anchorAttempt, clearAttempt, contributionLink, FlowError, getDisplayName, loadAttempt, makeRequest, onboard, prepareRequest, publishDisplayName, readObservationTarget, readReceipt, storeAttempt, validDisplayName, type Attempt, type PublicReceipt, type ReturnContext } from './client';

import ChainAction, { loadChain } from './ChainAction';
import MutualSupport, { confirmedDelivery } from './MutualSupport';
import ShareActions from './ShareActions';
import { rememberMutual } from './saved-invitations';
import ObservationAction from './ObservationAction';
import { yerkoTitle } from './evento/yerko/event';
import SurveyParticipant from './encuesta/SurveyParticipant';

const copy = {
  es: {
    prepareTalk: 'Preparar registro de la charla', prepareTalkIntro: 'Entra para preparar el registro de la charla y revisar el texto antes de firmar.',
    inviteWitness: 'Invitar a dar testimonio', witnessMessage: 'Si viste esta charla o aporte, abre el enlace para dar tu testimonio en Vespi Contributions.',
    whatHappened: '¿Qué pasó?', dashboard: 'Mis aportes', signUnlock: 'Desbloquear para firmar', differentAccount: 'Desbloqueaste otra cuenta. Usa la cuenta con la que vas a firmar el recibo.',
    counterpartCheck: 'Comprobar cuenta', chooseCounterparty: '¿Con quién fue? (opcional)', chooseHelp: 'Si eliges una cuenta, la tendrás lista para invitar después de firmar la solicitud.',
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
    receivedHelp: 'Primero firmas una solicitud que deja constancia de que ya recibiste el aporte. Después, quien lo entregó firma su propia entrega y tú decides si la aceptas.',
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
    testnet: 'Ensayo · Stellar testnet', home: 'Registra una solicitud', intro: 'Pide un aporte y comparte el recibo firmado.',
    enter: 'Entrar con passkey', create: 'Crear una passkey', name: 'Nombre para tu passkey', createTitle: 'Crea tu passkey',
    nameInfo: 'Este nombre te ayuda a reconocer la passkey en tu teléfono.',
    deviceTitle: 'Clave en este dispositivo', device: 'Tu passkey no permite generar la clave de la cuenta. Si usas una clave en este dispositivo, perderás el acceso a la cuenta si borras los datos del sitio.',
    useDevice: 'Usar clave en este dispositivo', existingDevice: 'Entrar con clave de este dispositivo',
    back: 'Volver', welcome: '¿Qué aporte necesitas?', statement: 'Escribe tu solicitud',
    comment: 'Comentario opcional', review: 'Revisar solicitud', reviewTitle: 'Así se verá tu solicitud', sign: 'Firmar y publicar',
    consent: 'Al firmar aceptas que tu cuenta, la declaración y el comentario queden públicos.', prefix: 'Ensayo: ',
    opening: 'Abriendo tu cuenta…', anchoring: 'Registrando tu firma…', pending: 'La firma todavía está pendiente de confirmación.', retry: 'Comprobar de nuevo',
    done: 'Solicitud registrada', pendingLink: 'Enlace de esta solicitud', receipt: 'Abrir recibo público', checking: 'Comprobando recibo…', verified: 'Firma y recibo verificados',
    transaction: 'Ver transacción en Stellar Expert', account: 'Cuenta', digest: 'Huella del recibo',
    help: 'Abre esta página en Safari o Chrome para usar tu passkey.', authError: 'No pudimos abrir tu cuenta. Puedes volver a intentar.',
    failed: 'No pudimos registrar o comprobar el recibo. Vuelve a intentar.', missing: 'El recibo no está disponible.',
    fresh: 'Este intento terminó sin registrar la solicitud. Puedes volver a firmar o editarla.',
    mismatch: 'El contenido no coincide con la firma esperada.', edit: 'Editar solicitud',
    keyNote: 'Esta cuenta usa una clave guardada en este dispositivo.',
  },
  en: {
    prepareTalk: 'Prepare the talk record', prepareTalkIntro: 'Sign in to prepare the talk record and review the text before signing.',
    inviteWitness: 'Invite people to give testimony', witnessMessage: 'If you saw this talk or contribution, open the link to give testimony in Vespi Contributions.',
    whatHappened: 'What happened?', dashboard: 'My contributions', signUnlock: 'Unlock to sign', differentAccount: 'You unlocked a different account. Use the account that will sign the receipt.',
    counterpartCheck: 'Check account', chooseCounterparty: 'Who was involved? (optional)', chooseHelp: 'If you choose an account, it will be ready to invite after you sign the request.',
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
    receivedHelp: 'First, sign a request that says you already received the contribution. The person who delivered it signs their delivery, and you decide whether to accept it.',
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
    testnet: 'Rehearsal · Stellar testnet', home: 'Register a request', intro: 'Ask for a contribution and share the signed receipt.',
    enter: 'Sign in with a passkey', create: 'Create a passkey', name: 'Name for your passkey', createTitle: 'Create your passkey',
    nameInfo: 'This name helps you recognise the passkey on your phone.',
    deviceTitle: 'Key on this device', device: 'Your passkey cannot generate the account key. If you use a key on this device, clearing site data will remove access to the account.',
    useDevice: 'Use key on this device', existingDevice: 'Sign in with key on this device',
    back: 'Back', welcome: 'What contribution do you need?', statement: 'Write your request',
    comment: 'Optional comment', review: 'Review request', reviewTitle: 'Review your request', sign: 'Sign and publish',
    consent: 'By signing, you agree to make your account, statement and comment public.', prefix: 'Rehearsal: ',
    opening: 'Opening your account…', anchoring: 'Submitting your signature…', pending: 'Your signature is pending confirmation.', retry: 'Check again',
    done: 'Request registered', pendingLink: 'Link to this request', receipt: 'Open public receipt', checking: 'Checking receipt…', verified: 'Signature and receipt verified',
    transaction: 'View transaction on Stellar Expert', account: 'Account', digest: 'Receipt hash',
    help: 'Open this page in Safari or Chrome to use your passkey.', authError: 'We could not open your account. Try again.',
    failed: 'We could not register or verify the receipt. Try again.', missing: 'This receipt is unavailable.',
    fresh: 'This attempt ended before the request was registered. Sign again or edit it.',
    mismatch: 'The content does not match the expected signature.', edit: 'Edit request',
    keyNote: 'This account uses a key stored on this device.',
  },
};

type Step = 'home' | 'dashboard' | 'create' | 'device' | 'profile-check' | 'profile' | 'write' | 'chain' | 'return-check' | 'observation' | 'survey' | 'review' | 'done';
type Receipt = Awaited<ReturnType<typeof readReceipt>>;

const subscribeToHydration = () => () => {};
const afterHydration = () => true;
const beforeHydration = () => false;

export default function MobileContributions({ digest, target, observe, backRoot, mutual, pair, survey, surveyDeadline, initialStatement, initialLang, yerko, eventAttendance }: {
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
  initialStatement?: string;
}) {
  const hydrated = useSyncExternalStore(subscribeToHydration, afterHydration, beforeHydration);
  const identity = useMobileIdentity();
  const [lang, setLang] = useState<Lang>(initialLang ?? 'es');
  const [step, setStep] = useState<Step>('home');
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
  const [draft, setDraft] = useState<ReturnType<typeof makeRequest>>();
  const [signer, setSigner] = useState<Signer>();
  const [device, setDevice] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<{ key: Signer; local: boolean }>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [registered, setRegistered] = useState('');
  const [returning, setReturning] = useState<ReturnContext>();
  const [acceptedDelivery, setAcceptedDelivery] = useState<Receipt>();
  const [observedDelivery, setObservedDelivery] = useState<Receipt>();
  const [chainRequest, setChainRequest] = useState<Receipt>();
  const [incoming, setIncoming] = useState<Receipt>();
  const [incomingRequester, setIncomingRequester] = useState('');
  const [copyIncoming, setCopyIncoming] = useState<'copied' | 'manual'>();
  const [chainHead, setChainHead] = useState<Receipt>();
  const [publicReceipt, setPublicReceipt] = useState<PublicReceipt>();
  const [readVersion, setReadVersion] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const t = copy[lang];
  const dashboard = step === 'dashboard' || (step === 'home' && identity && !digest && !target && !observe && !backRoot && !pair && !survey);

  useEffect(() => {
    if (step !== 'home') heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (digest === undefined) return;
    const controller = new AbortController();
    readReceipt(digest, controller.signal, 'all').then(async entry => {
      if (controller.signal.aborted) return;
      if (entry.receipt.kind === 'ATTEST') {
        const { actor, chain, subject, role, prev } = entry.receipt;
        const { delivery, request } = await readObservationTarget(subject, controller.signal);
        if (request.index.digest !== chain || role !== 'observer' || prev !== null ||
          actor === request.receipt.actor || actor === delivery.receipt.actor) throw new FlowError('receipt-mismatch');
        if (!controller.signal.aborted) {
          setObservedDelivery(delivery);
          setPublicReceipt(entry);
        }
        return;
      }
      setPublicReceipt(entry);
      if (entry.receipt.kind === 'SURVEY') return;
      return loadChain(digest, controller.signal, { receipt: entry.receipt, index: entry.index }).then(({ request, head, acceptedDelivery }) => {
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
  }, [digest, readVersion]);

  useEffect(() => {
    if (!target || observe || digest) return;
    const controller = new AbortController();
    readReceipt(target, controller.signal).then(async entry => {
      const request = entry.receipt.kind === 'REQUEST' ? entry : await readReceipt(entry.receipt.chain, controller.signal);
      if (request.receipt.kind !== 'REQUEST' || controller.signal.aborted) return;
      setIncoming(entry);
      setIncomingRequester(request.receipt.actor.slice(0, 6) + '…' + request.receipt.actor.slice(-6));
      const name = await getDisplayName(request.receipt.actor);
      if (name && !controller.signal.aborted) setIncomingRequester(name);
    }).catch(() => {});
    return () => controller.abort();
  }, [target, observe, digest]);

  function go(next: Step) {
    setProblem('');
    setStep(next);
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
      const cached = mode === 'unlock' && identity ? getMobileSigner(identity.account) : undefined;
      if (cached && (step !== 'review' || draft?.actor === cached.signer.publicKey) && identity) {
        setDevice(cached.local);
        setSigner(cached.signer);
        if (step !== 'review') await openRequests(cached.signer, identity.displayName);
        return;
      }
      let key: Signer;
      let local = mode === 'device-create' || mode === 'device-unlock';
      if (mode === 'retry') {
        if (!pendingAccount) return;
        ({ key, local } = pendingAccount);
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
        key = signerFromKeypair(await keypairFromPrf(prf, rpId));
      }
      if (step === 'review' && draft) {
        if (key.publicKey !== draft.actor) {
          setProblem('different-account');
          return;
        }
        setDevice(local);
        setSigner(key);
        keepMobileSigner(key, local);
        return;
      }
      setPendingAccount({ key, local });
      await onboard(key);
      setPendingAccount(undefined);
      setDevice(local);
      setSigner(key);
      keepMobileSigner(key, local);
      await checkProfile(key);
    } catch {
      setProblem('auth');
    } finally {
      setBusy(false);
    }
  }

  function startReturn(first: string, counterparty: string) {
    history.replaceState(null, '', '/app?back=' + first);
    setReturning({ first, counterparty });
    setCounterparty('');
    setConfirmedCounterparty(undefined);
    setReceived(true);
    setRegistered('');
    setDraft(undefined);
    setAttempt(null);
    setStatement('');
    setComment('');
    go('write');
  }

  async function openRequests(key: Signer, displayName: string) {
    rememberMobileIdentity(key.publicKey, displayName);
    setPublishedName(displayName);
    if (observe) {
      go('observation');
      return;
    }
    if (target || survey) {
      go(target ? 'chain' : 'survey');
      return;
    }
    if (!backRoot) {
      go('dashboard');
      return;
    }
    const saved = await loadAttempt(key.publicKey);
    if (saved) {
      restoreRequest(saved);
    } else if (backRoot) {
      go('return-check');
      try {
        const first = await loadChain(backRoot, AbortSignal.timeout(20_000));
        const delivery = confirmedDelivery(first);
        if (first.request.index.digest !== backRoot || delivery?.receipt.actor !== key.publicKey ||
          first.request.receipt.actor === key.publicKey) {
          setProblem('return-ineligible');
          return;
        }
        startReturn(backRoot, first.request.receipt.actor);
      } catch {
        setProblem('return-unavailable');
      }
    } else {
      go('write');
    }
  }

  function restoreRequest(saved: NonNullable<Awaited<ReturnType<typeof loadAttempt>>>) {
    setAttempt(saved.attempt);
    setReturning(saved.attempt.returning);
    setDraft(saved.draft);
    const receivedPrefix = /^(Aporte recibido antes de la solicitud: |Contribution received before the request: )/;
    setReceived(receivedPrefix.test(saved.draft.statement));
    setStatement(saved.draft.statement.replace(receivedPrefix, '').replace(/^(Ensayo: |Rehearsal: )/, ''));
    setComment(saved.draft.comment ?? '');
    go('review');
    setProblem('anchor-pending');
  }

  async function compose() {
    const account = signer?.publicKey ?? identity?.account;
    if (!account || busy) return;
    if (!signer) {
      const cached = getMobileSigner(account);
      if (cached) {
        setDevice(cached.local);
        setSigner(cached.signer);
      }
    }
    setBusy(true);
    try {
      const saved = await loadAttempt(account);
      if (saved) restoreRequest(saved);
      else {
        setReceived(!initialStatement);
        setReturning(undefined);
        setRegistered('');
        setDraft(undefined);
        setAttempt(null);
        setCounterparty('');
        setConfirmedCounterparty(undefined);
        setStatement(initialStatement ?? '');
        setComment('');
        go('write');
      }
    } finally { setBusy(false); }
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

  async function checkProfile(key: Signer) {
    go('profile-check');
    setBusy(true);
    try {
      const displayName = await getDisplayName(key.publicKey);
      if (displayName === null) go('profile');
      else await openRequests(key, displayName);
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
      await openRequests(signer, await publishDisplayName(signer, displayName));
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
    const prefix = initialStatement ? '' : received ? t.receivedPrefix : t.prefix;
    setDraft(makeRequest(account, (prefix + statement.trim()).normalize('NFC'), comment.trim().normalize('NFC') || null));
    go('review');
  }

  async function submit() {
    if (busy || !draft || !signer) return;
    setBusy(true);
    setProblem('');
    let signed = attempt;
    try {
      if (!signed) {
        signed = { ...await prepareRequest(draft, signer), ...(returning && { returning }) };
        storeAttempt(signer.publicKey, signed);
        setAttempt(signed);
      }
      const index = await anchorAttempt(signed);
      clearAttempt(signer.publicKey, signed);
      if (returning) {
        rememberMutual(signer.publicKey, index.digest, returning.first);
        history.replaceState(null, '', contributionLink('continue', index.digest, returning.first));
      }
      setRegistered(index.digest);
      setAttempt(null);
      go('done');
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : 'failed';
      if (['retry-with-fresh-transaction', 'invalid-timebound', 'inner-failed'].includes(reason)) {
        if (signed) clearAttempt(signer.publicKey, signed);
        setAttempt(null);
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
  };
  const delivery = acceptedDelivery ?? (chainHead?.receipt.kind === 'CONTRIBUTE' ? chainHead : undefined);
  const recap = [
    { label: t.recapRequest, entry: chainRequest },
    { label: acceptedDelivery ? t.recapAcceptedDelivery : t.recapDelivery, entry: delivery },
    { label: t.recapAcceptance, entry: chainHead?.receipt.kind === 'ACCEPT' ? chainHead : undefined },
  ];
  const title = pair ? t.mutualTitle : dashboard ? t.dashboard : digest !== undefined ? (publicReceipt ? t.verified : t.receipt) : {
    dashboard: t.dashboard,
    home: initialStatement ? t.prepareTalk : backRoot ? t.returnTitle : eventAttendance
      ? lang === 'es' ? 'Entra para firmar tu testimonio' : 'Sign in to sign your testimony'
      : observe ? t.observeTitle : target ? t.chainTitle : survey ? t.surveyTitle : t.home, create: t.createTitle, device: t.deviceTitle,
    write: returning ? t.returnTitle : received ? t.whatHappened : t.welcome, 'return-check': t.returnTitle, chain: target ? t.chainTitle : t.inviteTitle, observation: t.observeTitle, survey: t.surveyTitle,
    'profile-check': t.profileName, profile: t.profileTitle,
    review: t.reviewTitle, done: t.done,
  }[step];

  return (
    <main className={survey ? 'mobile-contributions survey-page' : 'mobile-contributions'} lang={lang}>
      <header className="mobile-top">
        <AppBrand />
        <div className="mobile-settings">
          <button type="button" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Read in English' : 'Leer en español'}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <ThemeSwitch lang={lang} />
        </div>
      </header>
      <div className="mobile-sheet">
        <div className="mobile-ledger">{survey === 'event' || (digest && !publicReceipt?.index.rehearsal) ? 'Stellar testnet' : t.testnet}</div>
        <section className="mobile-content" aria-labelledby="mobile-heading">
          <h1 id="mobile-heading" ref={heading} tabIndex={-1}>{title}</h1>
          {pair ? <MutualSupport lang={lang} first={pair.first} second={pair.second} /> : digest !== undefined ? (
            publicReceipt ? <>
              {publicReceipt.receipt.kind !== 'SURVEY' && publicReceipt.receipt.kind !== 'ATTEST' && <p>{chainHead?.receipt.kind === 'ACCEPT' ? (publicReceipt.receipt.kind === 'CONTRIBUTE' && acceptedDelivery?.index.digest !== digest ? t.otherVersion : t.accepted) : chainHead?.receipt.kind === 'CONTRIBUTE' ? t.pendingAcceptance :
                chainHead?.receipt.kind === 'REQUEST' ? t.openRequest : t.statusUnavailable}</p>}
              {observedDelivery && <p>{t.observed} {t.observationIndependent}</p>}
              <blockquote>{publicReceipt.receipt.statement}</blockquote>
              {publicReceipt.receipt.comment && <p>{publicReceipt.receipt.comment}</p>}
              {publicReceipt.receipt.kind === 'ATTEST' && publicReceipt.receipt.evidence &&
                <a className="mobile-secondary" href={publicReceipt.receipt.evidence.uri}>
                  {lang === 'es' ? 'Ver foto adjunta' : 'View attached photo'}
                </a>}
              <dl className="mobile-details">
                <dt>{t.account}</dt><dd><Link href={'/app/perfil/' + publicReceipt.receipt.actor}>{publicReceipt.receipt.actor}</Link></dd>
                <dt>{t.digest}</dt><dd>{digest}</dd>
                {publicReceipt.receipt.kind === 'SURVEY' && <>
                  <dt>{t.commitment}</dt><dd>{publicReceipt.receipt.evidence.commitment}</dd>
                </>}
              </dl>
              {observedDelivery &&
                <Link className="mobile-secondary" href={'/app?receipt=' + observedDelivery.index.digest}>{t.observedDelivery}</Link>}
              {publicReceipt.receipt.kind === 'CONTRIBUTE' &&
                <Link className="mobile-action" href={'/app?observe=' + digest}>{t.observeAction}</Link>}
              {hydrated && publicReceipt.receipt.kind === 'CONTRIBUTE' && <details className="mobile-counterparty">
                <summary>{t.inviteWitness}</summary>
                <ShareActions lang={lang} url={location.origin + '/app?observe=' + digest}
                  label={t.inviteWitness} message={t.witnessMessage} />
              </details>}
              {chainRequest && <dl className="mobile-chain-summary">
                {recap.map(({ label, entry }) => entry && <div key={entry.index.digest}>
                  <dt>{label}</dt>
                  <dd>
                    {entry.index.digest !== digest && <p>{entry.receipt.statement}</p>}
                    <Link href={'https://stellar.expert/explorer/testnet/tx/' + entry.index.txHash}>{t.recapVerify}: {label}</Link>
                  </dd>
                </div>)}
              </dl>}
              {acceptedDelivery && acceptedDelivery.index.digest !== digest &&
                <Link className="mobile-secondary" href={contributionLink('receipt', acceptedDelivery.index.digest, mutual)}>{t.exactDelivery}</Link>}
              {chainHead && chainHead.index.digest !== digest &&
                <Link className="mobile-secondary" href={contributionLink('receipt', chainHead.index.digest, mutual)}>{t.seeLatest}</Link>}
              {chainHead && chainHead.index.digest === digest && chainHead.receipt.kind !== 'ACCEPT' &&
                <Link className="mobile-action" href={contributionLink('continue', digest, mutual)}>
                  {chainHead.receipt.kind === 'REQUEST' ? t.manage : t.decide}
                </Link>}
              {mutual && chainRequest && <Link className="mobile-secondary"
                href={'/app?mutual=' + mutual + '&return=' + chainRequest.index.digest}>{t.both}</Link>}
              {!mutual && delivery && chainRequest && <Link className="mobile-secondary"
                href={'/app?back=' + chainRequest.index.digest}>{t.returnTitle}</Link>}
              <a className="mobile-secondary" href={'https://stellar.expert/explorer/testnet/tx/' + publicReceipt.index.txHash}>{t.transaction}</a>
            </> : problem ? <button className="mobile-secondary" type="button" onClick={() => {
              setProblem('');
              setReadVersion(readVersion + 1);
            }}>{t.retry}</button> : <p role="status">{t.checking}</p>
          ) : <>
            {pendingAccount && !busy && <button type="button" className="mobile-action" onClick={() => enter('retry')}>
              {lang === 'es' ? 'Reintentar el alta' : 'Retry account setup'}
            </button>}
            {dashboard && identity && (initialStatement ? <>
              <blockquote>{initialStatement}</blockquote>
              <button className="mobile-action" type="button" disabled={busy} onClick={compose}>
                {lang === 'es' ? 'Revisar el registro de Yerko' : 'Review Yerko’s talk record'}
              </button>
            </> : <MobileDashboard lang={lang} identity={identity} busy={busy} onCompose={compose} />)}
            {step === 'home' && !dashboard && !pendingAccount && <>
              {incoming ? <>
                <p><strong>{incomingRequester}</strong> {incoming.receipt.kind === 'REQUEST' ? t.incomingRequestBy : t.incomingDeliveryBy}</p>
                <blockquote>{incoming.receipt.statement}</blockquote>
              </> : <p>{initialStatement ? t.prepareTalkIntro : backRoot ? t.returnIntro : eventAttendance ? yerkoTitle
                : observe ? t.observeIntro : survey ? t.surveyIntro : t.intro}</p>}
              {!target && !observe && !backRoot && !survey && <MobileEventLink lang={lang} />}
              <div className="mobile-actions">
                {survey && <button type="button" className="mobile-action" disabled={busy} onClick={() => go('survey')}>{t.withoutAccount}</button>}
                <button type="button" className={survey ? 'mobile-secondary' : 'mobile-action'} disabled={busy || !hydrated} onClick={() => enter('unlock')}>
                  {survey ? lang === 'es' ? 'Entrar para responder y obtener un recibo' : 'Sign in to answer and get a receipt' : t.enter}
                </button>
                {hydrated && !identity && <button type="button" className="mobile-text-action" disabled={busy} onClick={() => go('create')}>{t.create}</button>}
                <details className="mobile-counterparty">
                  <summary>{lang === 'es' ? 'Ayuda para entrar' : 'Sign-in help'}</summary>
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
              <button className="mobile-action" disabled={busy || !profileConsent || !validDisplayName(profileName.trim())}>{t.profilePublish}</button>
            </form>}
            {(step === 'write' || step === 'review' || step === 'chain' || step === 'observation') && (publishedName || identity?.displayName) &&
              <p className="mobile-note">{t.profileSaved} <strong>{publishedName || identity?.displayName}</strong>.
                {signer && <> <Link className="mobile-profile-link" href={'/app/perfil/' + signer.publicKey}>{t.myProfile}</Link></>}
              </p>}
            {step === 'chain' && (target || registered) && signer && <ChainAction lang={lang}
              key={returning ? registered : target ?? registered} target={returning ? registered : target ?? registered}
              signer={signer} mutual={returning?.first ?? mutual} suggestedAccount={returning?.counterparty ?? confirmedCounterparty?.account}
              yerko={target && yerko?.root === target ? yerko : undefined} onReturn={startReturn} />}
            {step === 'observation' && observe && signer && <ObservationAction lang={lang} subject={observe} signer={signer}
              name={publishedName || identity?.displayName} yerko={yerko} />}
            {step === 'return-check' && !problem && <p role="status">{t.checking}</p>}
            {step === 'survey' && survey && <SurveyParticipant lang={lang} signer={signer} cohort={survey} deadline={surveyDeadline} />}
            {step === 'write' && <form className="mobile-actions" onSubmit={review}>
              {!returning && !initialStatement && <>
              <button type="button" className="mobile-secondary" aria-pressed={!received} onClick={() => setReceived(false)}>{t.request}</button>
              <button type="button" className="mobile-secondary" aria-pressed={received} onClick={() => setReceived(true)}>{t.received}</button>
              </>}
              {received && <p className="mobile-note">{returning ? t.returnIntro : t.receivedHelp}</p>}
              {device && <p className="mobile-note">{t.keyNote}</p>}
              <label htmlFor="statement">{t.statement}</label>
              <textarea id="statement" value={statement} onChange={event => setStatement(event.target.value)}
                rows={3} maxLength={970} required />
              <label htmlFor="comment">{t.comment}</label>
              <input id="comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={240} />
              {!returning && <details className="mobile-counterparty">
                <summary>{t.chooseCounterparty}</summary>
                <p className="mobile-note">{t.chooseHelp}</p>
                <input value={counterparty} aria-label={t.chooseCounterparty} maxLength={56} autoCapitalize="characters"
                  disabled={checkingCounterparty} onChange={event => { setCounterparty(event.target.value); setConfirmedCounterparty(undefined); }} />
                <button type="button" className="mobile-secondary" disabled={checkingCounterparty || !counterparty.trim()}
                  onClick={checkCounterparty}>{checkingCounterparty ? t.counterpartBusy : t.counterpartCheck}</button>
                {confirmedCounterparty && <p role="status"><strong>{confirmedCounterparty.name}</strong> · {confirmedCounterparty.account}</p>}
              </details>}
              <button className="mobile-action" disabled={!statement.trim() || !!(counterparty.trim() && !confirmedCounterparty)}>{t.review}</button>
            </form>}
            {step === 'review' && draft && <>
              <blockquote>{draft.statement}</blockquote>
              {draft.comment && <p>{draft.comment}</p>}
              <p className="mobile-note">{t.consent}</p>
              <button type="button" className="mobile-action" disabled={busy}
                onClick={() => signer ? submit() : enter('unlock')}>{signer ? (attempt ? t.retry : t.sign) : t.signUnlock}</button>
              {!signer && <button type="button" className="mobile-text-action" disabled={busy}
                onClick={() => enter('device-unlock')}>{t.existingDevice}</button>}
              {attempt ? <a className="mobile-text-action" href={contributionLink('receipt', attempt.digest, returning?.first)}
                target="_blank" rel="noreferrer">{t.pendingLink}</a> :
                <button type="button" className="mobile-text-action" disabled={busy} onClick={() => go('write')}>{t.edit}</button>}
            </>}
            {step === 'done' && <>
              <p>{initialStatement ? lang === 'es' ? 'Firmaste el registro de la charla. Ahora puedes invitar a Yerko.' :
                'You signed the talk record. You can now invite Yerko.' : t.inviteNext}</p>
              <button type="button" className="mobile-action" onClick={() => go('chain')}>
                {initialStatement ? lang === 'es' ? 'Invitar a Yerko a firmar' : 'Invite Yerko to sign' : t.inviteTitle}
              </button>
              <Link className="mobile-secondary" href={contributionLink('receipt', registered, returning?.first)}>{t.receipt}</Link>
            </>}
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
          {problem && <p className="mobile-message" role="alert">{messages[problem] ?? t.failed}</p>}
        </section>
      </div>
      <AppFooter lang={lang} />
    </main>
  );
}
