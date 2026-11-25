import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Account, BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { chromium } from 'playwright';
import { assignmentMessage } from '../src/lib/contributions/contribution-assignment.ts';
import { canonicalBytes } from '../src/lib/contributions/kernel/contributions.js';
import { buildOnboardingTx } from '../src/lib/contributions/stellar-server.ts';
import { mockVoice, proposals, recordVoice, voiceChromium, voiceEnabled, voiceHidden } from './fixtures/contributions-voice.mjs';

const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3276';
const phase91 = process.env.VESPI_PHASE_91 === '1';
const captureDir = phase91 || !voiceEnabled || process.env.VESPI_COMPOSER_EVIDENCE ? process.env.VESPI_CAPTURES : undefined;
const evidence = process.env.VESPI_COMPOSER_EVIDENCE;
const baseline = evidence === 'antes';
const voiceEvidence = process.env.VESPI_COMPOSER_VOICE_EVIDENCE === '1';
const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM, args: voiceChromium,
  ignoreDefaultArgs: ['--disable-back-forward-cache'] });
const sponsor = Keypair.random();
const channel = Keypair.random();
const people = new Map();
const enabled = new Set();
const active = new Set();
const resetAccounts = new Set();
const pending = new Map();
const blocked = [];
const networks = {
  testnet: { passphrase: Networks.TESTNET, horizon: 'https://horizon-testnet.stellar.org', records: new Map(), heads: new Map() },
  mainnet: { passphrase: Networks.PUBLIC, horizon: 'https://horizon.stellar.org', records: new Map(), heads: new Map() },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (route, data, status = 200) => route.fulfill({
  json: data, status, headers: { 'Access-Control-Allow-Origin': '*' },
});
const warning = {
  es: 'Esto queda en Stellar mainnet de forma permanente y se publica con su recibo.',
  en: 'This stays on Stellar mainnet permanently and is published with its receipt.',
};
const ineligibleMainnet = 'Esta cuenta no está habilitada para firmar en Stellar mainnet.';
let deny;
let retryRequest;
let pauseVoice;
let rejectVoiceOnce = false;

function verifies(xdr, actor, network) {
  const signed = TransactionBuilder.fromXDR(xdr, networks[network].passphrase);
  const other = TransactionBuilder.fromXDR(xdr, networks[network === 'mainnet' ? 'testnet' : 'mainnet'].passphrase);
  const signature = signed.signatures[0].signature();
  assert.ok(Keypair.fromPublicKey(actor).verify(signed.hash(), signature));
  assert.equal(Keypair.fromPublicKey(actor).verify(other.hash(), signature), false);
  return signed;
}

async function phone({ name, allow = false, network = 'testnet', width = 375, height = 629, theme = 'light', lang = 'es', hasPrf = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true,
    colorScheme: theme, locale: lang === 'es' ? 'es-CL' : 'en-US', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const calls = new Map();
  await context.exposeBinding('countWebAuthn', ({ page }, method) => {
    const counts = calls.get(page) ?? { get: 0, create: 0 };
    counts[method]++;
    calls.set(page, counts);
  });
  await context.addInitScript(({ theme, lang }) => {
    if (!localStorage.getItem('vespi-theme')) localStorage.setItem('vespi-theme', theme);
    if (!localStorage.getItem('vespi-lang')) localStorage.setItem('vespi-lang', lang);
    const credentials = navigator.credentials;
    if (credentials) for (const method of ['get', 'create']) {
      const original = credentials[method].bind(credentials);
      credentials[method] = (...args) => {
        void window.countWebAuthn(method);
        return original(...args);
      };
    }
    Object.defineProperty(navigator, 'share', { value: async ({ url }) => { window.lastVespiShare = url; } });
  }, { theme, lang });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split('/').slice(3);
    const [area, operation] = endpoint;
    if (url.origin === origin && !url.pathname.startsWith('/api/contributions/')) return route.continue();
    if (url.origin === networks[network].horizon) {
      const [, collection, id] = url.pathname.split('/');
      if (collection === 'accounts') {
        if (network === 'mainnet' && !active.has(id)) return json(route, {}, 404);
        if (network === 'testnet' && resetAccounts.has(id)) return json(route, {}, 404);
        return json(route, { sequence: '123' });
      }
      const result = [...networks[network].records.values()].find(item => item.index.txHash === id);
      assert.equal(collection, 'transactions');
      assert.ok(result);
      return json(route, { successful: true, hash: id, ledger: result.index.ledger, envelope_xdr: result.xdr });
    }
    if (url.origin !== origin) {
      if (url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') blocked.push(url.origin);
      return route.abort();
    }
    const selected = url.searchParams.get('network') ?? 'testnet';
    const fail = area === 'voice-draft' && rejectVoiceOnce;
    if (fail) rejectVoiceOnce = false;
    if (await mockVoice(route, account => account === people.get(name) && (allow || name?.startsWith('testnet')), network,
      { pause: pauseVoice, fail })) return;
    const body = route.request().postDataJSON();
    if (area === 'encounters' && body?.action === 'logout') return json(route, { ok: true });
    if (area === 'encounters' && !body) return json(route, { ok: true, cursor: '0', entries: [] });
    if (area === 'network') {
      return json(route, { mainnet: enabled.has(url.searchParams.get('account')) });
    }
    if (area === 'profiles' || (area === 'account' && selected === 'testnet')) {
      assert.equal(url.searchParams.has('network'), false);
      if (area === 'profiles') {
        if (!operation) return json(route, { cursor: '0', entries: [...people]
          .filter(([account]) => account.startsWith('G')).map(([account, displayName]) => ({ account, displayName })) });
        assert.ok(people.has(operation));
        return json(route, { account: operation, displayName: people.get(operation) });
      }
      assert.equal(body.action, 'prepare');
      if (people.has(name)) assert.equal(people.get(name), body.publicKey);
      people.set(name, body.publicKey);
      people.set(body.publicKey, name);
      if (allow) enabled.add(body.publicKey);
      return json(route, { ok: false, reason: 'already-onboarded' }, 409);
    }
    if (area === 'activity' && network === 'mainnet' && selected === 'testnet') {
      // The signed-in dashboard initially lists testnet, before following the mainnet link.
      return json(route, { cursor: '0', entries: [] });
    }
    assert.equal(url.searchParams.get('network'), network === 'mainnet' ? 'mainnet' : null,
      'Chain request network for ' + url.pathname);
    const { records, heads, passphrase } = networks[selected];
    if (area === 'account') {
      if (body.action === 'prepare') {
        if (deny === 'account-not-allowed') return json(route, { ok: false, reason: deny }, 403);
        assert.ok(enabled.has(body.publicKey));
        assert.equal(active.has(body.publicKey), false);
        const tx = buildOnboardingTx({ channel: new Account(channel.publicKey(), '0'),
          sponsor: sponsor.publicKey(), newAccount: body.publicKey, baseFee: BASE_FEE, timeoutSeconds: 60 }, network);
        pending.set(body.publicKey, tx.hash().toString('hex'));
        return json(route, { ok: true, token: body.publicKey, xdr: tx.toXDR() });
      }
      assert.equal(body.action, 'complete');
      const signed = verifies(body.xdr, body.token, network);
      assert.equal(signed.hash().toString('hex'), pending.get(body.token));
      active.add(body.token);
      return json(route, { ok: true });
    }
    if (area === 'activity') {
      const entries = [...records.values()].filter(item => item.draft.actor === operation).map(({ draft, index }) => {
        const root = draft.chain ?? index.digest;
        const { index: head, draft: end } = heads.get(root);
        return { root, digest: index.digest, head: head.digest, state: end.kind, action: draft.kind,
          statement: draft.statement, context: records.get(root).draft.statement, createdAt: draft.createdAt };
      });
      return json(route, { cursor: '0', entries });
    }
    if (area === 'chains') {
      const { index, draft } = heads.get(operation);
      return json(route, { request: operation, head: index.digest, kind: draft.kind });
    }
    assert.equal(area, 'receipts');
    if (operation === 'prepare') {
      if (deny && deny !== 'account-not-allowed') return json(route, { ok: false, reason: deny }, deny === 'mainnet-unavailable' ? 503 : 400);
      const bytes = canonicalBytes(body);
      return json(route, { ok: true, bytes, digest: hash(bytes) });
    }
    if (operation === 'anchor') {
      const { bytes, xdr, assignment } = body;
      const draft = JSON.parse(bytes);
      const inner = verifies(xdr, draft.actor, network);
      const digest = hash(bytes);
      assert.equal(inner.source, draft.actor);
      assert.equal(inner.memo.value.toString('hex'), digest);
      if (network === 'mainnet') assert.ok(active.has(draft.actor));
      if (!evidence && network === 'mainnet' && draft.kind === 'REQUEST') {
        if (!retryRequest) {
          retryRequest = { bytes, xdr };
          return json(route, { ok: false, reason: 'anchor-pending' }, 409);
        }
        assert.deepEqual({ bytes, xdr }, retryRequest);
      }
      if (draft.kind !== 'REQUEST') {
        assert.equal(draft.prev, heads.get(draft.chain).index.digest);
        const requester = records.get(draft.chain).draft.actor;
        if (draft.kind === 'CONTRIBUTE') {
          assert.notEqual(draft.actor, requester);
          assert.ok(Keypair.fromPublicKey(requester).verify(Buffer.from(assignmentMessage(draft.chain, draft.actor, network)),
            Buffer.from(assignment, 'hex')));
        } else {
          assert.equal(draft.kind, 'ACCEPT');
          assert.equal(draft.actor, requester);
          assert.equal(draft.subject, draft.prev);
        }
      }
      const tx = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, passphrase);
      tx.sign(sponsor);
      const index = { digest, txHash: tx.hash().toString('hex'), ledger: 12345, rehearsal: network === 'testnet' };
      const record = { draft, bytes, index, xdr: tx.toXDR() };
      records.set(digest, record);
      heads.set(draft.chain ?? digest, record);
      return json(route, { ok: true, index });
    }
    const record = records.get(operation);
    assert.ok(record);
    return url.searchParams.get('format') === 'index' ? json(route, record.index)
      : route.fulfill({ body: record.bytes, contentType: 'application/json' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf } });
  page.auth = () => ({ get: 0, create: 0, ...calls.get(page) });
  return page;
}

function button(page, name) { return page.getByRole('button', { name, exact: true }); }
function link(page, name) { return page.getByRole('link', { name, exact: true }); }
function goto(page, path) { return page.goto(new URL(path, origin).href, { waitUntil: 'domcontentloaded' }); }
async function share(page, label, network) {
  await button(page, label).click();
  const url = await page.evaluate(() => window.lastVespiShare);
  assert.equal(new URL(url).searchParams.get('network'), network === 'mainnet' ? 'mainnet' : null);
  return url;
}

async function signIn(page, name) {
  await goto(page, '/app?vista=aportes&lang=es');
  await button(page, 'Crear una passkey').click();
  await page.getByLabel('Nombre para tu passkey').fill(name);
  await button(page, 'Crear una passkey').click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function snapshot(page, label) {
  const { width } = page.viewportSize();
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth), width);
  if (width === 375) {
    const results = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(results.violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)]), []);
  }
  if (captureDir) await page.screenshot({ path: join(captureDir, label + '.png'), fullPage: true });
}

