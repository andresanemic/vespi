'use client';

import Link from 'next/link';
import ShareActions from './ShareActions';
import { invitationPath, rememberInvitation } from './saved-invitations';
import { useEffect, useState, type FormEvent } from 'react';
import { Buffer } from 'buffer';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { assignmentMessage } from '@/lib/contributions/contribution-assignment';
import type { Signer } from '@/lib/contributions/keys';
import type { Lang } from '@/lib/i18n';
import { yerkoDelivered } from './evento/yerko/event';
import { yerkoSlides, yerkoSlidesReference, yerkoSlidesSha256 } from '@/lib/contributions/yerko-event';
import { anchorAttempt, contributionLink, FlowError, getDisplayName, makeLinkedReceipt, prepareRequest, readChainHead, readProfilePage, readReceipt, verifyPrepared, type Attempt, type DirectoryProfile } from './client';

const copies = {
  es: {
    loading: 'Comprobando la cadena…', retry: 'Reintentar', unavailable: 'No pudimos comprobar el estado. Intenta de nuevo.',
    lookup: 'Comprobar cuenta', profileMissing: 'Esta cuenta no tiene un nombre visible. Comprueba que copiaste la cuenta correcta.',
    deliverer: 'Cuenta de quien entrega (G…)', assign: 'Firmar autorización de entrega',
    assignmentInfo: 'Pídele a quien entrega que abra Mi perfil y te comparta su cuenta. Luego envíale el enlace para que firme su aporte.',
    inviteReady: 'Invitación lista para', nextReviewerNamed: 'Envíale la entrega para que la revise:', approvalDone: 'Aporte aceptado',
    invite: 'Invitar a entregar', inviteMessage: 'Te invito a firmar tu entrega en Vespi Contributions.',
    returnAction: 'Registrar el apoyo de vuelta', mutualSummary: 'Ver ambos aportes',
    deliveryReady: 'Tu entrega está firmada', nextReviewer: 'Ahora le toca a quien pidió el aporte. Envíale esta entrega para que la revise.',
    sendReview: 'Enviar para revisión', reviewMessage: 'Ya firmé mi entrega en Vespi Contributions. Revísala cuando puedas.',
    browse: 'Buscar por nombre', more: 'Cargar más nombres', search: 'Nombre o cuenta G', directoryEmpty: 'No hay coincidencias entre los nombres cargados.',
    ineligible: 'Esta cuenta no puede firmar este paso. Pide al solicitante un enlace para tu cuenta o entra con la cuenta que corresponda.',
    write: 'Describe el aporte que entregas', review: 'Revisar entrega', edit: 'Editar entrega', correction: 'Corrige tu entrega. Esta versión también quedará pendiente de aceptación.',
    approve: 'Aceptar y firmar', acceptText: 'Acepto este aporte.',
    acceptReview: 'Revisa el aporte antes de decidir. Puedes dejarlo pendiente sin firmar.',
    signDelivery: 'Firmar entrega', confirm: 'Tu cuenta y el texto firmado quedarán públicos.', busy: 'Comprobando la firma…',
    fresh: 'El intento terminó sin registrarse. Puedes volver a firmar.', pending: 'Aún no pudimos confirmar la firma.',
    receipt: 'Abrir recibo', current: 'Ver el paso confirmado más reciente',
    delivered: 'Entregado · pendiente de aceptación', accepted: 'Aceptado por quien lo pidió', otherVersion: 'Se aceptó otra versión de este aporte.', exactVersion: 'Ver la versión aceptada',
  },
  en: {
    loading: 'Checking the chain…', retry: 'Try again', unavailable: 'We could not check the status. Try again.',
    lookup: 'Check account', profileMissing: 'This account has no display name. Check that you copied the right account.',
    deliverer: 'Account of the person delivering (G…)', assign: 'Sign delivery authorization',
    assignmentInfo: 'Ask the person delivering to open My profile and share their account. Then send them the link so they can sign their contribution.',
    inviteReady: 'Invitation ready for', nextReviewerNamed: 'Send the delivery to the requester:', approvalDone: 'Contribution accepted',
    invite: 'Send delivery invitation', inviteMessage: 'I’m inviting you to sign your delivery in Vespi Contributions.',
    returnAction: 'Record the return contribution', mutualSummary: 'View both contributions',
    deliveryReady: 'Your delivery is signed', nextReviewer: 'The requester reviews next. Send them this delivery so they can read it.',
    sendReview: 'Send for review', reviewMessage: 'I’ve signed my delivery in Vespi Contributions. Please review it when you can.',
    browse: 'Find by name', more: 'Load more names', search: 'Name or G account', directoryEmpty: 'No matches among the names loaded.',
    ineligible: 'This account cannot sign this step. Ask the requester for a link for your account or sign in with the right account.',
    write: 'Describe the contribution you delivered', review: 'Review delivery', edit: 'Edit delivery', correction: 'Revise your delivery. This version will also await acceptance.',
    approve: 'Accept and sign', acceptText: 'I accept this contribution.',
    acceptReview: 'Read the contribution before deciding. You can leave it pending without signing.',
    signDelivery: 'Sign delivery', confirm: 'Your account and signed text will become public.', busy: 'Checking the signature…',
    fresh: 'The attempt was not registered. You can sign again.', pending: 'We could not confirm the signature yet.',
    receipt: 'Open receipt', current: 'View the latest confirmed step',
    delivered: 'Delivered · awaiting acceptance', accepted: 'Accepted by the requester', otherVersion: 'A different version of this contribution was accepted.', exactVersion: 'View the accepted version',
  },
};

