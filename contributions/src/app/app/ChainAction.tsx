'use client';

import Link from 'next/link';
import ShareActions from './ShareActions';
import { invitationPath, readInvitations, rememberInvitation } from './saved-invitations';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Buffer } from 'buffer';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { assignmentMessage } from '@/lib/contributions/contribution-assignment';
import { DEFAULT_NETWORK, type ContributionNetwork } from '@/lib/contributions/network';
import type { Signer } from '@/lib/contributions/keys';
import type { Lang } from '@/lib/i18n';
import MainnetNotice, { mainnetBlocked, MainnetFailure, testnetAccountMissing } from './MainnetNotice';
import { readComposerDraft, saveComposerDraft } from './composer-draft';
import { getMobileSigner, readMobileIdentity } from './mobile-identity';
import { SigningButton } from './MobileFlowControls';
import VoiceDraftControl from './VoiceDraftControl';
import { mergeVoiceText, voiceSuggestion } from './voice-recorder';
import { yerkoDelivered } from './evento/yerko/event';
import { focusEvent, isFocusRegistration } from '@/lib/contributions/focus-event';
import { yerkoSlides, yerkoSlidesReference, yerkoSlidesSha256 } from '@/lib/contributions/yerko-event';
import { anchorAttempt, canUseMainnet, contributionLink, FlowError, getDisplayName, makeLinkedReceipt, prepareRequest, readChainHead, readProfilePage, readReceipt, verifyPrepared, withContributionNetwork, type Attempt, type DirectoryProfile } from './client';