async function checkWarning(page, lang, account, statement, comment) {
  const disclosure = page.locator('.mobile-mainnet-notice');
  await expect(disclosure.getByText(warning[lang], { exact: true })).toBeVisible();
  await expect(disclosure.getByText(account, { exact: true })).toBeVisible();
  await expect(page.locator('.mobile-content blockquote').getByText(statement, { exact: true })).toBeVisible();
  if (comment) await expect(page.locator('.mobile-content .mobile-public-comment').getByText(comment, { exact: true })).toBeVisible();
  await expect(page.locator('.mobile-network-label')).toContainText('Mainnet');
}

async function acceptanceMatrix(page, account) {
  for (const lang of ['es', 'en']) {
    if (lang === 'en') await button(page, 'Read in English').click();
    const statement = lang === 'es' ? 'Acepto este aporte.' : 'I accept this contribution.';
    for (const theme of ['claro', 'oscuro']) {
      const target = theme === 'claro' ? 'light' : 'dark';
      if (await page.locator('html').getAttribute('data-theme') !== target) await page.locator('.theme-switch').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', target);
      await checkWarning(page, lang, account, statement);
      for (const [width, height] of [[375, 629], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await snapshot(page, `mainnet-aceptacion-${width}-${theme}-${lang}`);
      }
    }
  }
}

async function chain(network) {
  const mainnet = network === 'mainnet';
  const asker = network + ' solicitante';
  const helper = network + ' participante';
  const a = await phone({ name: asker, allow: mainnet, network });
  const b = await phone({ name: helper, allow: mainnet, network });
  const counts = [];
  async function count(page, step, action, expected = 0) {
    const before = page.auth().get;
    await action();
    const delta = page.auth().get - before;
    assert.equal(delta, expected, network + ' ' + step);
    counts.push([step, delta]);
  }
  await signIn(a, asker);
  await signIn(b, helper);
  assert.deepEqual(a.auth(), { get: 0, create: 1 });
  assert.deepEqual(b.auth(), { get: 0, create: 1 });
  await captureMatrix(a, network, 'historial');
  await link(a, '¿Necesitas ayuda? Pide un aporte').click();
  await a.getByLabel('Escribe tu solicitud').fill('Revisa el documento público.');
  if (mainnet) {
    const selector = a.getByRole('dialog', { name: 'Red de Stellar' });
    const switchNetwork = async (from, to) => {
      await button(a, from + ', cambiar red').click();
      await expect(selector.getByRole('radio', { name: from })).toBeChecked();
      await selector.getByRole('radio', { name: to }).check();
      await button(selector, 'Continuar').click();
    };
    await button(a, 'Testnet, cambiar red').click();
    await expect(selector.getByRole('radio', { name: 'Testnet' })).toBeChecked();
    await snapshot(a, 'selector-de-red-375-claro-es');
    await button(selector, 'Cancelar').click();
    await switchNetwork('Testnet', 'Mainnet');
    await expect(a).toHaveURL(origin + '/app?vista=aportes&lang=es&accion=pedir&network=mainnet');
    await switchNetwork('Mainnet', 'Testnet');
    await expect(a).toHaveURL(origin + '/app?vista=aportes&lang=es&accion=pedir');
    await expect(a.getByLabel('Escribe tu solicitud')).toHaveValue('Revisa el documento público.');
    await switchNetwork('Testnet', 'Mainnet');
    await expect(a.getByLabel('Escribe tu solicitud')).toHaveValue('');
    await a.getByLabel('Escribe tu solicitud').fill('Revisa el documento público.');
  } else {
    await expect(button(a, 'Testnet, cambiar red')).toHaveCount(0);
  }
  if (voiceEnabled) {
    const beforeVoice = a.auth().get;
    const pause = Promise.withResolvers();
    pauseVoice = pause.promise;
    rejectVoiceOnce = mainnet;
    await recordVoice(a, network + '-solicitud', {
      inspect: mainnet, resume: pause.resolve, field: a.getByLabel('Escribe tu solicitud'),
      typedDuringWait: 'Lo que escribí durante la espera.', choice: mainnet ? 'Reemplazar' : 'Agregar al final',
      expected: (mainnet ? '' : 'Lo que escribí durante la espera.\n\n') + proposals.request.statement,
      edit: 'Revisa el documento público.',
      expectFailure: mainnet ? 'Revisa el documento público.' : undefined,
    });
    assert.equal(a.auth().get, beforeVoice);
    pauseVoice = undefined;
    await expect(a.getByLabel('Comentario opcional')).toHaveValue(proposals.request.comment);
  } else {
    await a.getByText('Más detalles', { exact: true }).click();
    await a.getByLabel('Comentario opcional').fill('Mira el ejemplo.');
  }
  await count(a, 'recarga-redactar', async () => {
    await a.reload();
    await expect(a.getByLabel('Escribe tu solicitud')).toHaveValue('Revisa el documento público.');
  });
  await button(a, 'Continuar').click();
  await count(a, 'recarga-revision', async () => {
    await a.reload();
    await expect(a.getByRole('heading', { name: 'Revisa tu solicitud' })).toBeVisible();
  });
  if (mainnet) {
    await checkWarning(a, 'es', people.get(asker), 'Revisa el documento público.', 'Mira el ejemplo.');
    await snapshot(a, 'mainnet-solicitud-375-claro-es');
    for (const [reason, message] of [
      ['mainnet-unavailable', 'Stellar mainnet no está disponible ahora.'],
      ['account-not-allowed', 'Esta cuenta no está habilitada para firmar en Stellar mainnet.'],
      ['mainnet-not-supported', 'Este paso solo está disponible en testnet.'],
    ]) {
      deny = reason;
      await button(a, 'Firmar').click();
      await expect(a.locator('.mobile-message[role="alert"]')).toHaveText(message);
      await expect(link(a, 'Seguir en testnet')).toBeVisible();
      assert.equal(await link(a, 'Seguir en testnet').getAttribute('href'), '/app?vista=aportes');
      assert.equal(active.size, 0);
    }
    deny = undefined;
  }
  const beforeRequest = a.auth().get;
  await button(a, 'Firmar').click();
  if (mainnet) {
    const actor = people.get(asker);
    await expect(a.locator('.mobile-message[role="alert"]')).toHaveText('La firma todavía está pendiente de confirmación.');
    const saved = await a.evaluate(account => {
      const key = 'vespi-contributions:pending:' + account;
      return { testnet: localStorage.getItem(key), mainnet: JSON.parse(localStorage.getItem(key + ':mainnet')) };
    }, actor);
    assert.equal(saved.testnet, null);
    assert.deepEqual(saved.mainnet, { ...retryRequest, digest: hash(retryRequest.bytes), network });
    const selectedUrl = a.url();
    await link(a, 'Vespi Contributions').click();
    await expect(a).toHaveURL(origin + '/app');
    await a.goBack();
    await expect(a).toHaveURL(selectedUrl);
    await expect(a.locator('.mobile-network-label')).toContainText('Mainnet');
    await a.reload({ waitUntil: 'domcontentloaded' });
    const count = a.auth().get;
    await checkWarning(a, 'es', actor, 'Revisa el documento público.', 'Mira el ejemplo.');
    await expect(link(a, 'Enlace de esta solicitud')).toHaveAttribute('href', /&network=mainnet$/);
    await button(a, 'Comprobar de nuevo').click();
    await expect(link(a, 'Abrir recibo público')).toBeVisible();
    assert.equal(a.auth().get, count);
  }
  await expect(link(a, 'Abrir recibo público')).toBeVisible();
  assert.equal(a.auth().get - beforeRequest, mainnet ? Number(!beforeRequest) : 0);
  counts.push(['firmar-solicitud', a.auth().get - beforeRequest]);
  await captureMatrix(a, network, 'solicitud-lista');
  const requestUrl = await share(a, 'Compartir solicitud', network);
  if (mainnet) {
    const anon = await phone({ network, width: 390, height: 844, theme: 'dark', lang: 'en' });
    await goto(anon, requestUrl + '&lang=en');
    await expect(anon.getByText('Revisa el documento público.', { exact: true })).toBeVisible();
    await expect(anon.locator('.mobile-network-label')).toHaveText('Mainnet');
    await snapshot(anon, 'mainnet-solicitud-anonima-390-oscuro-en');
    await anon.context().close();
    await goto(b, requestUrl);
    await expect(b.getByText('Revisa el documento público.', { exact: true })).toBeVisible();
    await expect(b.locator('.mobile-network-label')).toHaveText('Mainnet');
  }
  await button(a, 'Invita a quien entrega').click();
  if (mainnet) {
    const guest = await phone({ name: 'Participante sin habilitación', network });
    await signIn(guest, 'Participante sin habilitación');
    const account = people.get('Participante sin habilitación');
    const input = a.getByLabel('Cuenta de quien entrega (G…)');
    await input.fill(account);
    await button(a, 'Comprobar cuenta').click();
    await expect(a.locator('.mobile-message[role="alert"]')).toHaveText(ineligibleMainnet);
    await expect(button(a, 'Firmar autorización de entrega')).toHaveCount(0);
    await snapshot(a, '77-1-cuenta-pegada');

    await button(a, 'Buscar por nombre').click();
    await a.getByLabel('Nombre o cuenta G').fill('sin habilitación');
    await a.getByRole('button', { name: /^Participante sin habilitación · / }).click();
    await expect(a.locator('.mobile-message[role="alert"]')).toHaveText(ineligibleMainnet);
    await expect(button(a, 'Firmar autorización de entrega')).toHaveCount(0);
    await snapshot(a, '77-1-cuenta-buscada');

    await goto(guest, '/app?vista=aportes&accion=pedir&lang=es&network=mainnet');
    const count = guest.auth().get;
    await expect(guest).toHaveURL(origin + '/app?vista=aportes&accion=pedir&lang=es&network=mainnet');
    await expect(guest.getByLabel('Escribe tu solicitud')).toHaveCount(0);
    await expect(guest.locator('.mobile-message[role="alert"]')).toHaveText(ineligibleMainnet);
    await expect(guest.locator('.mobile-network-label')).toContainText('Mainnet');
    assert.equal(guest.auth().get, count);
    await expect(button(guest, 'Mainnet')).toHaveCount(0);
    if (voiceEnabled) await voiceHidden(guest);
    await snapshot(guest, '87-compositor-sin-selector');
    assert.equal(guest.auth().get, count);
    await guest.context().close();
  }
  await a.getByLabel('Cuenta de quien entrega (G…)').fill(people.get(helper));
  await button(a, 'Comprobar cuenta').click();
  if (mainnet) await checkWarning(a, 'es', people.get(asker), 'Revisa el documento público.', 'Mira el ejemplo.');
  await captureMatrix(a, network, 'autorizar');
  const beforeAssignment = a.auth().get;
  await button(a, 'Firmar autorización de entrega').click();
  const invitation = await share(a, 'Invitar a entregar', network);
  const assignmentGets = a.auth().get - beforeAssignment;
  assert.ok(assignmentGets <= (mainnet ? 1 : 0));
  counts.push(['autorizar', assignmentGets]);
  await count(a, 'recarga-autorizacion', async () => {
    await a.reload();
    await expect(button(a, 'Invitar a entregar')).toBeVisible();
  });
  assert.match(invitation, /#assignment=[a-f0-9]{128}$/);
  await goto(b, invitation);
  if (mainnet) {
    enabled.delete(people.get(helper));
    await b.reload({ waitUntil: 'domcontentloaded' });
    await expect(b.locator('.mobile-message[role="alert"]')).toHaveText(ineligibleMainnet);
    await expect(b.getByLabel('Describe el aporte que entregas')).toHaveCount(0);
    await expect(link(b, 'Seguir en testnet')).toHaveCount(0);
    await expect(b).toHaveURL(invitation);
    await snapshot(b, '77-1-invitacion-mainnet');
    enabled.add(people.get(helper));
    await b.reload({ waitUntil: 'domcontentloaded' });
  }
  const deliveryField = b.getByLabel('Describe el aporte que entregas');
  if (voiceEnabled) {
    const beforeVoice = b.auth().get;
    if (mainnet) {
      await deliveryField.fill('Dejé comentarios en el documento.');
      await recordVoice(b, network + '-entrega-descartada', { field: deliveryField, choice: 'Descartar' });
    }
    await recordVoice(b, network + '-entrega', {
      field: deliveryField, choice: mainnet ? 'Reemplazar' : undefined,
      expected: proposals.delivery.statement, edit: 'Dejé comentarios en el documento.',
    });
    assert.equal(b.auth().get, beforeVoice);
  } else await deliveryField.fill('Dejé comentarios en el documento.');
  await count(b, 'recarga-entrega', async () => {
    await b.reload();
    await expect(deliveryField).toHaveValue('Dejé comentarios en el documento.');
  });
  await captureMatrix(b, network, 'entrega');
  await button(b, 'Continuar').click();
  await count(b, 'recarga-revision-entrega', async () => {
    await b.reload();
    await expect(button(b, 'Firmar entrega')).toBeVisible();
  });
  if (mainnet) {
    await checkWarning(b, 'es', people.get(helper), 'Dejé comentarios en el documento.');
    await snapshot(b, 'mainnet-entrega-375-claro-es');
  }
  await captureMatrix(b, network, 'revision-entrega');
  const beforeDelivery = b.auth().get;
  await button(b, 'Firmar entrega').click();
  await expect(button(b, 'Enviar para revisión')).toBeVisible();
  assert.equal(b.auth().get - beforeDelivery, mainnet ? 1 : 0);
  counts.push(['firmar-entrega', b.auth().get - beforeDelivery]);
  await captureMatrix(b, network, 'entrega-lista');
  const delivery = await share(b, 'Enviar para revisión', network);
  await count(a, 'recarga-aceptacion', async () => {
    await goto(a, delivery);
    await a.reload();
    await expect(button(a, 'Aceptar y firmar')).toBeVisible();
  });
  await captureMatrix(a, network, 'aceptar');
  if (mainnet) await acceptanceMatrix(a, people.get(asker));
  const beforeAccept = a.auth().get;
  await button(a, mainnet ? 'Accept and sign' : 'Aceptar y firmar').click();
  const receipt = link(a, mainnet ? 'Open receipt' : 'Abrir recibo');
  await expect(receipt).toBeVisible();
  assert.equal(a.auth().get - beforeAccept, mainnet ? 1 : 0);
  counts.push(['firmar-aceptacion', a.auth().get - beforeAccept]);
  assert.equal(new URL(await receipt.getAttribute('href'), origin).searchParams.get('network'), mainnet ? 'mainnet' : null);
  await receipt.click();
  const explorer = mainnet ? 'public' : 'testnet';
  await expect(a.locator('a[href^="https://stellar.expert/explorer/' + explorer + '/tx/"]')).toHaveCount(4);
  if (phase91) {
    await count(a, 'recarga-recibo', async () => {
      await a.reload();
      await expect(a.locator('a[href^="https://stellar.expert/explorer/' + explorer + '/tx/"]')).toHaveCount(4);
    });
    if (!mainnet) await captureMatrix(a, network, 'recibo');
  }
  if (mainnet) {
    assert.equal(active.size, 2);
    await expect(a.locator('a[href*="observe="]')).toHaveCount(0);
    await link(a, 'My contributions').click();
    await expect(a.getByRole('heading', { name: 'Ready', exact: true })).toBeVisible();
    for (const item of await a.getByRole('link', { name: 'View record', exact: true }).all()) {
      assert.match(await item.getAttribute('href'), /[?&]network=mainnet/);
    }
    await snapshot(a, 'mainnet-mis-aportes-390-oscuro-en');
  }
  const drafts = [...networks[network].records.values()].map(item => item.draft);
  assert.deepEqual(drafts.map(draft => draft.kind), ['REQUEST', 'CONTRIBUTE', 'ACCEPT']);
  if (voiceEnabled) {
    assert.equal(drafts[0].statement, (mainnet ? '' : 'Ensayo: ') + 'Revisa el documento público.');
    assert.equal(drafts[1].statement, 'Dejé comentarios en el documento.');
  }
  console.log(network + ': REQUEST → CONTRIBUTE → ACCEPT, XDR y memo verificados');
  console.log(JSON.stringify({ network, alta: [a.auth().create, b.auth().create], webauthn: counts }));
  await a.context().close();
  await b.context().close();
}

async function captureMatrix(page, network, screen, prepare) {
  if (!captureDir) return;
  const variants = [[375, 629], [390, 844]];
  for (const lang of ['es', 'en']) {
    if (lang === 'en') await button(page, 'Read in English').click();
    await prepare?.(lang);
    for (const [theme, color] of [['claro', 'light'], ['oscuro', 'dark']]) {
      if (await page.locator('html').getAttribute('data-theme') !== color) await page.locator('.theme-switch').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', color);
      for (const [width, height] of variants) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0,0));
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth), width);
        if (!baseline) {
          const result = await new AxeBuilder({ page }).analyze();
          const label = [network, screen, width, theme, lang].join('/');
          assert.deepEqual(result.violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)]), [], label);
          const hitTargets = await page.locator('.mobile-contributions :is(a[href], button, summary, input, textarea)').evaluateAll(nodes =>
            nodes.flatMap(node => {
              const bounds = node.getBoundingClientRect();
              return bounds.width && bounds.height && (bounds.width + .1 < 44 || bounds.height + .1 < 44)
                ? [[node.textContent.trim(), bounds.width, bounds.height]] : [];
            }));
          assert.deepEqual(hitTargets, [], label + ' targets');
          if (width === 375 && ['redactar', 'voz-formulario', 'voz-borrador', 'aceptar'].includes(screen)) {
            const action = await page.locator('.mobile-content .mobile-action').first().boundingBox();
            assert.ok(action && action.y + action.height <= height, label + ' action bottom: ' + (action && action.y + action.height));
          }
        }
        await page.screenshot({ path: join(captureDir, [network, screen, width, theme, lang].join('-') + '.png') });
      }
    }
  }
  await button(page, 'Leer en español').click();
  await page.locator('.theme-switch').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 375, height: 629 });
}

