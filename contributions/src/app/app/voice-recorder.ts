import { VOICE_AUTH_SECONDS, VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VOICE_MIN_SECONDS, voiceMessage,
  type VoiceDraft, type VoiceKind } from '@/lib/contributions/voice/contract';
import type { Signer } from '@/lib/contributions/keys';
import type { ContributionNetwork } from '@/lib/contributions/network';

const consentKey = 'vespi:voice-consent:v1';
const consentInMemory = new Set<string>();

export function clearVoiceConsent(account: string) {
  const key = consentKey + ':' + account;
  consentInMemory.delete(key);
  try { sessionStorage.removeItem(key); } catch {}
}
const formats = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/wav'];

const copy = {
  es: {
    consent: 'Tu audio se envía a un servicio de IA (Vercel AI Gateway y su proveedor) para escribir el borrador. Vespi no lo guarda. No nombres a otras personas sin su permiso.',
    privacy: 'Cómo se usa tu audio', recordShort: 'Grabar voz', cancel: 'Cancelar', passkey: 'Puede pedir tu passkey',
    'different-account': 'Desbloqueaste otra cuenta. Abre la cuenta con la que estás escribiendo.',
    understand: 'Entiendo', record: 'Grabar nota de voz', unlocking: 'Abriendo tu cuenta…', permission: 'Permite el acceso al micrófono para grabar.',
    recording: 'Grabando', stop: 'Detener grabación', playback: 'Escucha tu nota antes de enviarla.',
    discard: 'Descartar audio', send: 'Enviar audio', writing: 'Escribiendo el borrador…', ready: 'Borrador listo.',
    choose: 'Ya hay texto en el formulario. ¿Cómo quieres usar el borrador?',
    replace: 'Reemplazar', append: 'Agregar al final', discardDraft: 'Descartar',
    suggested: 'Propuesto por IA, revísalo.',
    denied: 'No pudimos usar el micrófono. Revisa el permiso o escribe aquí.',
    offline: 'No hay conexión. Puedes reintentar o seguir escribiendo.',
    'voice-unauthorized': 'No pudimos verificar tu cuenta. Reintenta o sigue escribiendo.',
    'voice-too-short': 'Graba al menos 8 segundos.',
    'voice-too-long': 'La nota dura más de 2 minutos.',
    'voice-too-large': 'El audio es demasiado pesado. Prueba con una nota más corta.',
    'voice-invalid-audio': 'No pudimos leer el audio. Prueba grabando de nuevo.',
    'voice-unsupported-audio': 'No pudimos leer el audio. Prueba grabando de nuevo.',
    'voice-silent': 'No se entendió lo que dijiste. Vuelve a grabar o escribe aquí.',
    'voice-quota': 'Llegaste al límite de notas de voz de hoy. Puedes seguir escribiendo.',
    'profile-required': 'Publica tu nombre en Vespi para usar la voz. Puedes seguir escribiendo.',
    'voice-flagged': 'El servicio marcó la nota. Puedes seguir escribiendo.',
    'voice-unavailable': 'El servicio de voz no está disponible. Puedes seguir escribiendo.',
  },
  en: {
    consent: 'Your audio is sent to an AI service (Vercel AI Gateway and its provider) to write the draft. Vespi does not keep it. Don’t name other people without their permission.',
    privacy: 'How your audio is used', recordShort: 'Record voice', cancel: 'Cancel', passkey: 'May ask for your passkey',
    'different-account': 'You unlocked a different account. Open the account you’re writing with.',
    understand: 'I understand', record: 'Record a voice note', unlocking: 'Opening your account…', permission: 'Allow microphone access to record.',
    recording: 'Recording', stop: 'Stop recording', playback: 'Listen to your note before sending.',
    discard: 'Discard audio', send: 'Send audio', writing: 'Writing the draft…', ready: 'Draft ready.',
    choose: 'The form already has text. How would you like to use the draft?',
    replace: 'Replace', append: 'Append', discardDraft: 'Discard',
    suggested: 'Proposed by AI, please review.',
    denied: 'We couldn’t use the microphone. Check the permission or type here.',
    offline: 'You’re offline. You can retry or keep typing.',
    'voice-unauthorized': 'We couldn’t verify your account. Retry or keep typing.',
    'voice-too-short': 'Record at least 8 seconds.',
    'voice-too-long': 'The note is longer than 2 minutes.',
    'voice-too-large': 'The audio file is too large. Try recording a shorter note.',
    'voice-invalid-audio': 'We couldn’t read the audio. Try recording again.',
    'voice-unsupported-audio': 'We couldn’t read the audio. Try recording again.',
    'voice-silent': 'We couldn’t understand what you said. Record again or type here.',
    'voice-quota': 'You’ve reached today’s voice note limit. You can keep typing.',
    'profile-required': 'Publish your name on Vespi to use voice. You can keep typing.',
    'voice-flagged': 'The service flagged this note. You can keep typing.',
    'voice-unavailable': 'The voice service is unavailable. You can keep typing.',
  },
};