const copies = {
  es: {
    loading: 'Comprobando la cadena…', retry: 'Reintentar', unavailable: 'No pudimos comprobar el estado. Intenta de nuevo.',
    lookup: 'Comprobar cuenta', profileMissing: 'Esta cuenta no tiene un nombre visible. Comprueba que copiaste la cuenta correcta.',
    changeAccount: 'Cambiar cuenta', deliverer: 'Cuenta de quien entrega (G…)', assign: 'Firmar autorización de entrega',
    confirmAccount: 'Confirma la cuenta', accountEnding: (ending: string) => `Cuenta terminada en ${ending}`,
    inviteReady: 'Invitación lista para', nextReviewerNamed: 'Envíale la entrega para que la revise:', approvalDone: 'Aporte aceptado',
    invite: 'Invitar a entregar', inviteMessage: 'Te invito a firmar tu entrega en Vespi Contributions.',
    returnAction: 'Registrar el apoyo de vuelta', mutualSummary: 'Ver ambos aportes',
    deliveryReady: 'Tu entrega está firmada', nextReviewer: 'Ahora le toca a quien pidió el aporte. Envíale esta entrega para que la revise.',
    sendReview: 'Enviar para revisión', reviewMessage: 'Ya firmé mi entrega en Vespi Contributions. Revísala cuando puedas.',
    browse: 'Buscar por nombre', more: 'Cargar más nombres', search: 'Nombre o cuenta G', directoryEmpty: 'No hay coincidencias entre los nombres cargados.',
    ineligible: 'Esta cuenta no puede firmar este paso. Pide al solicitante un enlace para tu cuenta o entra con la cuenta que corresponda.',
    pendingAuthorization: (name: string) => 'Falta la autorización de ' + name,
    shareAccount: (name: string) => 'Compartir mi cuenta con ' + name,
    accountMessage: (ending: string) => `Esta es mi cuenta de Vespi, terminada en ${ending}. Autorízala para que pueda firmar el aporte y envíame la invitación por aquí.`,
    accountNext: 'Comparte tu cuenta por el mismo canal. Luego abre la invitación firmada que recibas.',
    auth: 'No pudimos abrir tu cuenta. Puedes volver a intentar.',
    differentAccount: 'Desbloqueaste otra cuenta. Usa la cuenta con la que vas a firmar el recibo.',
    wrongAccount: 'Abriste la invitación con otra cuenta',
    wrongAccountInfo: 'Vuelve a abrir el enlace original con la cuenta que compartiste o pide una invitación para esta cuenta.',
    home: 'Volver a Inicio',
    write: 'Describe el aporte que entregas', review: 'Continuar', reviewDelivery: 'Revisa tu aporte', reviewAcceptance: 'Revisa tu aceptación', edit: 'Editar', correction: 'Corrige tu entrega. Esta versión también quedará pendiente de aceptación.',
    approve: 'Aceptar y firmar', acceptText: 'Acepto este aporte.',
    signDelivery: 'Firmar entrega', confirm: 'Tu cuenta y el texto firmado quedarán públicos.', busy: 'Comprobando la firma…',
    fresh: 'El intento terminó sin registrarse. Puedes volver a firmar.', pending: 'Aún no pudimos confirmar la firma.',
    receipt: 'Abrir recibo', current: 'Ver el paso confirmado más reciente',
    delivered: 'Entregado · pendiente de aceptación', accepted: 'Aceptado por quien lo pidió', otherVersion: 'Se aceptó otra versión de este aporte.', exactVersion: 'Ver la versión aceptada',
  },
  en: {
    loading: 'Checking the chain…', retry: 'Try again', unavailable: 'We could not check the status. Try again.',
    lookup: 'Check account', profileMissing: 'This account has no display name. Check that you copied the right account.',
    changeAccount: 'Change account', deliverer: 'Account of the person delivering (G…)', assign: 'Sign delivery authorization',
    confirmAccount: 'Confirm the account', accountEnding: (ending: string) => `Account ending in ${ending}`,
    inviteReady: 'Invitation ready for', nextReviewerNamed: 'Send the delivery to the requester:', approvalDone: 'Contribution accepted',
    invite: 'Send delivery invitation', inviteMessage: 'I’m inviting you to sign your delivery in Vespi Contributions.',
    returnAction: 'Record the return contribution', mutualSummary: 'View both contributions',
    deliveryReady: 'Your delivery is signed', nextReviewer: 'The requester reviews next. Send them this delivery so they can read it.',
    sendReview: 'Send for review', reviewMessage: 'I’ve signed my delivery in Vespi Contributions. Please review it when you can.',
    browse: 'Find by name', more: 'Load more names', search: 'Name or G account', directoryEmpty: 'No matches among the names loaded.',
    ineligible: 'This account cannot sign this step. Ask the requester for a link for your account or sign in with the right account.',
    pendingAuthorization: (name: string) => 'Waiting for authorization from ' + name,
    shareAccount: (name: string) => 'Share my account with ' + name,
    accountMessage: (ending: string) => `This is my Vespi account, ending in ${ending}. Please authorize it so I can sign the contribution and send me the invitation here.`,
    accountNext: 'Share your account in the same conversation. Then open the signed invitation you receive.',
    auth: 'We could not open your account. Try again.',
    differentAccount: 'You unlocked a different account. Use the account that will sign the receipt.',
    wrongAccount: 'You opened the invitation with a different account',
    wrongAccountInfo: 'Reopen the original link with the account you shared or ask for an invitation for this account.',
    home: 'Back to Home',
    write: 'Describe the contribution you delivered', review: 'Continue', reviewDelivery: 'Review your contribution', reviewAcceptance: 'Review your acceptance', edit: 'Edit', correction: 'Revise your delivery. This version will also await acceptance.',
    approve: 'Accept and sign', acceptText: 'I accept this contribution.',
    signDelivery: 'Sign delivery', confirm: 'Your account and signed text will become public.', busy: 'Checking the signature…',
    fresh: 'The attempt was not registered. You can sign again.', pending: 'We could not confirm the signature yet.',
    receipt: 'Open receipt', current: 'View the latest confirmed step',
    delivered: 'Delivered · awaiting acceptance', accepted: 'Accepted by the requester', otherVersion: 'A different version of this contribution was accepted.', exactVersion: 'View the accepted version',
  },
};

