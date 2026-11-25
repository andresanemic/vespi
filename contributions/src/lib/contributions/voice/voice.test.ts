import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { ContributionNetwork } from '../network';
import '../test-imports.mjs';

const { createVoiceEligibility, createVoicePost }: typeof import('./handlers') = await import(new URL('handlers.ts', import.meta.url).href);
const { VOICE_MAX_BYTES, voiceMessage }: typeof import('./contract') = await import(new URL('contract.ts', import.meta.url).href);
const { readVoiceAudio }: typeof import('./audio') = await import(new URL('audio.ts', import.meta.url).href);
type VoiceKind = import('./contract').VoiceKind;

const a = Keypair.random();
const b = Keypair.random();
const outside = Keypair.random();
const time = Date.UTC(2026, 10, 23, 21);
const validUntil = time / 1000 + 300;
const transcript = 'AUDIO-PRIVATE-123. Me reuní con Ana en Santiago el 23 de noviembre de 2026.';
const env = {
  CONTRIB_VOICE_ACCOUNTS: `${a.publicKey()}, ${b.publicKey()}`,
  CONTRIB_KV_REST_API_URL: 'https://testnet.invalid/', CONTRIB_KV_REST_API_TOKEN: 'test-token',
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://mainnet.invalid', CONTRIB_KV_MAINNET_REST_API_TOKEN: 'main-token',
};

function wave(seconds = 10, silent = false) {
  const size = seconds * 8000;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(size, 40);
  if (!silent) bytes[44] = 64;
  return bytes;
}

function request({ network = '', signedNetwork = network || 'testnet', account = a, signingKey = account,
  expires = validUntil, signature = true, path = 'request', signedKind = path as VoiceKind, contentType = 'audio/wav',
  audio = wave(), signedAudio = audio, nonce = randomBytes(16).toString('hex'), length }: {
    network?: ContributionNetwork | ''; signedNetwork?: ContributionNetwork; account?: Keypair; signingKey?: Keypair;
    expires?: number; signature?: boolean; path?: string; signedKind?: VoiceKind; contentType?: string;
    audio?: Buffer; signedAudio?: Buffer; nonce?: string; length?: number;
  } = {}) {
  const body = new Uint8Array(audio);
  const digest = createHash('sha256').update(signedAudio).digest('hex');
  return new Request('http://localhost/api/contributions/voice-draft' + (network ? '?network=' + network : ''), {
    method: 'POST', body,
    headers: {
      'x-vespi-account': account.publicKey(),
      'x-vespi-expires': String(expires),
      ...(signature && { 'x-vespi-signature': signingKey.sign(Buffer.from(voiceMessage(signedNetwork, account.publicKey(), expires, signedKind, digest, nonce))).toString('hex') }),
      'x-vespi-voice-kind': path,
      'x-vespi-audio-sha256': digest,
      'x-vespi-nonce': nonce,
      'Content-Type': contentType,
      ...(length !== undefined && { 'Content-Length': String(length) }),
    },
  });
}

const defaultExtraction: (kind: VoiceKind, text: string) => Promise<unknown> = async () =>
  ({ statement: 'Revisa el documento.', comment: null, flagged: false, reason: null });

