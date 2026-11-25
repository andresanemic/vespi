import { createHash } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { contributionFailure, contributionNetworkFromQuery } from '../network-request';
import { createRateLimiter } from '../rate-limit';
import { createProfileRegistry } from '../profile-registry';
import { readAccountAllowlist } from '../sponsor-policy';
import { reserveVoice, voiceAccounts } from './access';
import { readVoiceAudio, voiceMediaType } from './audio';
import { VOICE_AUTH_SECONDS, VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VOICE_MIN_SECONDS,
  voiceMessage, type VoiceDraft, type VoiceKind } from './contract';

const noStore = { 'Cache-Control': 'no-store' };

function limited(request: Request, limiter: ReturnType<typeof createRateLimiter>, eligibility = false) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const hit = limiter.take(ip, null);
  if (!hit.ok) return Response.json(eligibility ? { voice: false } : { ok: false, reason: 'rate_limited' }, {
    status: 429, headers: { ...noStore, 'Retry-After': String(hit.retryAfter) },
  });
}

function networkFor(url: URL) {
  try { return contributionNetworkFromQuery(url.searchParams.getAll('network')); }
  catch { return null; }
}

// Notes per day for people outside the team list, within the shared daily total.
const OPEN_ACCOUNT_DAILY_MAX = 3;

// The team list switches voice on. Testnet is open; mainnet also admits the accounts enabled to sign there.
function voiceAccess(env: Record<string, string | undefined>, network: 'testnet' | 'mainnet', account: string) {
  const team = voiceAccounts(env);
  if (!team) return 'unavailable';
  if (team.has(account)) return 'team';
  return network === 'testnet' || !encounterMainnetError(env, account) ? 'open' : 'denied';
}

function encounterMainnetError(env: Record<string, string | undefined>, account: string) {
  try {
    const list = readAccountAllowlist(env, 'mainnet');
    if (list) return list.has(account) ? undefined : 'account-not-allowed';
  } catch { /* A malformed list closes mainnet. */ }
  return 'mainnet-unavailable';
}

export function createVoiceEligibility(env: Record<string, string | undefined> = process.env) {
  const limiter = createRateLimiter();
  return (request: Request) => {
    const blocked = limited(request, limiter, true);
    if (blocked) return blocked;
    const url = new URL(request.url);
    const [account, ...extra] = url.searchParams.getAll('account');
    const network = networkFor(url);
    const voice = Boolean(account && !extra.length && network && StrKey.isValidEd25519PublicKey(account) &&
      ['team', 'open'].includes(voiceAccess(env, network, account)) &&
      (network !== 'mainnet' || url.searchParams.get('kind') !== 'encounter' || !encounterMainnetError(env, account)));
    return Response.json({ voice }, { headers: noStore });
  };
}

async function readAudio(request: Request, signal: AbortSignal) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > VOICE_MAX_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    cancel();
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function durationError(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'voice-invalid-audio';
  if (seconds < VOICE_MIN_SECONDS) return 'voice-too-short';
  if (seconds > VOICE_MAX_SECONDS) return 'voice-too-long';
}

function coherentAudio(bytes: Buffer, mediaType: string, seconds: number) {
  // WAV already checks exact PCM frame sizes. Compressed recorders target 8 KB/s.
  const bytesPerSecond = bytes.length / seconds;
  return mediaType === 'audio/wav' || bytesPerSecond >= 64 && bytesPerSecond <= 80_000;
}