export async function loadChain(target: string, signal: AbortSignal, network = DEFAULT_NETWORK, verified?: Awaited<ReturnType<typeof readReceipt>>) {
  const read = (digest: string) => readReceipt(digest, signal, undefined, network);
  const entry = verified ?? await read(target);
  const request = entry.receipt.kind === 'REQUEST' ? entry : await read(entry.receipt.chain);
  if (request.receipt.kind !== 'REQUEST') throw new FlowError('receipt-mismatch');
  const headDigest = await readChainHead(request.index.digest, signal, network);
  const head = headDigest === target ? entry : headDigest === request.index.digest ? request : await read(headDigest);
  if ((head.receipt.kind === 'REQUEST' ? headDigest : head.receipt.chain) !== request.index.digest ||
    (head.receipt.kind === 'ACCEPT' && head.receipt.actor !== request.receipt.actor)) throw new FlowError('receipt-mismatch');
  let acceptedDelivery: Awaited<ReturnType<typeof readReceipt>> | undefined;
  if (head.receipt.kind === 'ACCEPT') {
    const { subject, prev } = head.receipt;
    if (!subject || !prev) throw new FlowError('receipt-mismatch');
    acceptedDelivery = subject === target ? entry : await read(subject);
    const prior = prev === subject ? acceptedDelivery : prev === target ? entry : await read(prev);
    if (acceptedDelivery.receipt.kind !== 'CONTRIBUTE' || acceptedDelivery.receipt.chain !== request.index.digest ||
      prior.receipt.kind !== 'CONTRIBUTE' || prior.receipt.chain !== request.index.digest ||
      acceptedDelivery.receipt.actor !== prior.receipt.actor) throw new FlowError('receipt-mismatch');
  }
  return { entry, request, head, acceptedDelivery };
}

const freshReasons = ['retry-with-fresh-transaction', 'invalid-timebound', 'inner-failed'];