function fixture({ settings = env as Record<string, string | undefined>, unavailable = false, profiles = new Set<string>(),
  transcription = async (): Promise<{ text: string; durationInSeconds?: number }> => ({ text: transcript, durationInSeconds: 10 }),
  extraction = defaultExtraction,
} = {}) {
  const order: string[] = [];
  const stores = new Map<string, Map<string, number>>();
  const claims = new Map<string, number>();
  let clock = time;
  let pendingReservations = 0;
  const handler = createVoicePost({
    now: () => clock, env: settings,
    redis: async (url, init) => {
      const args = JSON.parse(String(init?.body));
      const mainnet = args[args[0] === 'EVAL' ? 3 : 1].startsWith('contributions:mainnet:');
      assert.equal(url, mainnet ? 'https://mainnet.invalid' : 'https://testnet.invalid');
      assert.equal(new Headers(init?.headers).get('Authorization'), mainnet ? 'Bearer main-token' : 'Bearer test-token');
      if (args[0] === 'HGET') {
        assert.match(args[1], /^contributions:(testnet|mainnet):profiles$/);
        order.push('profile');
        if (unavailable) throw new Error('secret Redis failure');
        return Response.json({ result: profiles.has(args[2]) ? 'Ana' : null });
      }
      order.push(args[0] === 'SET' ? 'claim' : 'redis');
      if (unavailable) throw new Error('secret Redis failure');
      if (args[0] === 'SET') {
        const [, key, value, condition, ttlType, ttl] = args;
        assert.match(key, /^contributions:(testnet|mainnet):voice-draft:used:[a-f0-9]{64}$/);
        assert.deepEqual([value, condition, ttlType, ttl], ['1', 'NX', 'EX', 300]);
        if ((claims.get(key) ?? 0) > clock / 1000) return Response.json({ result: null });
        claims.set(key, clock / 1000 + ttl);
        return Response.json({ result: 'OK' });
      }
      const [command, script, count, key, account, daily, perAccount, expiration] = args;
      assert.equal(command, 'EVAL');
      assert.match(script, /HSET.*'total', total \+ 1, account, used \+ 1/);
      assert.equal(count, 1);
      assert.equal(expiration, Date.parse(key.slice(-10)) / 1000 + 172_800);
      const counter = stores.get(key) ?? new Map();
      stores.set(key, counter);
      const total = counter.get('total') ?? 0;
      const used = counter.get(account) ?? 0;
      if (total >= daily || used >= perAccount) return Response.json({ result: 'exhausted' });
      counter.set('total', total + 1);
      counter.set(account, used + 1);
      pendingReservations++;
      return Response.json({ result: 'reserved' });
    },
    async transcribe() {
      assert.ok(pendingReservations > 0);
      pendingReservations--;
      order.push('transcribe');
      return transcription();
    },
    async extract(kind, text) {
      order.push('extract');
      return extraction(kind, text);
    },
  });
  return { handler, order, stores, claims, advance: (ms = 86_400_000) => { clock += ms; } };
}

async function expectReason(response: Response, status: number, reason: string) {
  assert.ok(response, 'missing response');
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: false, reason });
}

test('voice verifies a fresh signature for this account and network before reading or spending', async () => {
  const { handler, order } = fixture();
  for (const input of [request({ signature: false }), request({ expires: time / 1000 }),
    request({ expires: validUntil + 1 }), request({ network: 'mainnet', signedNetwork: 'testnet' }),
    request({ signingKey: b })]) {
    await expectReason(await handler(input), 401, 'voice-unauthorized');
    assert.equal(input.bodyUsed, false);
  }
  await expectReason(await handler(request({ account: outside, network: 'mainnet' })), 403, 'account-not-allowed');
  assert.deepEqual(order, []);
});

test('testnet voice is open to accounts with a published name, with a lower personal limit', async () => {
  const unnamed = fixture();
  const anonymous = request({ account: outside });
  await expectReason(await unnamed.handler(anonymous), 403, 'profile-required');
  assert.equal(anonymous.bodyUsed, false);
  const broken = fixture({ unavailable: true, profiles: new Set([outside.publicKey()]) });
  await expectReason(await broken.handler(request({ account: outside })), 503, 'voice-unavailable');
  assert.deepEqual(unnamed.order, ['profile'], 'a throwaway key claims and spends nothing');

  const { handler, order, stores } = fixture({ profiles: new Set([outside.publicKey(), b.publicKey()]) });
  for (let i = 0; i < 3; i++) assert.equal((await handler(request({ account: outside }))).status, 200);
  assert.deepEqual(order.slice(0, 5), ['profile', 'claim', 'redis', 'transcribe', 'extract']);
  await expectReason(await handler(request({ account: outside })), 429, 'voice-quota');
  assert.equal((await handler(request())).status, 200, 'the team keeps its own limit');
  assert.equal([...stores.values()][0].get('total'), 4, 'everyone shares the daily total');

  const lower = fixture({ settings: { ...env, CONTRIB_VOICE_ACCOUNT_DAILY_MAX: '2' }, profiles: new Set([outside.publicKey()]) });
  for (let i = 0; i < 2; i++) assert.equal((await lower.handler(request({ account: outside }))).status, 200);
  await expectReason(await lower.handler(request({ account: outside })), 429, 'voice-quota');
});