// A bare host counts as a link only with a common public suffix, so "Node.js", "EE.UU." and "Terminé.Gracias" stay.
const links = /(?:https?:\/\/|www\.|javascript:\s*)[^\s<>]+|(?<![\p{L}\p{N}_.-])[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.(?:com|org|net|io|xyz|app|dev|co|cl|ar|mx|pe|es|eu|uk|ai|me|gg|info|link|live|site|online|store|tech|finance|network|foundation)(?![\p{L}\p{N}_-])(?::\d+)?(?:[/?#][^\s<>]*)?/giu;
const stellarKeys = /\b(?:[GSCXTL][A-Z2-7]{55}|B[A-Z2-7]{57}|M[A-Z2-7]{68}|P[A-Z2-7]{58,165})\b/gi;

function clean(raw: unknown, max: number) {
  if (typeof raw !== 'string') return '';
  const value = raw.normalize('NFC').replace(/[\p{Cf}\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
    .replace(links, '').replace(stellarKeys, '').trim();
  const clipped = value.slice(0, max);
  return clipped.replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
}

const months = [
  'enero|january|jan', 'febrero|february|feb', 'marzo|march|mar', 'abril|april|apr',
  'mayo|may', 'junio|june|jun', 'julio|july|jul', 'agosto|august|aug',
  'septiembre|setiembre|september|sep|sept', 'octubre|october|oct', 'noviembre|november|nov', 'diciembre|december|dec',
];

function explicitDate(raw: unknown, spoken: string) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(raw)) ||
      new Date(raw).toISOString().slice(0, 10) !== raw) return;
  const [year, month, day] = raw.split('-');
  const date = `0?${Number(day)}(?:st|nd|rd|th)?`;
  const name = `(?:${months[Number(month) - 1]})\\.?`;
  const verbal = new RegExp(`\\b(?:${date} (?:de )?${name}(?: de|,)? ${year}|${name} ${date},? ${year})\\b`, 'i');
  if (spoken.includes(raw) || verbal.test(spoken)) return raw;
}

function draftFrom(kind: VoiceKind, result: Record<string, unknown>, transcript: string): VoiceDraft {
  const spoken = transcript.normalize('NFC').toLowerCase();
  const identifiers = /\b\d{4}-\d{2}-\d{2}\b|[$€£]\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:usd|clp|eur|xlm)\b/gi;
  const token = (value: string) => value.replace(/[.,!?]+$/, '');
  const supplied = new Set((transcript.normalize('NFC').match(identifiers) ?? []).map(token));
  const evidenceOnly = (raw: unknown, max: number) => clean(raw, max)
    .replace(identifiers, value => supplied.has(token(value)) ? value : '').trim();
  if (kind !== 'encounter') {
    const comment = evidenceOnly(result.comment, 280);
    return { statement: evidenceOnly(result.statement, 1000), ...(comment && { comment }) };
  }
  const { type } = result;
  const date = explicitDate(result.date, spoken);
  const where = clean(result.where, 200);
  const otherName = clean(result.otherName, 80).replace(/\p{Cc}/gu, ' ').trim();
  const mentionedOther = otherName && spoken.includes(otherName.toLowerCase()) ? otherName : '';
  const contributions = Array.isArray(result.contributions)
    ? result.contributions.slice(0, 12).flatMap(entry => {
      if (entry?.from !== 'a' && (entry?.from !== 'b' || !mentionedOther)) return [];
      const text = evidenceOnly(entry.text, 1000);
      return text ? [{ from: entry.from as 'a' | 'b', text }] : [];
    }) : [];
  return {
    type: type === 'reunion' || type === 'ayuda' || type === 'charla' || type === 'otro' ? type : '',
    title: evidenceOnly(result.title, 140),
    ...(date && { date }),
    ...(where && spoken.includes(where.toLowerCase()) && { where }),
    summary: evidenceOnly(result.summary, 1000),
    contributions,
    ...(mentionedOther && { otherName: mentionedOther }),
  };
}

type VoiceServices = {
  transcribe(audio: Uint8Array, mediaType: string, signal: AbortSignal): Promise<{ text: string; durationInSeconds?: number }>;
  extract(kind: VoiceKind, transcript: string, signal: AbortSignal): Promise<unknown>;
  env?: Record<string, string | undefined>;
  redis?: typeof fetch;
  now?: () => number;
};

export function createVoicePost({ transcribe, extract, env = process.env, redis = fetch, now = Date.now }: VoiceServices) {
  const limiter = createRateLimiter();
  return async (request: Request) => {
    const blocked = limited(request, limiter);
    if (blocked) return blocked;
    const network = networkFor(new URL(request.url));
    if (!network) return contributionFailure('invalid-network', 400);
    if (!voiceAccounts(env)) return contributionFailure('voice-unavailable', 503);
    const account = request.headers.get('x-vespi-account') ?? '';
    const expiration = request.headers.get('x-vespi-expires') ?? '';
    const signature = request.headers.get('x-vespi-signature') ?? '';
    const digest = request.headers.get('x-vespi-audio-sha256') ?? '';
    const nonce = request.headers.get('x-vespi-nonce') ?? '';
    const kind = request.headers.get('x-vespi-voice-kind');
    if (kind !== 'request' && kind !== 'delivery' && kind !== 'encounter') return contributionFailure('voice-invalid-kind', 400);
    const seconds = Math.floor(now() / 1000);
    const expires = Number(expiration);
    const message = voiceMessage(network, account, expires, kind, digest, nonce);
    if (!StrKey.isValidEd25519PublicKey(account) || !/^\d{1,12}$/.test(expiration) || expires <= seconds ||
        expires > seconds + VOICE_AUTH_SECONDS || !/^[\da-f]{128}$/i.test(signature) ||
        !/^[\da-f]{64}$/.test(digest) || !/^[\da-f]{32}$/.test(nonce) ||
        !Keypair.fromPublicKey(account).verify(Buffer.from(message), Buffer.from(signature, 'hex'))) {
      return contributionFailure('voice-unauthorized', 401);
    }
    const access = voiceAccess(env, network, account);
    if (access === 'denied') return contributionFailure('account-not-allowed', 403);
    if (network === 'mainnet' && kind === 'encounter') {
      const reason = encounterMainnetError(env, account);
      if (reason) return contributionFailure(reason, reason === 'account-not-allowed' ? 403 : 503);
    }
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > VOICE_MAX_BYTES)) {
      return contributionFailure('voice-too-large', 413);
    }
    const mediaType = voiceMediaType(request.headers.get('content-type') ?? '');
    if (!mediaType) return contributionFailure('voice-unsupported-audio', 415);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    let stage = 'profile';

    try {
      // A published name keeps throwaway keys from spending the shared daily total. The mainnet list already decides there.
      if (access === 'open' && network === 'testnet' && !await createProfileRegistry(env, redis, network).get(account)) {
        return contributionFailure('profile-required', 403);
      }
      stage = 'read-audio';
      const bytes = await readAudio(request, signal);
      if (!bytes) return contributionFailure('voice-too-large', 413);
      if (!bytes.length) return contributionFailure('voice-invalid-audio', 400);
      if (createHash('sha256').update(bytes).digest('hex') !== digest) return contributionFailure('voice-unauthorized', 401);
      const audio = readVoiceAudio(bytes, mediaType);
      if (!audio) return contributionFailure('voice-unsupported-audio', 415);
      if (audio.duration !== undefined) {
        const invalid = durationError(audio.duration);
        if (invalid) return contributionFailure(invalid, 400);
        if (!coherentAudio(bytes, mediaType, audio.duration)) return contributionFailure('voice-invalid-audio', 400);
      }
      if (audio.silent) return contributionFailure('voice-silent', 400);
      const reservedAt = now();
      if (Math.floor(reservedAt / 1000) >= expires) return contributionFailure('voice-unauthorized', 401);
      stage = 'reserve';
      const proofId = createHash('sha256').update(message).digest('hex');
      const reservation = await reserveVoice(env, network, account, reservedAt, proofId, signal, redis,
        access === 'open' ? OPEN_ACCOUNT_DAILY_MAX : undefined);
      if (reservation === 'replayed') return contributionFailure('voice-unauthorized', 401);
      if (reservation === 'exhausted') return contributionFailure('voice-quota', 429);
      signal.throwIfAborted();
      stage = 'transcribe';
      const { text, durationInSeconds } = await transcribe(bytes, mediaType, signal);
      const providerDurationError = durationError(durationInSeconds === undefined ? audio.duration : durationInSeconds);
      if (providerDurationError) return contributionFailure(providerDurationError, 400);
      if (audio.duration === undefined && durationInSeconds !== undefined && !coherentAudio(bytes, mediaType, durationInSeconds)) {
        return contributionFailure('voice-invalid-audio', 400);
      }
      const transcript = text.trim().slice(0, 4000).replace(/[\uD800-\uDBFF]$/u, '');
      if (!transcript) return contributionFailure('voice-silent', 400);
      signal.throwIfAborted();
      stage = 'extract';
      const result = await extract(kind, transcript, signal);
      if (!result || typeof result !== 'object' || !('flagged' in result)) throw new Error('missing moderation result');
      if (result.flagged === true) return contributionFailure('voice-flagged', 422);
      if (result.flagged !== false || !('reason' in result) || result.reason !== null) throw new Error('invalid moderation result');
      const draft = draftFrom(kind, result as Record<string, unknown>, transcript);
      if ('statement' in draft ? !draft.statement : !draft.title && !draft.summary && !draft.contributions.length) {
        return contributionFailure('voice-silent', 400);
      }
      return Response.json({ draft }, { headers: noStore });
    } catch (error) {
      const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
      console.warn('voice-draft', { stage, status: typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503 });
      return contributionFailure('voice-unavailable', 503);
    }
  };
}