export const voiceSuggestion = (lang: keyof typeof copy) => copy[lang].suggested;

export type VoiceDraftChoice = 'replace' | 'append';

export function mergeVoiceText(current: string, suggestion: string, choice: VoiceDraftChoice, max: number, separator = '\n\n') {
  if (!suggestion) return current;
  const prefix = choice === 'append' && current.trim() ? current + separator : '';
  const addition = suggestion.slice(0, Math.max(0, max - prefix.length)).replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
  return addition ? prefix + addition : current;
}

type VoiceOptions = {
  lang: keyof typeof copy;
  network: ContributionNetwork;
  account: string;
  kind: VoiceKind;
  composer?: boolean;
  getSigner(): Signer | Promise<Signer>;
  needsPasskey?(): boolean;
  hasWritten(draft: VoiceDraft): boolean;
  onDraft(draft: VoiceDraft, choice: VoiceDraftChoice): void;
};

export function mountVoiceRecorder(host: HTMLElement, { lang, network, account, kind, composer, getSigner, needsPasskey, hasWritten, onDraft }: VoiceOptions) {
  host.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return;
  const format = formats.find(type => MediaRecorder.isTypeSupported(type));
  if (!format) return;

  const texts = copy[lang];
  const permission = needsPasskey ? consentKey + ':' + account : consentKey;
  function hasConsent() {
    if (consentInMemory.has(permission)) return true;
    try { return sessionStorage.getItem(permission) === '1'; } catch { return false; }
  }
  const controller = new AbortController();
  const signal = controller.signal;
  const params = new URLSearchParams({ account, network });
  if (network === 'mainnet' && kind === 'encounter') params.set('kind', kind);
  const panel = document.createElement('div');
  panel.className = 'voice-draft';
  const notice = document.createElement('p');
  notice.textContent = texts.consent;
  const privacy = document.createElement('details');
  const privacyLink = document.createElement('summary');
  privacyLink.textContent = texts.privacy;
  privacy.append(privacyLink, notice);
  if (needsPasskey) panel.classList.add('voice-draft-compact');
  if (composer) panel.classList.add('voice-draft-composer');
  const consentSheet = composer ? document.createElement('dialog') : undefined;
  const status = document.createElement('p');
  status.className = 'voice-status';
  status.setAttribute('role', 'status');
  status.tabIndex = -1;
  const choices = document.createElement('div');
  choices.className = 'voice-choices';
  const count = document.createElement('span');
  if (composer) count.setAttribute('role', 'timer');
  else count.setAttribute('aria-hidden', 'true');
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.setAttribute('aria-label', texts.playback);
  audio.hidden = true;
  let recorded: Blob | undefined;
  let playbackUrl: string | undefined;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  let timer: number | undefined;
  let updateCounter: number | undefined;

  function button(label: string, action: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  function state(message: string, focus = true) {
    const ready = needsPasskey && message === texts.ready;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('sr-only', Boolean(ready));
    panel.classList.toggle('voice-draft-recording', Boolean(composer && message === texts.recording));
    if (composer) privacy.hidden = !hasConsent() || !choices.contains(record);
    if (focus && message) (ready ? record : status).focus();
  }

  function releaseMic() {
    clearTimeout(timer);
    clearInterval(updateCounter);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
  }

  function releaseAudio() {
    recorded = undefined;
    audio.removeAttribute('src');
    audio.load();
    audio.hidden = true;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = undefined;
  }

  const record = button(texts.record, () => {
    if (consentSheet && !hasConsent()) {
      consentHint.hidden = !needsPasskey?.();
      consentSheet.showModal();
    } else if (needsPasskey && !hasConsent()) {
      privacy.open = true;
      privacy.hidden = false;
      panel.insertBefore(privacy, choices);
      consentHint.hidden = !needsPasskey();
      if (!consentHint.hidden) consent.setAttribute('aria-description', texts.passkey);
      else consent.removeAttribute('aria-description');
      choices.replaceChildren(consent, cancel);
      consent.focus();
    } else void start();
  });
  record.setAttribute('aria-label', texts.record);
  const hint = document.createElement('span');
  hint.className = 'mobile-passkey-hint';
  hint.textContent = texts.passkey;
  if (composer) {
    record.classList.add('voice-mic');
    record.replaceChildren();
  } else if (needsPasskey) {
    const label = document.createElement('span');
    label.textContent = texts.recordShort;
    label.append(hint);
    record.classList.add('voice-record');
    record.replaceChildren(label);
  }
  const cancel = button(texts.cancel, () => {
    if (consentSheet) consentSheet.close();
    else idle('', true);
  });
  const mic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mic.setAttribute('viewBox', '0 0 24 24');
  mic.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(mic.namespaceURI, 'path');
  path.setAttribute('d', 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v4m-3 0h6');
  mic.append(path);
  record.prepend(mic);
  const consent = button(texts.understand, () => {
    consentInMemory.add(permission);
    try { sessionStorage.setItem(permission, '1'); } catch {}
    if (consentSheet) {
      consentSheet.close();
      void start();
    } else if (needsPasskey) {
      privacy.open = false;
      panel.append(privacy);
      void start();
    } else idle('', true);
  });
  const consentHint = hint.cloneNode(true) as HTMLSpanElement;
  if (needsPasskey) {
    consent.classList.add('voice-consent');
    consent.setAttribute('aria-label', texts.understand);
    consent.append(consentHint);
  }
  const stop = button(texts.stop, () => {
    if (recorder?.state === 'recording') recorder.stop();
  });
  stop.classList.add('voice-stop');
  const discard = button(texts.discard, () => {
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = undefined;
      releaseMic();
    }
    releaseAudio();
    idle('', true);
  });
  const send = button(texts.send, () => { void submit(); });
  if (consentSheet) {
    stop.setAttribute('aria-label', texts.stop);
    stop.innerHTML = '<span aria-hidden="true"></span>';
    discard.setAttribute('aria-label', texts.discard);
    discard.textContent = texts.discardDraft;
    discard.classList.add('voice-discard');
    const heading = document.createElement('h2');
    heading.textContent = texts.privacy;
    const actions = document.createElement('div');
    actions.className = 'voice-consent-actions';
    consent.autofocus = true;
    consent.classList.add('mobile-action');
    cancel.classList.add('mobile-text-action');
    actions.append(consent, cancel);
    consentSheet.className = 'mobile-bottom-sheet voice-consent-sheet';
    consentSheet.setAttribute('aria-label', texts.privacy);
    consentSheet.append(heading, notice.cloneNode(true), actions);
    panel.append(status, audio, privacy, choices, consentSheet);
  } else if (needsPasskey) panel.append(status, audio, choices, privacy);
  else panel.append(notice, status, audio, choices);

  function idle(message = '', focus = false) {
    record.disabled = !composer && !needsPasskey && !hasConsent();
    if (consentSheet && !hasConsent()) record.setAttribute('aria-haspopup', 'dialog');
    else record.removeAttribute('aria-haspopup');
    hint.hidden = !needsPasskey?.();
    if (hint.hidden) record.removeAttribute('aria-description');
    else record.setAttribute('aria-description', texts.passkey);
    privacy.open = false;
    privacy.hidden = !hasConsent();
    if (needsPasskey && !composer) panel.append(privacy);
    choices.replaceChildren(record);
    if (record.disabled) choices.append(consent);
    state(message, focus);
    if (focus && !message) (record.disabled ? consent : record).focus();
  }

  async function start() {
    choices.replaceChildren();
    if (needsPasskey?.()) {
      state(texts.unlocking);
      try {
        if ((await getSigner()).publicKey !== account) return idle(texts['different-account'], true);
      } catch (error) {
        return idle(error instanceof Error && error.message === 'different-account' ? texts['different-account'] : texts['voice-unauthorized'], true);
      }
      if (signal.aborted) return;
    }
    state(texts.permission);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (signal.aborted) {
        microphone.getTracks().forEach(track => track.stop());
        return;
      }
      stream = microphone;
      const recording = new MediaRecorder(stream, { mimeType: format, audioBitsPerSecond: 64_000 });
      recorder = recording;
      const parts: Blob[] = [];
      recording.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recording.onerror = () => {
        recording.onstop = null;
        recording.ondataavailable = null;
        recorder = undefined;
        releaseMic();
        if (!signal.aborted) idle(texts['voice-invalid-audio'], true);
      };
      const started = performance.now();
      recording.onstop = () => {
        const seconds = (performance.now() - started) / 1000;
        recorder = undefined;
        releaseMic();
        if (signal.aborted) return;
        if (seconds < VOICE_MIN_SECONDS) return idle(texts['voice-too-short'], true);
        const clip = new Blob(parts, { type: recording.mimeType || format });
        if (!clip.size) return idle(texts['voice-invalid-audio'], true);
        if (clip.size > VOICE_MAX_BYTES) return idle(texts['voice-too-large'], true);
        recorded = clip;
        playbackUrl = URL.createObjectURL(clip);
        audio.src = playbackUrl;
        audio.hidden = false;
        choices.replaceChildren(send, discard);
        state(texts.playback);
      };
      recording.start();
      const tick = () => {
        const elapsed = Math.min(VOICE_MAX_SECONDS, Math.floor((performance.now() - started) / 1000));
        const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
        count.textContent = composer ? time : `${time} / 2:00`;
      };
      tick();
      if (composer) choices.replaceChildren(count, stop, discard);
      else choices.replaceChildren(stop, count);
      state(texts.recording);
      updateCounter = window.setInterval(tick, 250);
      timer = window.setTimeout(() => stop.click(), VOICE_MAX_SECONDS * 1000);
    } catch {
      releaseMic();
      if (!signal.aborted) idle(texts.denied, true);
    }
  }

  function retry(reason: string) {
    choices.replaceChildren(send, discard);
    state(Object.hasOwn(texts, reason) ? texts[reason as keyof typeof texts] : texts['voice-unavailable']);
  }

  function offerDraft(draft: VoiceDraft) {
    const apply = (choice: VoiceDraftChoice) => {
      onDraft(draft, choice);
      if (!signal.aborted) idle(texts.ready, !composer);
    };
    if (!hasWritten(draft)) return apply('replace');
    choices.replaceChildren(
      button(texts.replace, () => apply('replace')),
      button(texts.append, () => apply('append')),
      button(texts.discardDraft, () => idle('', true)),
    );
    state(texts.choose);
  }

  async function submit() {
    if (!recorded) return;
    audio.pause();
    choices.replaceChildren();
    state(texts.writing);
    const signer = await Promise.resolve().then(getSigner).catch(() => null);
    if (signal.aborted) return;
    if (signer?.publicKey !== account) return retry('voice-unauthorized');
    const upload = new AbortController();
    const abort = () => upload.abort();
    signal.addEventListener('abort', abort, { once: true });
    const deadline = window.setTimeout(abort, 48_000);
    try {
      const clip = recorded;
      const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', await clip.arrayBuffer())));
      const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
      upload.signal.throwIfAborted();
      const expires = Math.floor(Date.now() / 1000) + VOICE_AUTH_SECONDS;
      const signature = hex(await signer.sign(voiceMessage(network, account, expires, kind, digest, nonce)));
      const response = await fetch(`/api/contributions/voice-draft?network=${network}`, {
        method: 'POST',
        signal: upload.signal,
        headers: {
          'Content-Type': clip.type,
          'x-vespi-account': account,
          'x-vespi-expires': String(expires),
          'x-vespi-signature': signature,
          'x-vespi-voice-kind': kind,
          'x-vespi-audio-sha256': digest,
          'x-vespi-nonce': nonce,
        },
        body: clip,
      });
      const { draft, reason } = await response.json() as { draft?: VoiceDraft; reason?: string };
      if (signal.aborted) return;
      if (!response.ok || !draft) return retry(reason ?? 'voice-unavailable');
      releaseAudio();
      offerDraft(draft);
    } catch (error) {
      if (!signal.aborted) retry(!navigator.onLine || error instanceof TypeError ? 'offline' : 'voice-unavailable');
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
    }
  }

  void fetch('/api/contributions/voice?' + params, { signal, cache: 'no-store' })
    .then(async response => response.ok && (await response.json()).voice === true)
    .then(allowed => {
      if (!allowed || signal.aborted) return;
      host.replaceChildren(panel);
      host.hidden = false;
      idle();
    }).catch(() => {});

  return () => {
    controller.abort();
    if (consentSheet?.open) consentSheet.close();
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic();
    if (playbackUrl) releaseAudio();
    host.replaceChildren();
    host.hidden = true;
  };
}