test('mainnet voice stays limited to the team and the accounts enabled to sign', async () => {
  const closed = fixture({ profiles: new Set([outside.publicKey()]) });
  await expectReason(await closed.handler(request({ account: outside, network: 'mainnet' })), 403, 'account-not-allowed');
  assert.deepEqual(closed.order, []);
  const settings = { ...env, CONTRIB_ALLOWED_ACCOUNTS_MAINNET: outside.publicKey() };
  const open = fixture({ settings });
  assert.equal((await open.handler(request({ account: outside, network: 'mainnet' }))).status, 200);
  const eligible = async (values: Record<string, string | undefined>, query: string) =>
    (await createVoiceEligibility(values)(new Request('http://localhost/?account=' + query)).json()).voice;
  assert.equal(await eligible(env, outside.publicKey()), true);
  assert.equal(await eligible(env, outside.publicKey() + '&network=mainnet'), false);
  assert.equal(await eligible(settings, outside.publicKey() + '&network=mainnet'), true);
  assert.equal(await eligible(env, 'invalid'), false);
});

test('voice for mainnet encounters requires the mainnet allowlist before reading or spending', async () => {
  const settings = { ...env, CONTRIB_ALLOWED_ACCOUNTS_MAINNET: b.publicKey() };
  const { handler, order } = fixture({ settings, extraction: async () => ({
    type: 'reunion', title: 'Conversación', summary: 'Revisamos un documento.', contributions: [],
    flagged: false, reason: null,
  }) });
  const input = request({ account: a, path: 'encounter', network: 'mainnet' });
  await expectReason(await handler(input), 403, 'account-not-allowed');
  assert.equal(input.bodyUsed, false);
  assert.deepEqual(order, []);
  const eligible = createVoiceEligibility(settings);
  for (const [key, voice] of [[a, false], [b, true]] as const) {
    const url = 'http://localhost/?kind=encounter&network=mainnet&account=' + key.publicKey();
    assert.deepEqual(await eligible(new Request(url)).json(), { voice });
  }
  assert.equal((await handler(request({ account: b, path: 'encounter', network: 'mainnet' }))).status, 200);
  assert.equal((await handler(request({ account: a, path: 'encounter' }))).status, 200);
});

test('voice signatures are bound to the exact bytes and kind, and Redis claims each once under concurrency', async () => {
  const { handler, order, claims } = fixture();
  await expectReason(await handler(request({ signedAudio: wave(11) })), 401, 'voice-unauthorized');
  const wrongKind = request({ path: 'delivery', signedKind: 'request' });
  await expectReason(await handler(wrongKind), 401, 'voice-unauthorized');
  assert.equal(wrongKind.bodyUsed, false);
  assert.deepEqual(order, []);
  const nonce = '3'.repeat(32);
  const [first, second] = await Promise.all([handler(request({ nonce })), handler(request({ nonce }))]);
  const [ok, replay] = [first, second].sort((left, right) => left.status - right.status);
  assert.equal(ok.status, 200);
  await expectReason(replay, 401, 'voice-unauthorized');
  assert.deepEqual(order, ['claim', 'claim', 'redis', 'transcribe', 'extract']);
  assert.deepEqual([...claims.values()], [validUntil]);
  assert.equal((await handler(request({ nonce: '4'.repeat(32) }))).status, 200);
});

test('a still-valid claim cannot be replayed after the daily quota rolls over', async () => {
  const { handler, advance, stores } = fixture();
  advance(10_790_000);
  const options = { nonce: 'a'.repeat(32), expires: time / 1000 + 10_800 + 20 };
  assert.equal((await handler(request(options))).status, 200);
  advance(15_000);
  await expectReason(await handler(request(options)), 401, 'voice-unauthorized');
  assert.equal(stores.size, 1);
});