export default function ChainAction({ lang, target, account, prompt, getSigner, getVoiceSigner, proof, heading, mutual, suggestedAccount, onReturn, yerko, network }: {
  lang: Lang;
  target: string;
  account: string;
  prompt: boolean;
  getSigner(): Promise<Signer>;
  getVoiceSigner(): Promise<Signer>;
  proof: string;
  heading: RefObject<HTMLHeadingElement | null>;
  mutual?: string;
  suggestedAccount?: string;
  yerko?: { account: string };
  onReturn?: (first: string, counterparty: string) => void;
  network: ContributionNetwork;
}) {
  const t = copies[lang];
  const [chain, setChain] = useState<Awaited<ReturnType<typeof loadChain>>>();
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invitationEligibility, setInvitationEligibility] = useState<{ account: string; allowed: boolean | 'unavailable' }>();
  const [contributor, setContributor] = useState(suggestedAccount ?? '');
  const [recipient, setRecipient] = useState<{ account: string; name: string }>();
  const [link, setLink] = useState('');
  const [requesterName, setRequesterName] = useState<string>();
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState('');
  const [restored, setRestored] = useState(false);
  const [text, setText] = useState('');
  const [voiceSuggested, setVoiceSuggested] = useState(false);
  const [draft, setDraft] = useState<ReturnType<typeof makeLinkedReceipt>>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [done, setDone] = useState<{ digest: string; kind: 'CONTRIBUTE' | 'ACCEPT' }>();
  const stateHeading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const mainnet = network === 'mainnet';
  const storageKey = 'vespi-contributions:chain-attempt:' + account + ':' + target + (mainnet ? ':mainnet' : '');
  const owner = chain?.request.receipt.actor;
  const draftFlow = 'chain:' + target;
  const passkey = prompt && (network === 'mainnet' || !getMobileSigner(account));
  const correction = owner !== account && chain?.entry.receipt.kind === 'CONTRIBUTE' &&
    chain.entry.receipt.actor === account;
  const mayDeliver = (!yerko || account === yerko.account) && (correction || Boolean(owner && owner !== account && chain?.entry.receipt.kind === 'REQUEST' &&
    /^[a-f0-9]{128}$/.test(proof) && Keypair.fromPublicKey(owner).verify(
      Buffer.from(assignmentMessage(target, account, network)), Buffer.from(proof, 'hex'))));
  const mayAccept = Boolean(owner === account && chain?.entry.receipt.kind === 'CONTRIBUTE');
  const mayAssign = owner === account && chain?.entry.receipt.kind === 'REQUEST';
  const signingStep = draft?.kind;
  const doneKind = done?.kind;
  const checkedAccount = recipient?.account;
  const hasProof = Boolean(proof);
  const checkInvitation = mainnet;
  const invitationAllowed = invitationEligibility?.account === account ? invitationEligibility.allowed : undefined;

  useEffect(() => {
    if (!checkInvitation) return;
    let current = true;
    void canUseMainnet(account).then(allowed => {
      if (current) setInvitationEligibility({ account, allowed });
    }).catch(() => {
      if (current) setInvitationEligibility({ account, allowed: 'unavailable' });
    });
    return () => { current = false; };
  }, [checkInvitation, account, reload]);

  useEffect(() => {
    if (chain) (stateHeading.current ?? heading.current)?.focus();
  }, [chain, mayDeliver, hasProof, signingStep, doneKind, link, heading]);

  useEffect(() => {
    if (checkedAccount) {
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationHeading.current?.scrollIntoView({ block: 'center' });
    }
  }, [checkedAccount]);

  useEffect(() => {
    const controller = new AbortController();
    loadChain(target, controller.signal, network).then(value => {
      if (controller.signal.aborted) return;
      setChain(value);
      if (mutual && !suggestedAccount && value.entry.receipt.kind === 'REQUEST' && value.request.receipt.actor === account) {
        void loadChain(mutual, controller.signal, network).then(first => {
          const delivery = first.acceptedDelivery ?? (first.head.receipt.kind === 'CONTRIBUTE' ? first.head : undefined);
          if (!controller.signal.aborted && first.request.index.digest === mutual && delivery?.receipt.actor === account &&
            first.request.receipt.actor !== account) {
            const counterpart = first.request.receipt.actor;
            setContributor(current => current || counterpart);
          }
        }).catch(() => {});
      }
      const requester = value.request.receipt.actor;
      setRequesterName(requester.slice(0, 6) + '…' + requester.slice(-6));
      void getDisplayName(requester).then(name => {
        if (name && !controller.signal.aborted) setRequesterName(name);
      }).catch(() => {});
      const composer = readComposerDraft(account, network, draftFlow);
      if (value.request.receipt.actor === account && !composer?.counterparty) {
        const invitation = readInvitations(account, network).find(item => item.root === target && !item.incoming);
        if (invitation && Keypair.fromPublicKey(account).verify(Buffer.from(assignmentMessage(target, invitation.recipient, network)),
          Buffer.from(invitation.proof, 'hex'))) {
          setContributor(invitation.recipient);
          setRecipient({ account: invitation.recipient, name: invitation.name });
          setLink(location.origin + invitationPath(invitation, network));
        }
      }
      if (composer) {
        if (composer.counterparty && value.request.receipt.actor === account) setContributor(composer.counterparty);
        setText(composer.statement);
        setVoiceSuggested(composer.voiceSuggested === true);
        if (composer.review && composer.statement.trim() &&
          (value.entry.receipt.kind === 'REQUEST' && value.request.receipt.actor !== account ||
            value.entry.receipt.kind === 'CONTRIBUTE' && value.entry.receipt.actor === account)) {
          setDraft(makeLinkedReceipt('CONTRIBUTE', account, value.request.index.digest, target, composer.statement.trim().normalize('NFC')));
        }
      }
      setRestored(true);
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        if (!saved || (saved.attempt.network ?? DEFAULT_NETWORK) !== network ||
          saved.draft.actor !== account || saved.draft.prev !== target) return;
        if (saved.attempt.digest === value.head.index.digest) {
          localStorage.removeItem(storageKey);
          if (saved.draft.kind === 'CONTRIBUTE' || saved.draft.kind === 'ACCEPT') setDone({ digest: saved.attempt.digest, kind: saved.draft.kind });
        } else {
          setDraft(saved.draft);
          setText(saved.draft.statement);
          setAttempt(saved.attempt);
        }
      } catch {}
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof FlowError && mainnetBlocked(cause.message) ? cause.message : 'unavailable');
    });
    return () => controller.abort();
  }, [target, storageKey, reload, account, mutual, suggestedAccount, network, draftFlow]);

  useEffect(() => {
    if (!restored || attempt || done || link || readMobileIdentity()?.account !== account) return;
    if (mayAssign && contributor) saveComposerDraft(account, network, draftFlow, { statement: '', counterparty: contributor });
    if (mayDeliver && text) saveComposerDraft(account, network, draftFlow, { statement: text, review: !!signingStep, voiceSuggested });
    if ((mayAssign && !contributor) || (mayDeliver && !text && !mayAssign)) saveComposerDraft(account, network, draftFlow);
  }, [account, network, draftFlow, restored, mayAssign, mayDeliver, text, contributor, signingStep, voiceSuggested, attempt, done, link]);

  useEffect(() => {
    if (owner && owner !== account && mayDeliver && !correction) {
      rememberInvitation(account, { root: target, recipient: account, name: requesterName ?? owner, proof, mutual, incoming: true }, network);
    }
  }, [owner, account, mayDeliver, correction, target, requesterName, proof, mutual, network]);

  async function browse(next = '0') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const page = await readProfilePage(next);
      setCursor(page.cursor);
      setProfiles(previous => [...new Map([...previous, ...page.entries]
        .filter(profile => profile.account !== account)
        .map(profile => [profile.account, profile])).values()]);
    } catch { setError('unavailable'); }
    finally { setBusy(false); }
  }

  async function checkRecipient(account: string, displayName?: string) {
    setBusy(true);
    setError('');
    setRecipient(undefined);
    try {
      if (mainnet && !await canUseMainnet(account)) {
        setError('account-not-allowed');
        return;
      }
      const name = displayName ?? await getDisplayName(account).catch(cause => {
        if (!mainnet) throw cause;
        return null;
      });
      if (name === null && !mainnet) { setError('profile-missing'); return; }
      setRecipient({ account, name: name ?? account.slice(0, 6) + '…' + account.slice(-6) });
    } catch { setError('unavailable'); }
    finally { setBusy(false); }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipientAccount = contributor.trim().toUpperCase();
    if (!mayAssign || busy || !StrKey.isValidEd25519PublicKey(recipientAccount) || recipientAccount === account) return;
    if (recipient?.account !== recipientAccount) return checkRecipient(recipientAccount);
    setBusy(true);
    setError('');
    try {
      const signer = await getSigner();
      const signature = Buffer.from(await signer.sign(assignmentMessage(target, recipientAccount, network))).toString('hex');
      if (!getMobileSigner(account)) return;
      saveComposerDraft(account, network, draftFlow);
      const invitation = { root: target, recipient: recipientAccount, name: recipient.name, proof: signature, mutual };
      rememberInvitation(account, invitation, network);
      setLink(location.origin + invitationPath(invitation, network));
    } catch (cause) { setError(cause instanceof FlowError ? cause.message : 'unavailable'); }
    finally { setBusy(false); }
  }

  async function publish(kind: 'CONTRIBUTE' | 'ACCEPT') {
    if (busy || !chain || (kind === 'CONTRIBUTE' ? !mayDeliver : !mayAccept)) return;
    const receipt = draft ?? makeLinkedReceipt(kind, account, chain.request.index.digest,
      target, kind === 'ACCEPT' ? t.acceptText : yerko ? yerkoDelivered[lang] : text.trim().normalize('NFC'),
      kind === 'CONTRIBUTE' && yerko ? yerkoSlidesReference : null);
    if (!receipt.statement || receipt.kind !== kind || receipt.chain !== chain.request.index.digest) return;
    setDraft(receipt);
    setBusy(true);
    setError('');
    let signed = attempt;
    try {
      if (signed) await verifyPrepared(signed.bytes, signed.digest, receipt);
      else {
        const signer = await getSigner();
        signed = await prepareRequest(receipt, signer, undefined, network);
        if (!getMobileSigner(account)) return;
        saveComposerDraft(account, network, draftFlow);
        setAttempt(signed);
        try { localStorage.setItem(storageKey, JSON.stringify({ draft: receipt, attempt: signed })); } catch {}
      }
      const index = await anchorAttempt(signed, kind === 'CONTRIBUTE' && !correction ? proof : undefined);
      try { localStorage.removeItem(storageKey); } catch {}
      setDone({ digest: index.digest, kind });
    } catch (error) {
      const reason = error instanceof FlowError ? error.message : '';
      if (freshReasons.includes(reason)) {
        setAttempt(undefined);
        try { localStorage.removeItem(storageKey); } catch {}
        setError('fresh');
      } else if (reason === 'chain-conflict') {
        setReload(reload + 1);
        setError('pending');
      } else setError(mainnetBlocked(reason) || ['auth', 'different-account', 'embedded', 'device-required', 'testnet-account-missing'].includes(reason)
        ? reason : signed ? 'pending' : 'unavailable');
    } finally {
      setBusy(false);
    }
  }

  const signingError = error === 'different-account' ? t.differentAccount : error === 'testnet-account-missing' ? testnetAccountMissing(lang)
    : ['auth', 'embedded', 'device-required'].includes(error) ? t.auth : undefined;

  if (done?.kind === 'CONTRIBUTE' && yerko) return <>
    <p role="status">{lang === 'es' ? 'Firmaste la charla. Ya se puede registrar la asistencia.' : 'You signed the talk. Attendees can now record their attendance.'}</p>
    <Link className="mobile-action" href={'/app/evento/yerko' + (lang === 'en' ? '?lang=en' : '')}>
      {lang === 'es' ? 'Volver a la charla' : 'Back to the talk'}
    </Link>
  </>;
  if (done?.kind === 'CONTRIBUTE') {
    const url = location.origin + contributionLink('continue', done.digest, mutual, network);
    return <>
      <h2 ref={stateHeading} tabIndex={-1}>{t.deliveryReady}</h2>
      <p>{requesterName ? <>{t.nextReviewerNamed} <strong>{requesterName}</strong>.</> : t.nextReviewer}</p>
      <ShareActions lang={lang} url={url} label={t.sendReview} message={t.reviewMessage} />
      {!mutual && chain && onReturn && <button className="mobile-secondary" type="button"
        onClick={() => onReturn(chain.request.index.digest, chain.request.receipt.actor)}>{t.returnAction}</button>}
      {mutual && chain && <Link className="mobile-secondary"
        href={withContributionNetwork('/app?mutual=' + mutual + '&return=' + chain.request.index.digest, network)}>{t.mutualSummary}</Link>}
      <Link className="mobile-secondary" href={contributionLink('receipt', done.digest, mutual, network)}>{t.receipt}</Link>
    </>;
  }
  if (done) return <>
    <h2 ref={stateHeading} tabIndex={-1}>{t.approvalDone}</h2>
    {mutual && chain && <Link className="mobile-action"
      href={withContributionNetwork('/app?mutual=' + mutual + '&return=' + chain.request.index.digest, network)}>{t.mutualSummary}</Link>}
    <Link className={mutual ? 'mobile-secondary' : 'mobile-action'} href={contributionLink('receipt', done.digest, mutual, network)}>{t.receipt}</Link>
  </>;
  if (!chain) return error ? <>
    {mainnetBlocked(error) ? <MainnetFailure lang={lang} reason={error} showTestnet={!hasProof} /> : <p role="alert">{t.unavailable}</p>}
    <button type="button" className="mobile-action" onClick={() => { setError(''); setReload(reload + 1); }}>{t.retry}</button>
  </> : <p role="status">{t.loading}</p>;
  if (!mainnet && isFocusRegistration(chain.request.receipt.statement, chain.request.index.digest)) {
    return <Link className="mobile-action" href={focusEvent.path + '?lang=' + lang}>{focusEvent.copy[lang].details}</Link>;
  }
  if (checkInvitation && invitationAllowed !== true) return <>
    <blockquote>{chain.entry.receipt.statement}</blockquote>
    {invitationAllowed === undefined ? <p role="status">{t.loading}</p> : <>
      <MainnetFailure lang={lang} reason={invitationAllowed === false ? 'account-not-allowed' : 'mainnet-unavailable'} showTestnet={!hasProof} />
      {invitationAllowed === 'unavailable' && <button type="button" className="mobile-action" onClick={() => {
        setInvitationEligibility(undefined);
        setReload(reload + 1);
      }}>{t.retry}</button>}
    </>}
  </>;
  if (chain.head.index.digest !== target || chain.head.receipt.kind === 'ACCEPT') return <>
    <p>{chain.head.receipt.kind === 'ACCEPT'
      ? (chain.entry.receipt.kind === 'CONTRIBUTE' && chain.acceptedDelivery?.index.digest !== target ? t.otherVersion : t.accepted)
      : t.delivered}</p>
    {chain.acceptedDelivery && chain.acceptedDelivery.index.digest !== target &&
      <Link className="mobile-secondary" href={contributionLink('receipt', chain.acceptedDelivery.index.digest, mutual, network)}>{t.exactVersion}</Link>}
    <Link className="mobile-action" href={contributionLink('receipt', chain.head.index.digest, mutual, network)}>{t.current}</Link>
  </>;

  const validContributor = StrKey.isValidEd25519PublicKey(contributor.trim().toUpperCase()) &&
    contributor.trim().toUpperCase() !== account;
  if (yerko && !mayAssign && !mayAccept) return <>
    {mayDeliver ? <>
      <blockquote>{draft?.statement ?? yerkoDelivered[lang]}</blockquote>
      <a className="mobile-text-action" href={yerkoSlides}>{lang === 'es' ? 'Abrir presentación (PDF)' : 'Open slides (PDF)'}</a>
      <details><summary>{lang === 'es' ? 'Huella del PDF que firmarás' : 'PDF fingerprint you will sign'}</summary>
        <code>{yerkoSlidesSha256}</code>
      </details>
      <SigningButton type="button" lang={lang} prompt={!attempt && passkey} disabled={busy} onClick={() => publish('CONTRIBUTE')}
        label={attempt ? t.retry : lang === 'es' ? 'Firmar como ponente' : 'Sign as speaker'} />
      {busy && <p role="status">{t.busy}</p>}
      {error && <p role="alert">{signingError ?? (error === 'fresh' ? t.fresh : t.pending)}</p>}
    </> : <p>{lang === 'es' ? 'Para firmar como ponente, abre la invitación con la cuenta de Yerko.' : 'To sign as speaker, open the invitation with Yerko’s account.'}</p>}
  </>;
  return <>
    {!mayAccept && (!mayAssign || !recipient) && (!mayDeliver || !draft) && <blockquote>{chain.entry.receipt.statement}</blockquote>}
    {mayAssign ? <form className="mobile-actions" onSubmit={authorize}>
      {link ? <>
        <h2 ref={stateHeading} tabIndex={-1}>{t.inviteReady} {recipient?.name}</h2>
        <ShareActions lang={lang} url={link} label={t.invite} message={t.inviteMessage} />
        <button className="mobile-text-action" type="button" onClick={() => { setLink(''); setRecipient(undefined); }}>{t.changeAccount}</button>
      </> : <>
        {cursor === undefined ? <button className="mobile-secondary" type="button" disabled={busy} onClick={() => browse()}>{t.browse}</button> : <>
          <label htmlFor="directory-search">{t.search}</label>
          <input id="directory-search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
          {profiles.filter(profile => (profile.displayName + ' ' + profile.account).toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())).map(profile => <button className="mobile-secondary" type="button" key={profile.account}
            disabled={busy} onClick={() => {
              setContributor(profile.account);
              void checkRecipient(profile.account, profile.displayName);
            }}>{profile.displayName} · {profile.account.slice(0, 6)}…{profile.account.slice(-6)}</button>)}
          {!profiles.some(profile => (profile.displayName + ' ' + profile.account).toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())) && <p className="mobile-note">{t.directoryEmpty}</p>}
          {cursor !== '0' && <button className="mobile-secondary" type="button" disabled={busy} onClick={() => browse(cursor)}>{t.more}</button>}
        </>}
        <label htmlFor="delivery-account">{t.deliverer}</label>
        <input id="delivery-account" value={contributor} onChange={event => {
          setContributor(event.target.value);
          setRecipient(undefined);
          if (mainnet) setError('');
        }}
          maxLength={56} autoCapitalize="characters" spellCheck={false} disabled={busy} required />
        {recipient && <>
          <h2 ref={confirmationHeading} tabIndex={-1}>{t.confirmAccount}</h2>
          <p><strong>{recipient.name}</strong> · {t.accountEnding(recipient.account.slice(-4))}<br /><code>{recipient.account}</code></p>
          {mainnet && <MainnetNotice previewFirst lang={lang} actor={account} statement={chain.request.receipt.statement}
            comment={chain.request.receipt.comment} assignment />}
        </>}
        <SigningButton lang={lang} label={recipient ? t.assign : t.lookup} prompt={!!recipient && passkey} disabled={busy || !validContributor} />
      </>}
    </form> : mayAccept ? <>
      <h2 ref={stateHeading} className="chain-review" tabIndex={-1}>{t.reviewAcceptance}</h2>
      <blockquote>{chain.entry.receipt.statement}</blockquote>
      {mainnet ? <MainnetNotice previewFirst lang={lang} actor={account} statement={draft?.statement ?? t.acceptText} /> : <>
        <blockquote>{draft?.statement ?? t.acceptText}</blockquote><p>{t.confirm}</p>
      </>}
      <SigningButton type="button" lang={lang} prompt={!attempt && passkey} disabled={busy} onClick={() => publish('ACCEPT')} label={attempt ? t.retry : t.approve} />
    </> : mayDeliver ? draft ? <>
      <h2 ref={stateHeading} className="chain-review" tabIndex={-1}>{t.reviewDelivery}</h2>
      {voiceSuggested && <p className="voice-suggestion">{voiceSuggestion(lang)}</p>}
      {mainnet ? <MainnetNotice previewFirst lang={lang} actor={draft.actor} statement={draft.statement} comment={draft.comment} /> : <>
        <blockquote>{draft.statement}</blockquote><p>{t.confirm}</p>
      </>}
      <SigningButton type="button" lang={lang} prompt={!attempt && passkey} disabled={busy} onClick={() => publish('CONTRIBUTE')} label={attempt ? t.retry : t.signDelivery} />
      {!attempt && <button type="button" className="mobile-text-action mobile-review-edit" disabled={busy} onClick={() => setDraft(undefined)}>{t.edit}</button>}
    </> : <form className="mobile-actions mobile-composer" onSubmit={event => {
      event.preventDefault();
      if (text.trim()) setDraft(makeLinkedReceipt('CONTRIBUTE', account, chain.request.index.digest, target, text.trim().normalize('NFC')));
    }}>
      {correction && <p className="mobile-note">{t.correction}</p>}
      <label htmlFor="delivery-text">{t.write}</label>
      <div className="mobile-composer-field">
      <textarea id="delivery-text" rows={4} maxLength={1000} value={text}
        placeholder={lang === 'es' ? 'Escribe aquí…' : 'Write here…'}
        onChange={event => { setText(event.target.value); setVoiceSuggested(false); }}
        aria-describedby={voiceSuggested ? 'delivery-voice-suggestion' : undefined} required />
      <VoiceDraftControl composer lang={lang} account={account} network={network} kind="delivery"
        getSigner={getVoiceSigner} needsPasskey={() => prompt && !getMobileSigner(account)} hasWritten={() => Boolean(text.trim())} onDraft={(draft, choice) => {
          const merged = mergeVoiceText(text, draft.statement, choice, 1000);
          if (merged !== text) { setText(merged); setVoiceSuggested(true); }
        }} />
      </div>
      {voiceSuggested && <p id="delivery-voice-suggestion" className="voice-suggestion">{voiceSuggestion(lang)}</p>}
      <button className="mobile-action" disabled={!text.trim()}>{t.review}</button>
    </form> : chain.entry.receipt.kind === 'REQUEST' ? hasProof ? <>
      <h2 ref={stateHeading} tabIndex={-1}>{t.wrongAccount}</h2>
      <p>{t.wrongAccountInfo}</p>
      <Link className="mobile-secondary" href="/app">{t.home}</Link>
    </> : <>
      <h2 ref={stateHeading} tabIndex={-1}>{t.pendingAuthorization(requesterName ?? chain.request.receipt.actor)}</h2>
      <p>{t.accountNext}</p>
      <ShareActions lang={lang} account={account} label={t.shareAccount(requesterName ?? chain.request.receipt.actor)}
        message={t.accountMessage(account.slice(-4))} />
      <Link className="mobile-text-action" href="/app">{t.home}</Link>
    </> : <p>{t.ineligible}</p>}
    {busy && <p role="status">{t.busy}</p>}
    {error && (mainnetBlocked(error) ? <MainnetFailure lang={lang} reason={error} showTestnet={!hasProof && !(mayAssign && error === 'account-not-allowed')} /> :
      <p role="alert" className="mobile-message">{signingError ?? (error === 'fresh' ? t.fresh : error === 'pending' ? t.pending : error === 'profile-missing' ? t.profileMissing : t.unavailable)}</p>)}
  </>;
}