export async function loadChain(target: string, signal: AbortSignal, verified?: Awaited<ReturnType<typeof readReceipt>>) {
  const entry = verified ?? await readReceipt(target, signal);
  const request = entry.receipt.kind === 'REQUEST' ? entry : await readReceipt(entry.receipt.chain, signal);
  if (request.receipt.kind !== 'REQUEST') throw new FlowError('receipt-mismatch');
  const headDigest = await readChainHead(request.index.digest, signal);
  const head = headDigest === target ? entry : headDigest === request.index.digest ? request : await readReceipt(headDigest, signal);
  if ((head.receipt.kind === 'REQUEST' ? headDigest : head.receipt.chain) !== request.index.digest ||
    (head.receipt.kind === 'ACCEPT' && head.receipt.actor !== request.receipt.actor)) throw new FlowError('receipt-mismatch');
  let acceptedDelivery: Awaited<ReturnType<typeof readReceipt>> | undefined;
  if (head.receipt.kind === 'ACCEPT') {
    const { subject, prev } = head.receipt;
    if (!subject || !prev) throw new FlowError('receipt-mismatch');
    acceptedDelivery = subject === target ? entry : await readReceipt(subject, signal);
    const prior = prev === subject ? acceptedDelivery : prev === target ? entry : await readReceipt(prev, signal);
    if (acceptedDelivery.receipt.kind !== 'CONTRIBUTE' || acceptedDelivery.receipt.chain !== request.index.digest ||
      prior.receipt.kind !== 'CONTRIBUTE' || prior.receipt.chain !== request.index.digest ||
      acceptedDelivery.receipt.actor !== prior.receipt.actor) throw new FlowError('receipt-mismatch');
  }
  return { entry, request, head, acceptedDelivery };
}

const freshReasons = ['retry-with-fresh-transaction', 'invalid-timebound', 'inner-failed'];