test('voice fails closed for missing and malformed allowlists and exposes only eligibility on GET', async () => {
  for (const setting of [undefined, '', ' ', 'invalid', a.publicKey() + ',', a.publicKey() + ', invalid']) {
    const settings = { ...env, CONTRIB_VOICE_ACCOUNTS: setting };
    const { handler, order } = fixture({ settings });
    await expectReason(await handler(request()), 503, 'voice-unavailable');
    assert.deepEqual(order, []);
    assert.deepEqual(await createVoiceEligibility(settings)(new Request('http://localhost/?account=' + a.publicKey())).json(), { voice: false });
  }
  const get = createVoiceEligibility(env);
  for (const network of ['', '&network=mainnet']) {
    assert.deepEqual(await get(new Request('http://localhost/?account=' + a.publicKey() + network)).json(), { voice: true });
  }
  for (const query of ['?account=' + outside.publicKey() + '&network=mainnet', '?network=other&account=' + a.publicKey(),
    '?network=mainnet&network=testnet&account=' + a.publicKey(), '?account=' + a.publicKey() + '&account=no']) {
    assert.deepEqual(await get(new Request('http://localhost/' + query)).json(), { voice: false });
  }
  const burst = new Request('http://localhost/?account=' + a.publicKey(), { headers: { 'x-forwarded-for': '192.0.2.1' } });
  for (let i = 0; i < 120; i++) assert.equal(get(burst).status, 200);
  const limited = get(burst);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.has('Retry-After'));
  assert.deepEqual(await limited.json(), { voice: false });
});

test('voice rejects body size, mislabeled codecs, corrupt audio, duration and silence before charging', async () => {
  const { handler, order } = fixture();
  const oversized = request({ length: VOICE_MAX_BYTES + 1 });
  await expectReason(await handler(oversized), 413, 'voice-too-large');
  assert.equal(oversized.bodyUsed, false);
  await expectReason(await handler(request({ audio: Buffer.alloc(VOICE_MAX_BYTES + 1) })), 413, 'voice-too-large');
  await expectReason(await handler(request({ contentType: 'video/webm' })), 415, 'voice-unsupported-audio');
  await expectReason(await handler(request({ contentType: 'audio/webm;codecs=vorbis' })), 415, 'voice-unsupported-audio');
  await expectReason(await handler(request({ contentType: 'audio/webm;codecs=opus' })), 415, 'voice-unsupported-audio');
  await expectReason(await handler(request({ audio: Buffer.from('RIFF') })), 415, 'voice-unsupported-audio');
  await expectReason(await handler(request({ audio: wave(7) })), 400, 'voice-too-short');
  await expectReason(await handler(request({ audio: wave(121) })), 400, 'voice-too-long');
  await expectReason(await handler(request({ audio: wave(8, true) })), 400, 'voice-silent');
  assert.deepEqual(order, []);
  for (const seconds of [8, 120]) {
    assert.equal((await handler(request({ audio: wave(seconds) }))).status, 200);
  }
  assert.deepEqual(order, ['claim', 'redis', 'transcribe', 'extract', 'claim', 'redis', 'transcribe', 'extract']);
});