async function sessionEdges({ ed25519 }) {
  const name = ed25519 ? 'Cuenta con sesión' : 'Navegador sin Ed25519';
  const page = await phone({ name });
  if (!ed25519) await page.context().addInitScript(() => {
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    crypto.subtle.importKey = (...args) => {
      if ((args[2]?.name ?? args[2]) === 'Ed25519') return Promise.reject(new DOMException('Unsupported', 'NotSupportedError'));
      return original(...args);
    };
  });
  await signIn(page, name);
  const account = people.get(name);
  const dashboard = '/app?vista=aportes&lang=es';
  const composer = dashboard + '&accion=pedir';
  const draftKey = 'vespi-contributions:draft:' + account + ':testnet:request';
  const field = page.getByLabel('Escribe tu solicitud');
  if (ed25519) {
    await page.waitForFunction(async () => (await indexedDB.databases()).some(db => db.name === 'vespi-session'));
    const storage = await page.evaluate(async ({ account, draftKey }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('vespi-session', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise(resolve => {
        const request = db.transaction('keys').objectStore('keys').get('session');
        request.onsuccess = () => resolve(request.result);
      });
      const exported = await crypto.subtle.exportKey('pkcs8', record.key).then(() => true, () => false);
      await new Promise(resolve => {
        const write = db.transaction('keys', 'readwrite');
        write.objectStore('keys').put({ ...record, expires: Date.now() - 1 }, 'session');
        write.oncomplete = resolve;
      });
      db.close();
      localStorage.setItem(draftKey, JSON.stringify({ expires: Date.now() - 1, value: { statement: 'Borrador vencido' } }));
      return { exported, extractable: record.key.extractable, keys: Object.keys(record).sort(), account: record.publicKey,
        local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie };
    }, { account, draftKey });
    assert.equal(storage.account, account);
    assert.equal(storage.exported, false);
    assert.equal(storage.extractable, false);
    assert.deepEqual(storage.keys, ['expires', 'key', 'publicKey']);
    assert.deepEqual(storage.session, {});
    assert.equal(storage.cookies, '');
    assert.doesNotMatch(JSON.stringify(storage.local), /\bS[A-Z2-7]{55}\b|privateKey|seed|prf/i);
  }
  const before = page.auth().get;
  await goto(page, composer);
  await expect(field).toHaveValue('');
  assert.equal(page.auth().get, before);
  if (ed25519) {
    resetAccounts.add(account);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), draftKey), null);
  } else assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []);
  await field.fill('Una solicitud privada');
  await button(page, 'Continuar').click();
  await page.reload();
  await expect(button(page, 'Firmar')).toBeVisible();
  await button(page, 'Firmar').click();
  if (ed25519) {
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Tu cuenta ya no existe en Stellar testnet.');
    resetAccounts.delete(account);
    await button(page, 'Editar').click();
    await expect(field).toHaveValue('Una solicitud privada');
    const tab = await page.context().newPage();
    await goto(tab, composer);
    await expect(tab.getByLabel('Escribe tu solicitud')).toHaveValue('Una solicitud privada');
    await goto(page, dashboard);
    const pendingKey = 'vespi-contributions:pending:' + account;
    await page.evaluate(key => localStorage.setItem(key, '{}'), pendingKey);
    let warningText;
    page.once('dialog', async dialog => { warningText = dialog.message(); await dialog.dismiss(); });
    await button(page, 'Salir de la cuenta').click();
    assert.match(warningText, /Hay un envío pendiente/);
    await expect(link(page, '¿Necesitas ayuda? Pide un aporte')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await button(page, 'Salir de la cuenta').click();
    await expect(button(tab, 'Entrar con passkey')).toBeVisible();
    await expect(button(page, 'Entrar con passkey')).toBeVisible();
    await page.goBack();
    await expect(button(page, 'Entrar con passkey')).toBeVisible();
    await expect(page.getByText('Una solicitud privada', { exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), null);
    const beforeLogin = page.auth().get;
    await button(page, 'Entrar con passkey').click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    assert.equal(page.auth().get - beforeLogin, 1);
  } else await expect(link(page, 'Abrir recibo público')).toBeVisible();
  assert.equal(page.auth().get - before, ed25519 ? 2 : 1);
  console.log(ed25519 ? 'Sesión y borrador vencidos, reinicio de testnet, almacenes, salida confirmada, Atrás y dos pestañas.'
    : 'Sin Ed25519: mirar tras recargar hace 0 llamadas y firmar hace 1.');
  await page.context().close();
}

async function evidenceChain(network) {
  const mainnet = network === 'mainnet';
  const suffix = mainnet ? '&network=mainnet' : '';
  const asker = 'Camila ' + network;
  const helper = 'Diego ' + network;
  const a = await phone({ name: asker, allow: mainnet, network });
  const b = await phone({ name: helper, allow: mainnet, network });
  await signIn(a, asker);
  await signIn(b, helper);
  const dashboard = '/app?vista=aportes&lang=es' + suffix;
  const compose = '/app?vista=aportes&accion=pedir&lang=es' + suffix;
  const draftText = 'Revisa la guía y sugiere un ejemplo para el equipo.';
  const comment = 'Nos ayuda un ejemplo breve.\nComparte la idea por escrito.';
  const deliveryText = 'Agregué un ejemplo y revisé el primer paso.';
  const requestField = a.getByLabel('Escribe tu solicitud');
  const commentField = a.getByLabel('Comentario opcional');
  const deliveryField = b.getByLabel('Describe el aporte que entregas');
  const first = { a: a.auth().get, b: b.auth().get };
  const counts = [];
  async function stage(page, name, before, after, waiting) {
    const start = page.auth().get;
    await before();
    if (baseline && waiting) await button(page, 'Entrar con passkey').click();
    await expect(after).toBeVisible();
    const delta = page.auth().get - start;
    assert.equal(delta, baseline && waiting ? 1 : 0, name);
    counts.push([name, delta]);
  }
  await stage(a, 'historial', () => goto(a, dashboard), link(a, '¿Necesitas ayuda? Pide un aporte'));
  await captureMatrix(a, network, 'historial');
  await stage(a, 'redactar', () => goto(a, compose), requestField, true);
  await requestField.fill(draftText);
  await commentField.fill(comment);
  if (!baseline) {
    const details = a.getByText('Más detalles', { exact: true });
    await details.focus();
    await expect(details).toBeFocused();
    await details.press('Space');
    await a.getByRole('textbox', { name: '¿Con quién fue? (opcional)' }).fill(people.get(helper));
    await stage(a, 'recarga-redactar', () => a.reload(), requestField);
    await expect(details.locator('..')).toHaveAttribute('open', '');
    await expect(a.getByRole('textbox', { name: '¿Con quién fue? (opcional)' })).toHaveValue(people.get(helper));
    await a.getByRole('textbox', { name: '¿Con quién fue? (opcional)' }).clear();
    await details.click();
    await expect(requestField).toHaveValue(draftText);
    await expect(commentField).toHaveValue(comment);
    await expect(a.locator('.mobile-network-label')).toContainText(network);
  }
  await captureMatrix(a, network, 'redactar');
  await button(a, 'Continuar').click();
  if (!baseline) {
    await stage(a, 'recarga-revision', () => a.reload(), button(a, 'Firmar'));
    await expect(a.getByText(comment, { exact: true })).toBeVisible();
    await expect(button(a, 'Firmar')).toHaveAccessibleDescription('Puede pedir tu passkey');
  }
  await captureMatrix(a, network, 'revision');
  const beforeRequest = a.auth().get;
  await button(a, 'Firmar').click();
  await expect(link(a, 'Abrir recibo público')).toBeVisible();
  assert.equal(a.auth().get - beforeRequest, baseline ? 0 : 1);
  counts.push(['firmar-solicitud', a.auth().get - beforeRequest]);
  if (!baseline) assert.equal(await a.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':draft:')).length), 0);
  await captureMatrix(a, network, 'solicitud-lista');
  await button(a, 'Invita a quien entrega').click();
  const accountField = a.getByLabel('Cuenta de quien entrega (G…)');
  await accountField.fill(people.get(helper));
  await button(a, 'Comprobar cuenta').click();
  await expect(button(a, 'Firmar autorización de entrega')).toBeVisible();
  await captureMatrix(a, network, 'autorizar');
  const beforeAssignment = a.auth().get;
  await button(a, 'Firmar autorización de entrega').click();
  const invitation = await share(a, 'Invitar a entregar', network);
  assert.equal(a.auth().get - beforeAssignment, 0);
  counts.push(['autorizar-misma-pestaña', 0]);
  if (!baseline) await stage(a, 'recarga-autorizacion', () => a.reload(), button(a, 'Invitar a entregar'));
  await stage(b, 'entrega', () => goto(b, invitation), deliveryField, true);
  await deliveryField.fill(deliveryText);
  if (!baseline) {
    await stage(b, 'recarga-entrega', () => b.reload(), deliveryField);
    await expect(deliveryField).toHaveValue(deliveryText);
  }
  await captureMatrix(b, network, 'entrega');
  await button(b, 'Continuar').click();
  if (!baseline) await stage(b, 'recarga-revision-entrega', () => b.reload(), button(b, 'Firmar entrega'));
  await captureMatrix(b, network, 'revision-entrega');
  const beforeDelivery = b.auth().get;
  await button(b, 'Firmar entrega').click();
  await expect(button(b, 'Enviar para revisión')).toBeVisible();
  assert.equal(b.auth().get - beforeDelivery, baseline ? 0 : 1);
  counts.push(['firmar-entrega', b.auth().get - beforeDelivery]);
  await captureMatrix(b, network, 'entrega-lista');
  const delivery = await share(b, 'Enviar para revisión', network);
  if (!baseline) await stage(b, 'recarga-entrega-firmada', () => b.reload(), link(b, 'Ver el paso confirmado más reciente'));
  await stage(a, 'aceptar', () => goto(a, delivery), button(a, 'Aceptar y firmar'), true);
  if (!baseline) await stage(a, 'recarga-aceptacion', () => a.reload(), button(a, 'Aceptar y firmar'));
  await captureMatrix(a, network, 'aceptar');
  const beforeAcceptance = a.auth().get;
  await button(a, 'Aceptar y firmar').click();
  await link(a, 'Abrir recibo').click();
  await expect(a.getByRole('heading', { name: 'Firma y recibo verificados' })).toBeVisible();
  assert.equal(a.auth().get - beforeAcceptance, baseline ? 0 : 1);
  counts.push(['firmar-aceptacion', a.auth().get - beforeAcceptance]);
  if (!baseline) await stage(a, 'recarga-recibo', () => a.reload(), a.getByRole('heading', { name: 'Firma y recibo verificados' }));
  await captureMatrix(a, network, 'recibo');
  assert.deepEqual([...networks[network].records.values()].map(record => record.draft.kind), ['REQUEST', 'CONTRIBUTE', 'ACCEPT']);
  if (!baseline) {
    const storage = await a.evaluate(async () => ({
      local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie, db: await indexedDB.databases(),
    }));
    assert.deepEqual(JSON.parse(storage.local['vespi-contributions:identity:v1']), { account: people.get(asker), displayName: asker });
    assert.deepEqual(storage.db, []);
    assert.deepEqual(storage.session, {});
    assert.equal(storage.cookies, '');
    assert.doesNotMatch(JSON.stringify(storage.local), /\bS[A-Z2-7]{55}\b|privateKey|seed|prf/i);
    assert.equal(Object.keys(storage.local).some(key => key.includes(':draft:')), false);
    // Diego’s genuine virtual passkey must not sign a draft for Camila’s remembered public account.
    await b.evaluate(identity => localStorage.setItem('vespi-contributions:identity:v1', JSON.stringify(identity)),
      { account: people.get(asker), displayName: asker });
    await goto(b, compose);
    await b.getByLabel('Escribe tu solicitud').fill('Este borrador pertenece a Camila.');
    await button(b, 'Continuar').click();
    const wrong = b.auth().get;
    let signedPosts = 0;
    b.on('request', req => { if (req.method() === 'POST' && /receipts\/(prepare|anchor)/.test(req.url())) signedPosts++; });
    await button(b, 'Firmar').click();
    await expect(b.locator('.mobile-message[role="alert"]')).toContainText('Desbloqueaste otra cuenta.');
    assert.equal(b.auth().get - wrong, 1);
    assert.equal(signedPosts, 0);
    const secondTab = await b.context().newPage();
    await goto(secondTab, compose);
    await expect(button(secondTab, 'Firmar')).toBeVisible();
    await goto(b, dashboard);
    b.once('dialog', dialog => dialog.accept());
    await button(b, 'Salir de la cuenta').click();
    await expect(button(b, 'Entrar con passkey')).toBeVisible();
    await expect(button(secondTab, 'Entrar con passkey')).toBeVisible();
    assert.deepEqual(await secondTab.evaluate(account => Object.keys(localStorage).filter(k =>
      k === 'vespi-contributions:identity:v1' || k.startsWith('vespi-contributions:') && k.split(':').includes(account)), people.get(asker)), []);
    assert.equal(b.auth().get - wrong, 1);
    await secondTab.close();
  }
  console.log(JSON.stringify({ evidence, network, baselineAtAccountSetup: first, webauthn: counts, total: { a: a.auth(), b: b.auth() } }));
  await a.context().close();
  await b.context().close();
}