export default function ChainAction({ lang, target, signer, mutual, suggestedAccount, onReturn, yerko }: {
  lang: Lang;
  target: string;
  signer: Signer;
  mutual?: string;
  suggestedAccount?: string;
  yerko?: { account: string };
  onReturn?: (first: string, counterparty: string) => void;
}) {
  const t = copies[lang];
  const [chain, setChain] = useState<Awaited<ReturnType<typeof loadChain>>>();
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contributor, setContributor] = useState(suggestedAccount ?? '');
  const [recipient, setRecipient] = useState<{ account: string; name: string }>();
  const [link, setLink] = useState('');
  const [requesterName, setRequesterName] = useState<string>();
  const [profiles, setProfiles] = useState<DirectoryProfile[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<ReturnType<typeof makeLinkedReceipt>>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [done, setDone] = useState<{ digest: string; kind: 'CONTRIBUTE' | 'ACCEPT' }>();
  const proof = typeof location === 'undefined' ? '' : new URLSearchParams(location.hash.slice(1)).get('assignment') ?? '';
  const storageKey = 'vespi-contributions:chain-attempt:' + signer.publicKey + ':' + target;
  const owner = chain?.request.receipt.actor;
  const correction = owner !== signer.publicKey && chain?.entry.receipt.kind === 'CONTRIBUTE' &&
    chain.entry.receipt.actor === signer.publicKey;
  const mayDeliver = (!yerko || signer.publicKey === yerko.account) && (correction || Boolean(owner && owner !== signer.publicKey && chain?.entry.receipt.kind === 'REQUEST' &&
    /^[a-f0-9]{128}$/.test(proof) && Keypair.fromPublicKey(owner).verify(
      Buffer.from(assignmentMessage(target, signer.publicKey)), Buffer.from(proof, 'hex'))));
  const mayAccept = Boolean(owner === signer.publicKey && chain?.entry.receipt.kind === 'CONTRIBUTE');
  const mayAssign = owner === signer.publicKey && chain?.entry.receipt.kind === 'REQUEST';

  useEffect(() => {
    const controller = new AbortController();
    loadChain(target, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setChain(value);
      if (mutual && !suggestedAccount && value.entry.receipt.kind === 'REQUEST' && value.request.receipt.actor === signer.publicKey) {
        void loadChain(mutual, controller.signal).then(first => {
          const delivery = first.acceptedDelivery ?? (first.head.receipt.kind === 'CONTRIBUTE' ? first.head : undefined);
          if (!controller.signal.aborted && first.request.index.digest === mutual && delivery?.receipt.actor === signer.publicKey &&
            first.request.receipt.actor !== signer.publicKey) {
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
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        if (!saved || saved.draft.actor !== signer.publicKey || saved.draft.prev !== target) return;
        if (saved.attempt.digest === value.head.index.digest) {
          localStorage.removeItem(storageKey);
          if (saved.draft.kind === 'CONTRIBUTE' || saved.draft.kind === 'ACCEPT') setDone({ digest: saved.attempt.digest, kind: saved.draft.kind });
        } else {
          setDraft(saved.draft);
          setText(saved.draft.statement);
          setAttempt(saved.attempt);
        }
      } catch {}
    }).catch(() => { if (!controller.signal.aborted) setError('unavailable'); });
    return () => controller.abort();
  }, [target, storageKey, reload, signer.publicKey, mutual, suggestedAccount]);

  useEffect(() => {
    if (owner && owner !== signer.publicKey && mayDeliver && !correction) {
      rememberInvitation(signer.publicKey, { root: target, recipient: signer.publicKey, name: requesterName ?? owner, proof, mutual, incoming: true });
    }
  }, [owner, signer.publicKey, mayDeliver, correction, target, requesterName, proof, mutual]);

  async function browse(next = '0') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const page = await readProfilePage(next);
      setCursor(page.cursor);
      setProfiles(previous => [...new Map([...previous, ...page.entries]
        .filter(profile => profile.account !== signer.publicKey)
        .map(profile => [profile.account, profile])).values()]);
    } catch { setError('unavailable'); }
    finally { setBusy(false); }
  }

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = contributor.trim().toUpperCase();
    if (!mayAssign || busy || !StrKey.isValidEd25519PublicKey(account) || account === signer.publicKey) return;
    setBusy(true);
    setError('');
    try {
      if (recipient?.account !== account) {
        const name = await getDisplayName(account);
        if (name === null) { setError('profile-missing'); return; }
        setRecipient({ account, name });
        return;
      }
      const signature = Buffer.from(await signer.sign(assignmentMessage(target, account))).toString('hex');
      const invitation = { root: target, recipient: account, name: recipient.name, proof: signature, mutual };
      rememberInvitation(signer.publicKey, invitation);
      setLink(location.origin + invitationPath(invitation));

    } catch { setError('unavailable'); }
    finally { setBusy(false); }
  }

  async function publish(kind: 'CONTRIBUTE' | 'ACCEPT') {
    if (busy || !chain || (kind === 'CONTRIBUTE' ? !mayDeliver : !mayAccept)) return;
    const receipt = draft ?? makeLinkedReceipt(kind, signer.publicKey, chain.request.index.digest,
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
        signed = await prepareRequest(receipt, signer);
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
      } else setError('pending');
    } finally {
      setBusy(false);
    }
  }

  if (done?.kind === 'CONTRIBUTE' && yerko) return <>
    <p role="status">{lang === 'es' ? 'Firmaste la charla. Ya se puede registrar la asistencia.' : 'You signed the talk. Attendees can now record their attendance.'}</p>
    <Link className="mobile-action" href={'/app/evento/yerko' + (lang === 'en' ? '?lang=en' : '')}>
      {lang === 'es' ? 'Volver a la charla' : 'Back to the talk'}
    </Link>
  </>;
  if (done?.kind === 'CONTRIBUTE') {
    const url = location.origin + contributionLink('continue', done.digest, mutual);
    return <>
      <h2 role="status">{t.deliveryReady}</h2>
      <p>{requesterName ? <>{t.nextReviewerNamed} <strong>{requesterName}</strong>.</> : t.nextReviewer}</p>
      <ShareActions lang={lang} url={url} label={t.sendReview} message={t.reviewMessage} />
      {!mutual && chain && onReturn && <button className="mobile-secondary" type="button"
        onClick={() => onReturn(chain.request.index.digest, chain.request.receipt.actor)}>{t.returnAction}</button>}
      {mutual && chain && <Link className="mobile-secondary"
        href={'/app?mutual=' + mutual + '&return=' + chain.request.index.digest}>{t.mutualSummary}</Link>}
      <Link className="mobile-secondary" href={contributionLink('receipt', done.digest, mutual)}>{t.receipt}</Link>
    </>;
  }
  if (done) return <>
    <h2 role="status">{t.approvalDone}</h2>
    {mutual && chain && <Link className="mobile-action"
      href={'/app?mutual=' + mutual + '&return=' + chain.request.index.digest}>{t.mutualSummary}</Link>}
    <Link className={mutual ? 'mobile-secondary' : 'mobile-action'} href={contributionLink('receipt', done.digest, mutual)}>{t.receipt}</Link>
  </>;
  if (!chain) return error ? <>
    <p role="alert">{t.unavailable}</p>
    <button type="button" className="mobile-action" onClick={() => { setError(''); setReload(reload + 1); }}>{t.retry}</button>
  </> : <p role="status">{t.loading}</p>;
  if (chain.head.index.digest !== target || chain.head.receipt.kind === 'ACCEPT') return <>
    <p>{chain.head.receipt.kind === 'ACCEPT'
      ? (chain.entry.receipt.kind === 'CONTRIBUTE' && chain.acceptedDelivery?.index.digest !== target ? t.otherVersion : t.accepted)
      : t.delivered}</p>
    {chain.acceptedDelivery && chain.acceptedDelivery.index.digest !== target &&
      <Link className="mobile-secondary" href={contributionLink('receipt', chain.acceptedDelivery.index.digest, mutual)}>{t.exactVersion}</Link>}
    <Link className="mobile-action" href={contributionLink('receipt', chain.head.index.digest, mutual)}>{t.current}</Link>
  </>;

  const validContributor = StrKey.isValidEd25519PublicKey(contributor.trim().toUpperCase()) &&
    contributor.trim().toUpperCase() !== signer.publicKey;
  if (yerko && !mayAssign && !mayAccept) return <>
    {mayDeliver ? <>
      <blockquote>{draft?.statement ?? yerkoDelivered[lang]}</blockquote>
      <a className="mobile-text-action" href={yerkoSlides}>{lang === 'es' ? 'Abrir presentación (PDF)' : 'Open slides (PDF)'}</a>
      <details><summary>{lang === 'es' ? 'Huella del PDF que firmarás' : 'PDF fingerprint you will sign'}</summary>
        <code>{yerkoSlidesSha256}</code>
      </details>
      <button type="button" className="mobile-action" disabled={busy} onClick={() => publish('CONTRIBUTE')}>
        {attempt ? t.retry : lang === 'es' ? 'Firmar como ponente' : 'Sign as speaker'}
      </button>
      {busy && <p role="status">{t.busy}</p>}
      {error && <p role="alert">{error === 'fresh' ? t.fresh : t.pending}</p>}
    </> : <p>{lang === 'es' ? 'Para firmar como ponente, abre la invitación con la cuenta de Yerko.' : 'To sign as speaker, open the invitation with Yerko’s account.'}</p>}
  </>;
  return <>
    <blockquote>{chain.entry.receipt.statement}</blockquote>
    {mayAssign ? <form className="mobile-actions" onSubmit={authorize}>
      <p>{t.assignmentInfo}</p>
      {link ? <>
        <h2 role="status">{t.inviteReady} {recipient?.name}</h2>
        <ShareActions lang={lang} url={link} label={t.invite} message={t.inviteMessage} />
      </> : <>
        {cursor === undefined ? <button className="mobile-secondary" type="button" disabled={busy} onClick={() => browse()}>{t.browse}</button> : <>
          <label htmlFor="directory-search">{t.search}</label>
          <input id="directory-search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
          {profiles.filter(profile => (profile.displayName + ' ' + profile.account).toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())).map(profile => <button className="mobile-secondary" type="button" key={profile.account}
            disabled={busy} onClick={() => {
              setContributor(profile.account);
              setRecipient({ account: profile.account, name: profile.displayName });
            }}>{profile.displayName} · {profile.account.slice(0, 6)}…{profile.account.slice(-6)}</button>)}
          {!profiles.some(profile => (profile.displayName + ' ' + profile.account).toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())) && <p className="mobile-note">{t.directoryEmpty}</p>}
          {cursor !== '0' && <button className="mobile-secondary" type="button" disabled={busy} onClick={() => browse(cursor)}>{t.more}</button>}
        </>}
        <label htmlFor="delivery-account">{t.deliverer}</label>
        <input id="delivery-account" value={contributor} onChange={event => { setContributor(event.target.value); setRecipient(undefined); }}
          maxLength={56} autoCapitalize="characters" spellCheck={false} disabled={busy} required />
        {recipient && <p><strong>{recipient.name}</strong><br /><code>{recipient.account}</code></p>}
        <button className="mobile-action" disabled={busy || !validContributor}>{recipient ? t.assign : t.lookup}</button>
      </>}
    </form> : mayAccept ? <>
      <p>{t.acceptReview}</p>
      <blockquote>{draft?.statement ?? t.acceptText}</blockquote>
      <p>{t.confirm}</p>
      <button type="button" className="mobile-action" disabled={busy} onClick={() => publish('ACCEPT')}>{attempt ? t.retry : t.approve}</button>
    </> : mayDeliver ? draft ? <>
      <blockquote>{draft.statement}</blockquote>
      <p>{t.confirm}</p>
      <button type="button" className="mobile-action" disabled={busy} onClick={() => publish('CONTRIBUTE')}>{attempt ? t.retry : t.signDelivery}</button>
      {!attempt && <button type="button" className="mobile-text-action" disabled={busy} onClick={() => setDraft(undefined)}>{t.edit}</button>}
    </> : <form className="mobile-actions" onSubmit={event => {
      event.preventDefault();
      if (text.trim()) setDraft(makeLinkedReceipt('CONTRIBUTE', signer.publicKey, chain.request.index.digest, target, text.trim().normalize('NFC')));
    }}>
      {correction && <p className="mobile-note">{t.correction}</p>}
      <label htmlFor="delivery-text">{t.write}</label>
      <textarea id="delivery-text" rows={4} maxLength={1000} value={text} onChange={event => setText(event.target.value)} required />
      <button className="mobile-action" disabled={!text.trim()}>{t.review}</button>
    </form> : <p>{t.ineligible}</p>}
    {busy && <p role="status">{t.busy}</p>}
    {error && <p role="alert" className="mobile-message">{error === 'fresh' ? t.fresh : error === 'pending' ? t.pending : error === 'profile-missing' ? t.profileMissing : t.unavailable}</p>}
  </>;
}