test('voice reserves before AI, limits independently by account, day and network, and closes on Redis failure', async () => {
  const { handler, order, advance, stores } = fixture({
    settings: { ...env, CONTRIB_VOICE_DAILY_MAX: '3', CONTRIB_VOICE_ACCOUNT_DAILY_MAX: '2' },
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  await expectReason(await handler(request()), 429, 'voice-quota');
  assert.equal((await handler(request({ account: b }))).status, 200);
  await expectReason(await handler(request({ account: b })), 429, 'voice-quota');
  assert.equal((await handler(request({ network: 'mainnet' }))).status, 200);
  assert.deepEqual([...stores.keys()], ['contributions:testnet:voice-draft:2026-11-23', 'contributions:mainnet:voice-draft:2026-11-23']);
  assert.equal(order.filter(call => call === 'transcribe').length, 4);
  advance();
  assert.equal((await handler(request({ expires: validUntil + 86_400 }))).status, 200);
  const failed = fixture({ unavailable: true });
  await expectReason(await failed.handler(request()), 503, 'voice-unavailable');
  assert.deepEqual(failed.order, ['claim']);
});

test('voice default quotas, including racing reservations, never start an unreserved billable operation', async () => {
  const { handler, order, stores } = fixture();
  const results = await Promise.all(Array.from({ length: 18 }, () => handler(request())));
  assert.equal(results.filter(res => res.status === 200).length, 15);
  assert.equal(results.filter(res => res.status === 429).length, 3);
  for (let i = 0; i < 15; i++) assert.equal((await handler(request({ account: b }))).status, 200);
  assert.equal(order.filter(call => call === 'transcribe').length, 30);
  assert.equal([...stores.values()][0].get('total'), 30);
});

test('voice keeps one reservation for each call reaching AI and never exposes private responses or logs', async t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const methods = [t.mock.method(console, 'log', () => {}), t.mock.method(console, 'error', () => {}),
    t.mock.method(process, 'emitWarning', () => {})];
  const cases = [
    { options: { transcription: async () => { throw Object.assign(new Error(transcript), { statusCode: 502, body: transcript }); } }, status: 503, reason: 'voice-unavailable', extracted: false },
    { options: { transcription: async () => ({ text: '', durationInSeconds: 10 }) }, status: 400, reason: 'voice-silent', extracted: false },
    { options: { extraction: async () => { throw new Error(transcript); } }, status: 503, reason: 'voice-unavailable', extracted: true },
    { options: { extraction: async () => ({ flagged: true, reason: transcript, statement: transcript }) }, status: 422, reason: 'voice-flagged', extracted: true },
    { options: { extraction: async () => ({ flagged: false, reason: transcript, statement: transcript }) }, status: 503, reason: 'voice-unavailable', extracted: true },
  ];
  for (const { options, status, reason, extracted } of cases) {
    const { handler, order, stores } = fixture({ ...options, settings: { ...env, CONTRIB_VOICE_ACCOUNT_DAILY_MAX: '1' } });
    await expectReason(await handler(request()), status, reason);
    assert.equal([...stores.values()][0].get('total'), 1);
    assert.deepEqual(order, extracted ? ['claim', 'redis', 'transcribe', 'extract'] : ['claim', 'redis', 'transcribe']);
    await expectReason(await handler(request()), 429, 'voice-quota');
  }
  for (const method of methods) assert.equal(method.mock.callCount(), 0);
  assert.deepEqual(warnings.mock.calls.map(call => call.arguments), [
    ['voice-draft', { stage: 'transcribe', status: 502 }],
    ['voice-draft', { stage: 'extract', status: 503 }],
    ['voice-draft', { stage: 'extract', status: 503 }],
  ]);
});

test('voice only emits draft fields and checks the details against the transcript', async () => {
  const { handler } = fixture({ extraction: async () => ({
    flagged: false, reason: null, type: 'reunion', title: 'Conversación',
    date: '2026-11-23', where: 'Santiago', summary: 'Conversamos sobre la entrega.',
    contributions: [{ from: 'a', text: 'Presenté el documento.' }, { from: 'someone', text: 'Inventado' }],
    otherName: 'Ana', signer: outside.publicKey(), transcript,
  }) });
  assert.deepEqual(await (await handler(request({ path: 'encounter' }))).json(), { draft: {
    type: 'reunion', title: 'Conversación', date: '2026-11-23', where: 'Santiago', summary: 'Conversamos sobre la entrega.',
    contributions: [{ from: 'a', text: 'Presenté el documento.' }], otherName: 'Ana',
  } });
  const omitted = fixture({ extraction: async () => ({
    flagged: false, reason: null, type: 'invalid', title: 'Conversación',
    date: '2026-11-26', where: 'Roma', summary: 'Hay un documento https://inventado.invalid',
    contributions: [{ from: 'b', text: 'Presentó el documento.' }], otherName: 'Carlos',
  }) });
  assert.deepEqual(await (await omitted.handler(request({ path: 'encounter' }))).json(), { draft: {
    type: '', title: 'Conversación', summary: 'Hay un documento', contributions: [],
  } });
  const lengths = fixture({ extraction: async () => ({
    flagged: false, reason: null, statement: 'a'.repeat(999) + '🐝', comment: 'c'.repeat(300),
  }) });
  assert.deepEqual(await (await lengths.handler(request())).json(), { draft: { statement: 'a'.repeat(999), comment: 'c'.repeat(280) } });
});

test('voice validates a delivered transcription duration even after local measurement and bounds extraction input', async () => {
  for (const [duration, reason] of [[7, 'voice-too-short'], [121, 'voice-too-long'], [NaN, 'voice-invalid-audio']] as const) {
    const { handler, order } = fixture({ transcription: async () => ({ text: transcript, durationInSeconds: duration }) });
    await expectReason(await handler(request()), 400, reason);
    assert.deepEqual(order, ['claim', 'redis', 'transcribe']);
  }
  const { handler } = fixture({
    transcription: async () => ({ text: 'x'.repeat(3999) + '🐝' + 'x'.repeat(50) }),
    extraction: async (_kind, text) => {
      assert.equal(text, 'x'.repeat(3999));
      return { flagged: false, reason: null, statement: 'Listo' };
    },
  });
  assert.equal((await handler(request())).status, 200);
});

test('voice removes links and Stellar keys even when the source contains them', async () => {
  const privateTokens = [a.publicKey(), a.secret(), 'https://example.org', 'www.example.org', 'example.org:8080/x', 'javascript:alert(1)'];
  const unsafe = privateTokens.join(' ');
  const { handler } = fixture({
    transcription: async () => ({ text: `Madrid Ana $10 ${unsafe}` }),
    extraction: async () => ({
      flagged: false, reason: null, type: '', title: `Título ${unsafe}`, summary: `Resumen $10 ${unsafe}`,
      where: unsafe, otherName: a.secret(), contributions: [{ from: 'a', text: `Aporte ${unsafe}` }],
    }),
  });
  assert.deepEqual(await (await handler(request({ path: 'encounter' }))).json(), { draft: {
    type: '', title: 'Título', summary: 'Resumen $10', contributions: [{ from: 'a', text: 'Aporte' }],
  } });
});

test('voice measures PCM samples and rejects WAV with a different codec', () => {
  const bytes = wave();
  assert.deepEqual(readVoiceAudio(bytes, 'audio/wav'), { duration: 10, silent: false });
  bytes.writeUInt16LE(17, 20);
  assert.equal(readVoiceAudio(bytes, 'audio/wav'), null);
});

test('voice rejects a second WAV fmt chunk after data before reserving quota', async () => {
  const original = wave();
  const audio = Buffer.concat([original, original.subarray(12, 36)]);
  audio.writeUInt32LE(audio.length - 8, 4);
  const { handler, order } = fixture();
  await expectReason(await handler(request({ audio })), 415, 'voice-unsupported-audio');
  assert.deepEqual(order, []);
});

test('voice verifies Ogg Opus packets against the declared sample count', () => {
  const page = (index: number, flags: number, count: number, parts: Buffer[]) => {
    const header = Buffer.alloc(27);
    header.write('OggS');
    header[5] = flags;
    header.writeBigUInt64LE(BigInt(count), 6);
    header.writeUInt32LE(1, 14);
    header.writeUInt32LE(index, 18);
    header[26] = parts.length;
    return Buffer.concat([header, Buffer.from(parts.map(packet => packet.length)), ...parts]);
  };
  const opus = Buffer.from('4f707573486561640101380180bb0000000000', 'hex');
  const packets = Array(250).fill(Buffer.from('f8fffe', 'hex'));
  const intro = [
    page(0, 2, 0, [opus]),
    page(1, 0, 0, [Buffer.concat([Buffer.from('OpusTags'), Buffer.alloc(8)])]),
    page(2, 0, 240_000, packets),
  ];
  const audio = Buffer.concat([...intro, page(3, 4, 480_000, packets)]);
  assert.deepEqual(readVoiceAudio(audio, 'audio/ogg'), { duration: 9.9935 });
  const shortened = Buffer.concat([...intro, page(3, 4, 450_000, packets)]);
  assert.equal(readVoiceAudio(shortened, 'audio/ogg'), null);
  opus.write('NotOpus!');
  assert.equal(readVoiceAudio(Buffer.concat([page(0, 2, 0, [opus]), ...intro.slice(1)]), 'audio/ogg'), null);
});

function ebml(id: string, ...parts: Buffer[]) {
  const body = Buffer.concat(parts);
  const unknown = id.endsWith('?');
  assert.ok(unknown || body.length < 0x3fff);
  const size = unknown ? Buffer.from([0xff]) : body.length < 127 ? Buffer.from([0x80 + body.length])
    : Buffer.from([0x40 + (body.length >> 8), body.length & 255]);
  return Buffer.concat([Buffer.from(id.replace(/\?$/, ''), 'hex'), size, body]);
}

const webmHeader = ebml('1a45dfa3', ebml('4282', Buffer.from('webm')));
const opusTracks = ebml('1654ae6b', ebml('ae', ebml('83', Buffer.from([2])), ebml('d7', Buffer.from([1])), ebml('86', Buffer.from('A_OPUS'))));

function webmCluster(timestamp: number, offsets: number[], unknown = true) {
  const clock = Buffer.alloc(4);
  clock.writeUInt32BE(timestamp);
  const blocks = offsets.map(offset => {
    const block = Buffer.from('81000080f8fffe', 'hex');
    block.writeInt16BE(offset, 1);
    return ebml('a3', block);
  });
  return ebml(unknown ? '1f43b675?' : '1f43b675', ebml('e7', clock), ...blocks);
}

test('voice follows every WebM cluster across unknown sizes and intervening Segment children', async () => {
  const first = webmCluster(0, Array.from({ length: 1500 }, (_, i) => i * 20));
  const next = webmCluster(30_000, [0]);
  const cues = ebml('1c53bb6b');
  const clip = (last: Buffer) => Buffer.concat([webmHeader, ebml('18538067?', opusTracks, first, cues, next, last)]);
  assert.deepEqual(readVoiceAudio(clip(webmCluster(39_980, [0], false)), 'audio/webm'), { duration: 40 });
  const audio = clip(webmCluster(1_799_980, [0], false));
  assert.deepEqual(readVoiceAudio(audio, 'audio/webm'), { duration: 1800 });
  const { handler, order } = fixture();
  await expectReason(await handler(request({ contentType: 'audio/webm', audio })), 400, 'voice-too-long');
  assert.deepEqual(order, []);
});

test('voice rejects a second WebM Segment after both bounded and unbounded first segments', async () => {
  const cluster = webmCluster(0, [0]);
  const second = ebml('18538067', opusTracks, cluster);
  const { handler, order } = fixture();
  for (const id of ['18538067', '18538067?']) {
    const audio = Buffer.concat([webmHeader, ebml(id, opusTracks, cluster), second]);
    await expectReason(await handler(request({ contentType: 'audio/webm', audio })), 415, 'voice-unsupported-audio');
  }
  assert.deepEqual(order, []);
});

test('voice rejects laced WebM locally before reserving quota', async () => {
  const cluster = ebml('1f43b675', ebml('e7', Buffer.from([0])),
    ebml('a3', Buffer.from('810000820103f8fffef8fffe', 'hex')));
  const audio = Buffer.concat([webmHeader, ebml('18538067', opusTracks, cluster)]);
  const { handler, order } = fixture();
  await expectReason(await handler(request({ contentType: 'audio/webm', audio })), 415, 'voice-unsupported-audio');
  assert.deepEqual(order, []);
});

function box(id: string, ...parts: Buffer[]) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + parts.reduce((length, part) => length + part.length, 0));
  header.write(id, 4);
  return Buffer.concat([header, ...parts]);
}