async function evidenceVoice(network) {
  const mainnet = network === 'mainnet';
  const name = network + ' Voz';
  const page = await phone({ name, allow: mainnet, network });
  await signIn(page, name);
  const count = page.auth().get;
  await goto(page, '/app?vista=aportes&accion=pedir&lang=es' + (mainnet ? '&network=mainnet' : ''));
  if (baseline) await button(page, 'Entrar con passkey').click();
  const record = button(page, 'Grabar nota de voz');
  await expect(record).toBeVisible();
  const read = page.auth().get - count;
  assert.equal(read, baseline ? 1 : 0);
  await captureMatrix(page, network, 'voz-formulario', lang => expect(button(page, lang === 'es' ? 'Grabar nota de voz' : 'Record a voice note')).toBeVisible());
  await captureMatrix(page, network, 'voz-consentimiento', async lang => {
    const mic = button(page, lang === 'es' ? 'Grabar nota de voz' : 'Record a voice note');
    await expect(mic).toBeVisible();
    if (!baseline) await mic.click();
    await expect(button(page, lang === 'es' ? 'Entiendo' : 'I understand')).toBeVisible();
  });
  assert.equal(page.auth().get - count, read);
  const beforeRecord = page.auth().get;
  await recordVoice(page, '87-' + network + '-voz', {});
  const recording = page.auth().get - beforeRecord;
  assert.equal(recording, baseline ? 0 : 1);
  await captureMatrix(page, network, 'voz-borrador');
  if (!baseline) {
    const countAfterRecording = page.auth().get;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Escribe tu solicitud')).toHaveValue(proposals.request.statement);
    await expect(page.getByText('Propuesto por IA, revísalo.', { exact: true })).toBeVisible();
    await expect(page.getByText('Cómo se usa tu audio', { exact: true })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Object.values(sessionStorage)), ['1']);
    await goto(page, '/app?vista=aportes&lang=es' + (mainnet ? '&network=mainnet' : ''));
    page.once('dialog', dialog => dialog.accept());
    await button(page, 'Salir de la cuenta').click();
    await expect(button(page, 'Entrar con passkey')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Object.values(sessionStorage)), []);
    assert.equal(page.auth().get, countAfterRecording);
  }
  console.log(JSON.stringify({ evidence, network, voice: { read, record: recording } }));
  await page.context().close();
}

