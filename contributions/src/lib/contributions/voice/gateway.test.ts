import assert from 'node:assert/strict';
import { test } from 'node:test';

type Schema = {
  type: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
};

function checkStrict(schema: Schema) {
  for (const key of Object.keys(schema)) {
    assert.ok(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum'].includes(key), key);
  }
  if (schema.enum) assert.equal(schema.type, 'string');
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false);
    assert.ok(schema.properties);
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
    for (const field of Object.values(schema.properties)) checkStrict(field);
  } else if (schema.type === 'array') {
    assert.ok(schema.items);
    checkStrict(schema.items);
  } else {
    assert.ok(schema.type === 'string' || schema.type === 'boolean' || JSON.stringify(schema.type) === '["string","null"]');
  }
}

test('voice sends OpenAI-compatible strict schemas and applies the documented Gateway privacy options', async t => {
  t.mock.method(process, 'emitWarning', () => {});
  const environment = ['AI_GATEWAY_API_KEY', 'CONTRIB_VOICE_ZERO_DATA_RETENTION'];
  const previous = environment.map(name => process.env[name]);
  t.after(() => {
    for (const [index, name] of environment.entries()) {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
  });
  process.env.AI_GATEWAY_API_KEY = 'synthetic-fixture-key';
  const calls: { path: string; body: { providerOptions: object; responseFormat?: { type: string; schema: Schema } } }[] = [];
  const marker = 'Synthetic transcript';
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(String(init.body)) });
    if (path.endsWith('/transcription-model')) return Response.json({ text: marker, durationInSeconds: 12 });
    assert.ok(path.endsWith('/language-model'));
    return Response.json({
      content: [{ type: 'text', text: '{}' }], finishReason: { unified: 'stop' },
      usage: { inputTokens: { total: 12 }, outputTokens: { total: 5 } },
    });
  });
  const { transcribeVoice, extractVoice }: typeof import('./gateway') = await import(new URL('gateway.ts', import.meta.url).href);
  const signal = AbortSignal.timeout(5000);
  delete process.env.CONTRIB_VOICE_ZERO_DATA_RETENTION;
  const { text } = await transcribeVoice(Buffer.from('RIFF'), 'audio/wav', signal);
  assert.equal(text, marker);
  for (const kind of ['request', 'delivery', 'encounter'] as const) await extractVoice(kind, text, signal);
  // Transcription also names the expected languages; both calls refuse storage.
  const openai = (body: { responseFormat?: unknown }) => body.responseFormat ? { store: false } : { store: false, languages: ['es', 'en'] };
  for (const { body } of calls) {
    assert.deepEqual(body.providerOptions, { openai: openai(body), gateway: { disallowPromptTraining: true } });
  }
  for (const { body } of calls.slice(1)) {
    assert.equal(body.responseFormat?.type, 'json');
    checkStrict(body.responseFormat.schema);
    const fields = body.responseFormat.schema.properties!;
    for (const field of ['reason', ...(fields.statement ? ['comment'] : ['date', 'where', 'otherName'])]) {
      assert.deepEqual(fields[field].type, ['string', 'null']);
    }
  }
  process.env.CONTRIB_VOICE_ZERO_DATA_RETENTION = 'true';
  await transcribeVoice(Buffer.from('RIFF'), 'audio/wav', signal);
  await extractVoice('request', text, signal);
  assert.equal(calls.length, 6);
  for (const { body } of calls.slice(-2)) {
    assert.deepEqual(body.providerOptions, {
      openai: openai(body), gateway: { disallowPromptTraining: true, zeroDataRetention: true },
    });
  }
});

test('voice spells the brand name and leaves other words alone', async () => {
  const { spellNames }: typeof import('./gateway') = await import(new URL('gateway.ts', import.meta.url).href);
  assert.equal(spellNames('Bespi y BESPI, con vespy. Vespie: vespi'), 'Vespi y Vespi, con Vespi. Vespi: Vespi');
  assert.equal(spellNames('La vespa, Vespino, respiro, abespié'), 'La vespa, Vespino, respiro, abespié');
});