function words(...values: number[]) {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => data.writeUInt32BE(value, index * 4));
  return data;
}

function aac(timing: Buffer, payloadSize = 4000, fragment?: Buffer, extra: Buffer[] = []) {
  const header = box('mdhd', words(0, 0, 0, 1000, 20_000, 0));
  const handler = box('hdlr', words(0, 0), Buffer.from('soun'));
  const codec = box('esds', Buffer.from('000000000306000000040140', 'hex'));
  const samples = box('stsd', words(0, 1), box('mp4a', Buffer.alloc(28), codec));
  const table = box('minf', box('stbl', samples, box('stts', timing), ...extra));
  const movie = box('moov', box('trak', box('mdia', header, handler, table)));
  return Buffer.concat([box('ftyp'), movie, ...(fragment ? [fragment] : []), box('mdat', Buffer.alloc(payloadSize))]);
}

test('voice sums the MP4 stts entries instead of taking the mdhd duration', async () => {
  assert.deepEqual(readVoiceAudio(aac(words(0, 2, 19, 1000, 1, 1000)), 'audio/mp4'), { duration: 20 });
  const audio = aac(words(0, 2, 600, 1000, 99, 1000));
  assert.deepEqual(readVoiceAudio(audio, 'audio/mp4'), { duration: 699 });
  const { handler, order } = fixture();
  await expectReason(await handler(request({ contentType: 'audio/mp4', audio })), 400, 'voice-too-long');
  assert.deepEqual(order, []);
});