async function legacyDevice() {
  const name = 'Participante con clave local';
  const page = await phone({ name, hasPrf: false });
  await goto(page, '/app?vista=aportes&lang=es');
  await button(page, 'Crear una passkey').click();
  await page.getByLabel('Nombre para tu passkey').fill(name);
  await button(page, 'Crear una passkey').click();
  await button(page, 'Usar clave en este dispositivo').click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const identity = 'vespi-contributions:identity:v1';
  const previous = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identity);
  assert.equal(previous.local, true);
  await page.evaluate(({ key, account, displayName }) => localStorage.setItem(key, JSON.stringify({ account, displayName })),
    { key: identity, ...previous });
  const count = page.auth().get;
  await goto(page, '/app?vista=aportes&accion=pedir&lang=es');
  await page.getByLabel('Escribe tu solicitud').fill('Solicitud de una cuenta anterior.');
  await button(page, 'Continuar').click();
  assert.equal(page.auth().get, count);
  await button(page, 'Firmar').click();
  await expect(link(page, 'Abrir recibo público')).toBeVisible();
  assert.equal(page.auth().get - count, 1);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), identity), previous);
  await page.context().close();
  console.log('Identidad anterior sin marca de clave local: reabre sin WebAuthn y recupera su firmante al firmar.');
}

try {
  if (captureDir) await mkdir(captureDir, { recursive: true });
  if (evidence) {
    const verify = voiceEvidence ? evidenceVoice : evidenceChain;
    await verify('mainnet');
    await verify('testnet');
  } else {
    await chain('mainnet');
    await chain('testnet');
    await legacyDevice();
    if (phase91) {
      await sessionEdges({ ed25519: true });
      await sessionEdges({ ed25519: false });
    }
  }
  assert.deepEqual(blocked, []);
  if (!evidence) console.log('Invitación y búsqueda de cuenta no habilitada, reintento con XDR intacto, separación de borradores y axe a 375 px.');
} finally {
  await browser.close();
}