test('voice checks byte-duration coherence for compressed formats before reserving measured audio', async () => {
  const { handler, order } = fixture();
  const mp4 = aac(words(0, 1, 1, 30_000), 16);
  const webm = Buffer.concat([webmHeader, ebml('18538067', opusTracks, webmCluster(0, [0, 29_980]))]);
  for (const [audio, contentType] of [[mp4, 'audio/mp4'], [webm, 'audio/webm']] as const) {
    assert.deepEqual(readVoiceAudio(audio, contentType), { duration: 30 });
    await expectReason(await handler(request({ contentType, audio })), 400, 'voice-invalid-audio');
  }
  const tooDense = aac(words(0, 1, 8, 1000), 1_000_000);
  await expectReason(await handler(request({ contentType: 'audio/mp4', audio: tooDense })), 400, 'voice-invalid-audio');
  assert.deepEqual(order, []);
});

test('fragmented MP4 without local timing still requires a coherent provider duration', async () => {
  const audio = aac(words(0, 0), 4000, box('moof', box('traf', box('tfhd', words(0, 1)), box('trun', words(0, 10)))));
  assert.deepEqual(readVoiceAudio(audio, 'audio/mp4'), { duration: undefined });
  const { handler } = fixture();
  assert.equal((await handler(request({ audio, contentType: 'audio/mp4' }))).status, 200);
  const noDuration = fixture({ transcription: async () => ({ text: transcript }) });
  await expectReason(await noDuration.handler(request({ audio, contentType: 'audio/mp4' })), 400, 'voice-invalid-audio');
});

test('voice rejects a repeated stts table, whichever copy a decoder would read', () => {
  assert.equal(readVoiceAudio(aac(words(0, 1, 20, 1000), 4000, undefined, [box('stts', words(0, 1, 699, 1000))]), 'audio/mp4'), null);
});

test('voice keeps words that only look like hosts', async () => {
  const spoken = 'Usamos Node.js en EE.UU. Terminé.Gracias';
  const { handler } = fixture({
    transcription: async () => ({ text: spoken }),
    extraction: async () => ({ flagged: false, reason: null, type: '', title: spoken, summary: spoken + ' vespi.xyz/app', contributions: [] }),
  });
  const { draft } = await (await handler(request({ path: 'encounter' }))).json();
  assert.equal(draft.title, spoken);
  assert.equal(draft.summary, spoken);
});
