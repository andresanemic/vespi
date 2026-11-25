// Run against a local production build with --import ./src/lib/contributions/test-imports.mjs.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { Account, BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { buildOnboardingTx } from '../src/lib/contributions/stellar-server.ts';
import { profileMessage } from '../src/lib/contributions/profile-authorization.ts';
import { seedLegacyDraft } from './fixtures/contributions-legacy-draft.mjs';

process.env.VESPI_TEST_VOICE = '1';
process.env.NEXT_TELEMETRY_DISABLED = '1';
const captures = process.env.VESPI_CAPTURES;
delete process.env.VESPI_CAPTURES;
const { mockVoice, recordVoice, proposals, voiceChromium } = await import('./fixtures/contributions-voice.mjs');
const sponsor = Keypair.random();
const channel = Keypair.random();
const eligible = new Set();
const active = new Set();
const setups = new Map();
const stores = new Map();
const errors = [];
const mainnetAttempts = [];
let loseAnchorResponse = false;
let storeUnavailable = false;
const horizon = { mainnet: 'https://horizon.stellar.org', testnet: 'https://horizon-testnet.stellar.org' };
const phrase = { mainnet: Networks.PUBLIC, testnet: Networks.TESTNET };
const networkId = { mainnet: 'stellar:pubnet', testnet: 'stellar:testnet' };
const store = (network, area) => {
  const key = 'contributions:' + network + ':' + area;
  if (!stores.has(key)) stores.set(key, new Map());
  return stores.get(key);
};

Object.assign(process.env, {
  CONTRIB_SPONSOR_SECRET_MAINNET: sponsor.secret(), CONTRIB_CHANNEL_SECRETS_MAINNET: channel.secret(),
  CONTRIB_SPONSOR_BUDGET_STROOPS_MAINNET: '200000000', CONTRIB_SPONSOR_MAX_FEE_MAINNET: '2000',
  CONTRIB_SPONSOR_MAX_RESERVE_MAINNET: '10000000', CONTRIB_SPONSOR_EXPIRES_AT_MAINNET: '2099-01-01T00:00:00Z',
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://main-store.invalid', CONTRIB_KV_MAINNET_REST_API_TOKEN: 'fixture-main',
  CONTRIB_KV_REST_API_URL: 'https://test-store.invalid', CONTRIB_KV_REST_API_TOKEN: 'fixture-test',
  CONTRIB_TOKEN_KEY_MAINNET: 'm'.repeat(32), CONTRIB_TOKEN_KEY: 't'.repeat(32),
});
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return nativeFetch(input, options);
  try {
    const network = { 'main-store.invalid': 'mainnet', 'test-store.invalid': 'testnet' }[url.hostname];
    assert.ok(network, 'Unexpected server request to ' + url.origin);
    if (storeUnavailable) return new Response(null, { status: 503 });
    const [command, ...args] = JSON.parse(options?.body ?? await input.text());
    const key = args[command === 'EVAL' ? 2 : 0];
    assert.ok(key.startsWith('contributions:' + network + ':'));
    const map = store(network, command === 'ZRANGEBYLEX' ? 'encounters:v1:public' : key.split(':').slice(2).join(':'));
    let result;
    if (command === 'HGET') result = map.get(args[1]) ?? null;
    else if (command === 'HMGET') result = args.slice(1).map(key => map.get(key) ?? null);
    else if (command === 'ZRANGEBYLEX') {
      const [, start, end, command, offset, count] = args;
      assert.equal(command, 'LIMIT');
      assert.equal(offset, 0);
      result = [...map.keys()].filter(member => (start[0] === '[' ? member >= start.slice(1) : member > start.slice(1)) &&
        member <= end.slice(1)).sort().slice(0, count);
    } else if (command === 'HSCAN') {
      const match = args[2] === 'MATCH' ? args[3].slice(0, -1) : '';
      result = ['0', [...map].filter(([field]) => field.startsWith(match)).flat()];
    } else {
      assert.equal(command, 'EVAL');
      assert.ok(key.endsWith(':encounters:v1'));
      const [lua, keyCount] = args;
      const [id, value, arg, extra] = args.slice(2 + keyCount);
      const field = 'record:' + id;
      if (lua.includes('HEXISTS')) {
        const record = JSON.parse(value);
        if (network === 'mainnet') {
          assert.ok(active.has(record.draft.a.account), 'Onboarding completed before proposal');
          assert.ok(!arg || eligible.has(arg));
        }
        result = map.has(field) ? 0 : 1;
        if (result) {
          map.set(field, value).set('member:' + arg + ':' + id, id);
          if (extra) map.set('member:' + extra + ':' + id, id);
        }
      } else {
        const record = JSON.parse(map.get(field));
        const patch = JSON.parse(arg);
        result = record[value] ? 0 : 1;
        if (result) {
          record[value] = patch;
          if (value === 'decision') {
            if (network === 'mainnet') assert.ok(active.has(patch.person.account));
            map.set('member:' + patch.person.account + ':' + id, id);
            if (record.draft.visibility === 'public' && patch.choice === 'confirm') {
              assert.equal(keyCount, 2);
              assert.ok(args[3].startsWith(key + ':{'));
              const publicIndex = store(network, 'encounters:v1:public');
              publicIndex.set(record.draft.a.account + ':' + id, true).set(patch.person.account + ':' + id, true);
            }
          } else {
            assert.equal(value, 'anchor');
            const receipt = JSON.parse(getReceipts(network).get('receipt:' + patch));
            const commitment = JSON.parse(receipt.intent.bytes).comment.split(':').at(-1);
            const expected = network === 'mainnet'
              ? createHmac('sha256', process.env.CONTRIB_TOKEN_KEY_MAINNET)
                .update('vespi:encounter-proof:v1:stellar:pubnet:' + commitment).digest('hex').slice(0, 32)
              : hash('vespi:encuentro:proof:' + commitment).slice(0, 32);
            assert.equal(extra, expected);
            record.receiptToken = extra;
            map.set('proof:' + extra, id);
          }
          map.set(field, JSON.stringify(record));
        }
      }
    }
    return Response.json({ result });
  } catch (error) {
    errors.push(error);
    throw error;
  }
};

const next = (await import('next')).default;
const app = next({ dev: false });
const server = createServer(app.getRequestHandler());
await app.prepare();
server.listen(0, 'localhost');
await once(server, 'listening');
const origin = 'http://localhost:' + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.VESPI_CHROMIUM,
  args: [...voiceChromium, '--proxy-server=http://127.0.0.1:9', '--disable-quic'],
});
const json = (route, data, status = 200) => route.fulfill({
  json: data, status, headers: { 'Access-Control-Allow-Origin': '*' },
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = account => eligible.has(account);
const warning = 'Al anclar la huella, quedan públicos y permanentes en Stellar mainnet';
const description = 'Este resumen privado pertenece al encuentro.';
const title = network => 'Encuentro privado de ' + network;
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const sessionUrl = origin + '/api/contributions/encounters?session=1';
const getReceipts = network => store(network, 'receipts');
const recordTests = [];

function verifiedTx(xdr, account, network) {
  const transaction = TransactionBuilder.fromXDR(xdr, phrase[network]);
  const opposite = TransactionBuilder.fromXDR(xdr, phrase[network === 'mainnet' ? 'testnet' : 'mainnet']);
  const signer = Keypair.fromPublicKey(account);
  const signature = transaction.signatures[0].signature();
  assert.ok(signer.verify(transaction.hash(), signature));
  assert.equal(signer.verify(opposite.hash(), signature), false);
  return transaction;
}

async function phone(name, { network = 'testnet' } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 629 }, locale: 'es-CL',
    isMobile: true, hasTouch: true, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.addInitScript(() => {
    localStorage.setItem('vespi-lang', 'es');
    localStorage.setItem('vespi-theme', 'light');
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = options => {
      if (options?.publicKey) sessionStorage.setItem('fixture-webauthn', String(Number(sessionStorage.getItem('fixture-webauthn')) + 1));
      return get(options);
    };
  });
  const page = await context.newPage();
  let account;
  let expectedNetwork = network;
  if (name) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
    } });
  }
  page.on('pageerror', error => errors.push(error));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    try {
      if (url.origin === horizon[expectedNetwork]) {
        const [, area, key] = url.pathname.split('/');
        if (area === 'accounts') {
          if (expectedNetwork === 'mainnet') assert.ok(active.has(key));
          return json(route, { sequence: '123' });
        }
        assert.equal(area, 'transactions');
        const found = [...getReceipts(expectedNetwork).values()].map(JSON.parse).find(row => row.index.txHash === key);
        assert.ok(found);
        return json(route, { successful: true, hash: key, ledger: found.index.ledger, envelope_xdr: found.index.envelopeXdr });
      }
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/contributions/')) return route.continue();
      const [area, operation] = url.pathname.split('/').slice(3);
      // Signing out closes the session on both networks.
      if (area === 'encounters' && route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'logout') return route.continue();
      const selected = url.searchParams.get('network') ?? 'testnet';
      const voice = area === 'voice' || area === 'voice-draft';
      if (area !== 'network' && !(area === 'profiles' && operation === account && selected === 'testnet')) {
        assert.equal(url.searchParams.get('network'), expectedNetwork === 'mainnet' || voice ? expectedNetwork : null,
          'Network for ' + url.pathname);
      }
      if (voice) {
        if (selected === 'mainnet' && area === 'voice') assert.equal(url.searchParams.get('kind'), 'encounter');
        if (area === 'voice-draft') assert.equal(route.request().headers()['x-vespi-voice-kind'], 'encounter');
        if (await mockVoice(route, key => key === account && (selected === 'testnet' || active.has(key)), selected)) return;
      }
      const body = route.request().postDataJSON();
      if (area === 'account') {
        if (selected === 'testnet') {
          assert.equal(body.action, 'prepare');
          account = body.publicKey;
          return json(route, { ok: false, reason: 'already-onboarded' }, 409);
        }
        assert.ok(allowed(account));
        if (body.action === 'prepare') {
          assert.equal(body.publicKey, account);
          if (active.has(account)) return json(route, { ok: false, reason: 'already-onboarded' }, 409);
          const tx = buildOnboardingTx({ channel: new Account(channel.publicKey(), '0'), sponsor: sponsor.publicKey(),
            newAccount: account, baseFee: BASE_FEE, timeoutSeconds: 60 }, 'mainnet');
          setups.set(account, tx.hash().toString('hex'));
          return json(route, { ok: true, token: account, xdr: tx.toXDR() });
        }
        assert.equal(body.action, 'complete');
        assert.equal(body.token, account);
        assert.equal(verifiedTx(body.xdr, account, selected).hash().toString('hex'), setups.get(account));
        active.add(account);
        return json(route, { ok: true });
      }
      if (area === 'profiles' && body) {
        if (selected === 'mainnet') assert.ok(active.has(account), 'Onboarding completed before profile signature');
        assert.equal(body.account, account);
        assert.ok(Keypair.fromPublicKey(account).verify(Buffer.from(profileMessage(account, body.displayName,
          body.expiresAt, selected)), Buffer.from(body.signature, 'hex')));
        store(selected, 'profiles').set(account, body.displayName);
        return json(route, { ok: true });
      }
      if (area === 'encounters' && body) {
        if (selected === 'mainnet' && body.action === 'session') assert.ok(active.has(account), 'Onboarding completed before session');
        recordTests.push([selected, body.action]);
      }
      if (area === 'receipts' && operation === 'anchor') {
        const { bytes, xdr } = body;
        const draft = JSON.parse(bytes);
        assert.equal(draft.actor, account);
        assert.equal(draft.kind, 'REQUEST');
        assert.equal(draft.statement, 'Huella de un registro de Vespi Contributions');
        assert.match(draft.comment, /^vespi:encuentro:[a-f0-9]{64}$/);
        for (const privateText of [description, title(selected), proposals.encounter.contributions[0].text]) {
          assert.ok(!bytes.includes(privateText));
        }
        const digest = hash(bytes);
        const inner = verifiedTx(xdr, account, selected);
        assert.equal(inner.memo.type, 'hash');
        assert.equal(Buffer.from(inner.memo.value).toString('hex'), digest);
        assert.equal(inner.operations.length, 1);
        assert.equal(inner.operations[0].type, 'bumpSequence');
        if (selected === 'mainnet') {
          mainnetAttempts.push({ bytes, digest });
          const existing = getReceipts(selected).get('receipt:' + digest);
          if (existing) return json(route, { ok: true, index: JSON.parse(existing).index });
        }
        const outer = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, phrase[selected]);
        outer.sign(sponsor);
        const index = { digest, network: networkId[selected], txHash: outer.hash().toString('hex'), ledger: 12345,
          envelopeXdr: outer.toXDR(), rehearsal: false };
        getReceipts(selected).set('receipt:' + digest, JSON.stringify({ intent: { bytes, digest }, index }));
        recordTests.push([selected, 'xdr']);
        if (selected === 'mainnet' && loseAnchorResponse) {
          loseAnchorResponse = false;
          return json(route, { ok: false, reason: 'anchor-unavailable' }, 503);
        }
        return json(route, { ok: true, index });
      }
      return route.continue();
    } catch (error) {
      errors.push(error);
      await route.abort();
    }
  });
  return {
    context, page, account: () => account,
    expectNetwork: network => { expectedNetwork = network; },
  };
}

async function audit(page, name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name);
  if (page.viewportSize().width === 375) {
    const { violations } = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)]), [], name);
  }
  if (captures) await page.screenshot({ path: join(captures, name + '.png') });
}

async function register(person, name) {
  const { page } = person;
  await page.goto(origin + '/app');
  await btn(page, 'Menú').click();
  await page.getByRole('navigation').getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Nombre visible' }).fill(name);
  await dialog.getByRole('button', { name: 'Crear cuenta con passkey' }).click();
  await expect(dialog).toBeHidden();
  assert.ok(person.account());
  await checkSession(person, name);
}

async function checkSession(person, name) {
  const response = await person.context.request.get(sessionUrl);
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { ok: true, profile: { account: person.account(), displayName: name } });
}

async function checkSignedOut(person) {
  for (const url of [sessionUrl, sessionUrl + '&network=mainnet']) {
    const response = await person.context.request.get(url);
    assert.deepEqual(await response.json(), { ok: true, profile: null });
  }
}

async function enter(page) {
  const inContent = btn(page.locator('.content'), 'Iniciar sesión');
  if (await inContent.isVisible()) await inContent.click();
  else {
    await btn(page, 'Menú').click();
    await btn(page.getByRole('navigation'), 'Iniciar sesión').click();
  }
  await btn(page, 'Entrar con mi passkey').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function keepEditing(page, path, selector, expectNetworkSwitch) {
  let received;
  let release;
  const intercepted = new Promise(resolve => { received = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  await page.route(selector, async route => {
    received();
    await hold;
    await route.fallback();
  });
  try {
    await page.goto(origin + path);
    await intercepted;
    await btn(page, 'Ayudé a alguien').click();
    const field = page.locator('#record-text');
    await field.fill('Borrador en edición');
    await field.evaluate(input => input.setSelectionRange(2, 8));
    const response = page.waitForResponse(selector);
    release();
    await (await response).finished();
    await expect(page.locator('.mobile-network button[aria-haspopup="dialog"]')).toHaveCount(expectNetworkSwitch ? 1 : 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Borrador en edición');
    assert.deepEqual(await field.evaluate(input => [input.selectionStart, input.selectionEnd]), [2, 8]);
  } finally {
    release();
    await page.unroute(selector);
  }
}

async function signOut(page) {
  await btn(page, 'Menú').click();
  await page.getByRole('navigation').getByRole('button', { name: 'Mi cuenta', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await btn(page, 'Cerrar sesión').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function finishDraft(page, network, { personal = false } = {}) {
  if (personal) await page.locator('#typ').selectOption('charla');
  await page.locator('#title').fill(personal ? 'Mi declaración personal' : title(network));
  await page.locator('#b').fill(personal ? '' : 'Invitada');
  await page.locator('#sum').fill(description);
  await btn(page, 'Continuar →').click();
  await page.locator('#aporte-texto-0').fill(proposals.encounter.contributions[0].text);
  await btn(page, 'Continuar →').click();
  if (!personal) await btn(page, network === 'mainnet' ? 'Preparar un enlace privado' : 'La otra persona todavía no tiene cuenta').click();
}

async function legacyWizard(page, network) {
  await seedLegacyDraft(page, network);
  await page.goto(origin + '/app?vista=borrador-encuentro&network=' + network);
}

async function copy(page, name) {
  await btn(page, name).click();
  await expect(page.getByText('Enlace copiado.')).toBeVisible();
  return new URL(await page.evaluate(() => navigator.clipboard.readText()));
}

async function checkProof(proof, network, personal = false) {
  const { page, context } = await phone(undefined, { network });
  const response = await page.goto(proof.href);
  assert.equal(response.status(), 200);
  await expect(page.getByRole('heading', { name: 'Constancia de colaboración' })).toBeVisible();
  await expect(page.locator('.mobile-network-label')).toHaveText(network === 'mainnet' ? 'Mainnet' : 'Testnet');
  await expect(page.getByText(personal ? 'El autor firmó su propia declaración.'
    : 'Dos participantes confirmaron la misma versión del encuentro.')).toBeVisible();
  await expect(page.getByText('1 aporte registrado')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver transacción en Stellar' })).toHaveAttribute('href',
    new RegExp('/explorer/' + (network === 'mainnet' ? 'public' : 'testnet') + '/tx/[a-f0-9]{64}$'));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', new RegExp('Stellar ' + network));
  const html = await response.text();
  for (const privateText of [description, title(network), proposals.encounter.contributions[0].text, 'Mi declaración personal']) {
    assert.ok(!html.includes(privateText));
  }
  await audit(page, network + '-constancia' + (personal ? '-personal' : ''));
  if (network === 'mainnet') {
    const link = page.getByRole('link', { name: 'Verificar huella y firma de anclaje' });
    const verification = new URL(await link.getAttribute('href'), origin);
    assert.equal(verification.searchParams.get('network'), 'mainnet');
    const digest = verification.searchParams.get('receipt');
    const { intent } = JSON.parse(getReceipts(network).get('receipt:' + digest));
    const commitment = JSON.parse(intent.bytes).comment.split(':').at(-1);
    const oldProof = new URL(proof);
    oldProof.pathname = '/app/constancia/' + hash('vespi:encuentro:proof:' + commitment).slice(0, 32);
    assert.equal((await context.request.get(oldProof.href)).status(), 404);
    assert.equal((await context.request.get(origin + '/api/contributions/chains/' + digest + '?network=mainnet')).status(), 404);
    await link.click();
    await expect(page.getByText('Huella de un registro de Vespi Contributions')).toBeVisible();
    await expect(page.locator('.mobile-chain-summary')).toHaveCount(0);
  }
  const other = new URL(proof);
  if (network === 'mainnet') other.searchParams.delete('network');
  else other.searchParams.set('network', 'mainnet');
  assert.equal((await context.request.get(other.href)).status(), 404);
  await context.close();
}

try {
  if (captures) await mkdir(captures, { recursive: true });
  if (process.env.VESPI_RECORD_MOBILE === '1') {
    const { runRecordMobile } = await import('./contributions-record-mobile.mjs');
    await runRecordMobile({ origin, phone, register, copy, enter, audit, signOut,
      profileStore: network => store(network, 'profiles'),
      encounterStore: network => store(network, 'encounters:v1'),
      failStore: value => { storeUnavailable = value; },
      allow: account => { eligible.add(account); process.env.CONTRIB_ALLOWED_ACCOUNTS_MAINNET = [...eligible].join(','); },
    });
    assert.deepEqual(errors, []);
  } else {
  const [author, guest, outsider] = await Promise.all([phone('Autora'), phone('Invitada'), phone('Fuera de lista')]);
  for (const [person, name] of [[author, 'Autora'], [guest, 'Invitada'], [outsider, 'Fuera de lista']]) {
    await register(person, name);
    if (person !== outsider) {
      eligible.add(person.account());
      process.env.CONTRIB_ALLOWED_ACCOUNTS_MAINNET = [...eligible].join(',');
    }
  }
  const { page: a } = author;
  const { page: b } = guest;
  await keepEditing(outsider.page, '/app?vista=registro', '**/api/contributions/network?account=*', false);
  await a.reload();
  await expect(btn(a, 'Testnet, cambiar red')).toBeVisible();
  await expect(a.getByRole('link', { name: '¿Necesitas ayuda? Pide un aporte', exact: true })).toHaveAttribute('href', '/app?vista=aportes&accion=pedir&lang=es');
  await expect(outsider.page.locator('.mobile-network button[aria-haspopup="dialog"]')).toHaveCount(0);
  await btn(a, 'Registrar un aporte').click();
  await btn(a, 'Ayudé a alguien').click();
  await a.locator('#record-text').fill('Borrador reservado a testnet');
  author.expectNetwork('mainnet');
  await btn(a, 'Testnet, cambiar red').click();
  const networkSheet = a.getByRole('dialog', { name: 'Red de Stellar' });
  await expect(networkSheet.getByRole('radio', { name: 'Testnet' })).toBeChecked();
  await networkSheet.getByRole('radio', { name: 'Mainnet' }).check();
  await btn(networkSheet, 'Continuar').click();
  await expect(a.locator('.mobile-network[data-mainnet] .mobile-network-label')).toHaveText('Mainnet');
  await expect(btn(a, 'Ayudé a alguien')).toBeVisible();
  assert.equal(await a.evaluate(() => Object.keys(localStorage).find(key => key.endsWith(':mainnet:record')) ?? null), null);
  await enter(a);
  await keepEditing(a, '/app?network=mainnet&vista=registro', '**/api/contributions/encounters?session=1&network=mainnet', true);
  await btn(a, 'Vespi Contributions, Inicio').click();
  await expect(a.getByRole('link', { name: '¿Necesitas ayuda? Pide un aporte', exact: true })).toHaveAttribute('href', '/app?vista=aportes&accion=pedir&lang=es&network=mainnet');
  await legacyWizard(a, 'mainnet');
  await a.locator('#title').fill('Borrador reservado a mainnet');
  await a.reload();
  await expect(a.locator('#title')).toHaveValue('Borrador reservado a mainnet');
  await a.locator('#title').fill('');
  await recordVoice(a, 'mainnet-encuentro');
  await expect(a.locator('#title')).toHaveValue(proposals.encounter.title);
  await finishDraft(a, 'mainnet');
  await expect(a.getByText(warning, { exact: false })).toBeVisible();
  await expect(a.getByText('Invitación privada en mainnet', { exact: true })).toBeVisible();
  await expect(a.getByText('Solo una cuenta habilitada en mainnet puede responder.', { exact: false })).toBeVisible();
  await expect(a.getByText('Quien tenga el enlace de la constancia', { exact: false })).toBeVisible();
  await btn(a, 'Read in English').click();
  await expect(a.getByText('Only an account enabled on mainnet can respond.', { exact: false })).toBeVisible();
  await expect(a.getByText('Anyone with the certificate link', { exact: false })).toBeVisible();
  await btn(a, 'Leer en español').click();
  await audit(a, 'mainnet-proponer');
  await btn(a, 'Preparar invitación').click();
  const invitation = await copy(a, 'Copiar enlace');
  assert.equal(invitation.searchParams.get('network'), 'mainnet');
  assert.match(invitation.hash, /^#invitation=[a-f0-9]{64}$/);
  assert.ok(!invitation.search.includes(invitation.hash.slice(12)));
  assert.match(invitation.searchParams.get('encuentro'), /^[a-f0-9]{32}$/);
  await a.reload();
  assert.equal((await copy(a, 'Copiar enlace')).href, invitation.href);
  const testnetRecord = await author.context.request.get(origin + '/api/contributions/encounters?id=' + invitation.searchParams.get('encuentro'));
  assert.equal(testnetRecord.status(), 404);
  const anonymous = await phone(undefined, { network: 'mainnet' });
  await anonymous.page.goto(invitation.href);
  await expect(anonymous.page.getByRole('heading', { name: 'Entra para ver el encuentro' })).toBeVisible();
  await expect(anonymous.page.getByText(description)).toHaveCount(0);
  await expect(anonymous.page).toHaveURL(invitation.href);
  await audit(anonymous.page, 'mainnet-enlace-sin-sesion');
  await anonymous.context.close();
  for (const [person, name] of [[outsider, 'Fuera de lista'], [guest, 'Invitada']]) {
    await checkSession(person, name);
    person.expectNetwork('mainnet');
    await person.page.goto(invitation.href);
    await expect(person.page.getByRole('heading', { name: person === outsider
      ? 'Esta cuenta no está habilitada para firmar en Stellar mainnet.' : 'Entra para ver el encuentro' })).toBeVisible();
    await expect(person.page.getByText(description)).toHaveCount(0);
    await expect(person.page).toHaveURL(invitation.href);
    await checkSession(person, name);
    const mainnetSession = await person.context.request.get(sessionUrl + '&network=mainnet');
    assert.deepEqual(await mainnetSession.json(), { ok: true, profile: null });
  }
  await outsider.page.locator('.content').getByRole('button', { name: 'Entrar con otra cuenta', exact: true }).click();
  await btn(outsider.page, 'Entrar con mi passkey').click();
  await expect(outsider.page.getByRole('dialog').getByRole('alert')).toHaveText('Esta cuenta no está habilitada para firmar en Stellar mainnet.');
  await expect(outsider.page).toHaveURL(invitation.href);
  assert.equal(setups.has(outsider.account()), false);
  await audit(outsider.page, 'mainnet-no-habilitada');
  const testProfiles = store('testnet', 'profiles');
  testProfiles.delete(guest.account());
  await b.locator('.content').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await btn(b, 'Entrar con mi passkey').click();
  const chooseName = b.getByRole('dialog', { name: 'Elige tu nombre en mainnet' });
  const nameField = chooseName.getByRole('textbox', { name: 'Nombre visible' });
  await expect(nameField).toBeFocused();
  assert.equal(setups.has(guest.account()), false);
  await expect(b).toHaveURL(invitation.href);
  await expect(chooseName.getByText('Tu nombre quedará visible en el directorio de mainnet.')).toBeVisible();
  await audit(b, 'mainnet-nombre');
  await nameField.fill('Invitada');
  await chooseName.getByRole('button', { name: 'Guardar nombre y entrar' }).click();
  await expect(chooseName).toBeHidden();
  assert.equal(store('mainnet', 'profiles').get(guest.account()), 'Invitada');
  assert.equal(testProfiles.has(guest.account()), false);
  testProfiles.set(guest.account(), 'Invitada');
  await expect(b.getByRole('heading', { name: title('mainnet'), exact: true })).toBeVisible();
  for (const [width, height] of [[375, 629], [390, 844]]) {
    await b.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      for (const lang of ['es', 'en']) {
        const link = new URL(invitation);
        link.searchParams.set('theme', theme);
        link.searchParams.set('lang', lang);
        await b.goto(link.href);
        await expect(b.locator('.mobile-network[data-mainnet] .mobile-network-label')).toHaveCSS('background-color',
          theme === 'dark' ? 'rgb(243, 238, 230)' : 'rgb(61, 50, 37)');
        await btn(b, lang === 'es' ? 'Confirmar encuentro' : 'Confirm encounter').click();
        const notice = lang === 'es' ? warning : 'Anchoring makes the transaction';
        await expect(b.getByRole('dialog').getByText(notice, { exact: false })).toBeVisible();
        await audit(b, `mainnet-confirmar-${width}x${height}-${theme}-${lang}`);
      }
    }
  }
  await b.setViewportSize({ width: 375, height: 629 });
  await b.goto(invitation.href);
  await b.reload();
  await expect(b).toHaveURL(invitation.href);
  await btn(b, 'Confirmar encuentro').click();
  const dialog = b.getByRole('dialog');
  await expect(dialog.getByText(warning, { exact: false })).toBeVisible();
  await audit(b, 'mainnet-confirmar');
  await btn(b, 'Firmar y confirmar').click();
  await expect(btn(b, 'Registrar huella en Stellar')).toBeVisible();
  assert.equal(recordTests.filter(([network, action]) => network === 'mainnet' && action === 'xdr').length, 0);
  await expect(b.getByText('Tu firma registra la huella en Stellar mainnet.')).toBeVisible();
  await audit(b, 'mainnet-anclar');
  loseAnchorResponse = true;
  await btn(b, 'Registrar huella en Stellar').click();
  await expect(b.getByText('La firma está guardada. Puedes reintentar el anclaje en Stellar.')).toBeVisible();
  await b.evaluate(key => { const identity = localStorage.getItem(key); localStorage.clear(); localStorage.setItem(key, identity); }, 'vespi-contributions:identity:v1');
  await b.clock.setFixedTime(new Date(Date.now() + 10_000));
  await b.reload();
  await btn(b, 'Registrar huella en Stellar').click();
  const receipt = await copy(b, 'Compartir constancia');
  assert.equal(mainnetAttempts.length, 2);
  assert.deepEqual(mainnetAttempts[0], mainnetAttempts[1]);
  assert.equal(getReceipts('mainnet').size, 1);
  assert.equal(receipt.searchParams.get('network'), 'mainnet');
  await checkProof(receipt, 'mainnet');
  await btn(b, '← Mis aportes').click();
  await b.goBack();
  await expect(b).toHaveURL(invitation.href);
  await expect(b.getByRole('heading', { name: title('mainnet'), exact: true })).toBeVisible();

  await legacyWizard(a, 'mainnet');
  await finishDraft(a, 'mainnet', { personal: true });
  await btn(a, 'Guardar declaración').click();
  await expect(a.getByRole('heading', { name: 'Mi declaración personal', level: 1 })).toBeVisible();
  await expect(a).toHaveURL(/\?network=mainnet&encuentro=[a-f0-9]{32}$/);
  const personalUrl = a.url();
  await btn(a, 'Registrar huella en Stellar').click();
  const personalReceipt = await copy(a, 'Compartir constancia');
  await checkProof(personalReceipt, 'mainnet', true);
  await signOut(a);
  await a.reload();
  await expect(a.getByRole('heading', { name: 'Entra para ver el encuentro' })).toBeVisible();
  await expect(a.getByText(description)).toHaveCount(0);
  await expect(a).toHaveURL(personalUrl);
  await checkSignedOut(author);
  const anonymousPersonal = await phone(undefined, { network: 'mainnet' });
  await anonymousPersonal.page.goto(personalUrl);
  await expect(anonymousPersonal.page.getByRole('heading', { name: 'Entra para ver el encuentro' })).toBeVisible();
  await expect(anonymousPersonal.page.getByText(description)).toHaveCount(0);
  await anonymousPersonal.context.close();
  await enter(a);
  await expect(a.getByRole('heading', { name: 'Mi declaración personal' })).toBeVisible();

  author.expectNetwork('testnet');
  await a.goto(origin + '/app');
  await expect(btn(a, 'Continuar borrador privado')).toHaveCount(0);
  await legacyWizard(a, 'testnet');
  await expect(a.locator('#title')).toHaveValue('');
  await recordVoice(a, 'testnet-encuentro');
  await expect(a.locator('#title')).toHaveValue(proposals.encounter.title);
  await finishDraft(a, 'testnet');
  await audit(a, 'testnet-proponer');
  await btn(a, 'Preparar invitación').click();
  const testInvite = await copy(a, 'Copiar enlace');
  assert.equal(testInvite.searchParams.has('network'), false);
  assert.match(testInvite.hash, /^#invitation=[a-f0-9]{64}$/);
  guest.expectNetwork('testnet');
  await b.goto(testInvite.href);
  await btn(b, 'Confirmar encuentro').click();
  await btn(b, 'Firmar y confirmar').click();
  const testReceipt = await copy(b, 'Compartir constancia');
  assert.equal(testReceipt.searchParams.has('network'), false);
  await checkProof(testReceipt, 'testnet');
  await a.goto(origin + '/app');
  await legacyWizard(a, 'testnet');
  await finishDraft(a, 'testnet', { personal: true });
  await btn(a, 'Guardar declaración').click();
  await expect(btn(a, 'Compartir constancia')).toBeVisible();
  const testPersonal = a.url();
  await signOut(a);
  await a.reload();
  await expect(a).toHaveURL(testPersonal);
  await expect(a.getByRole('heading', { name: 'Mi declaración personal' })).toHaveCount(0);
  await enter(a);
  await expect(a.getByRole('heading', { name: 'Mi declaración personal' })).toBeVisible();
  let finishLogout;
  let logoutStarted = false;
  let sessionSent = false;
  const slowLogout = new Promise(resolve => { finishLogout = resolve; });
  const intercept = async route => {
    const action = route.request().postDataJSON()?.action;
    if (action === 'logout') {
      logoutStarted = true;
      await slowLogout;
    }
    if (action === 'session') sessionSent = true;
    await route.fallback();
  };
  await a.route('**/api/contributions/encounters', intercept);
  await a.evaluate(() => {
    const request = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes('/api/contributions/encounters') &&
        typeof init?.body === 'string' && JSON.parse(init.body).action === 'logout') window.fixtureLogoutKeepalive = init.keepalive;
      return request(input, init);
    };
    void navigator.locks.request('vespi-encounters:testnet', () => new Promise(resolve => { window.releaseFixtureLock = resolve; }));
  });
  await a.waitForFunction(() => window.releaseFixtureLock);
  try {
    await signOut(a);
    await expect.poll(() => logoutStarted).toBe(true);
    assert.equal(await a.evaluate(() => window.fixtureLogoutKeepalive), true);
    await a.evaluate(() => window.releaseFixtureLock());
    await btn(a, 'Vespi Contributions, Inicio').click();
    await btn(a, 'Menú').click();
    await btn(a.getByRole('navigation'), 'Iniciar sesión').click();
    await btn(a, 'Entrar con mi passkey').click();
    await expect.poll(() => a.evaluate(async () =>
      (await navigator.locks.query()).pending.some(lock => lock.name === 'vespi-encounters:testnet'))).toBe(true);
    assert.equal(sessionSent, false);
    finishLogout();
    await expect(a.getByRole('dialog')).toBeHidden();
    await checkSession(author, 'Autora');
    await expect(a.getByRole('heading', { name: 'Registra y comparte aportes' })).toBeVisible();
    assert.equal(new URL(a.url()).searchParams.has('encuentro'), false);
  } finally {
    await a.evaluate(() => window.releaseFixtureLock());
    finishLogout();
    await a.unroute('**/api/contributions/encounters', intercept);
  }

  let releaseResponse;
  const waitForReload = new Promise(resolve => { releaseResponse = resolve; });
  let originalClose;
  let repeatClose = 0;
  const interceptReload = async route => {
    const body = route.request().postDataJSON();
    if (body?.action !== 'logout') return route.fallback();
    if (originalClose) {
      assert.deepEqual(body, originalClose);
      repeatClose++;
      return route.fallback();
    }
    originalClose = body;
    const response = await route.fetch();
    await waitForReload;
    // A browser may discard the original response on navigation, so also replay it below.
    await route.fulfill({ response }).catch(() => {});
  };
  await a.route('**/api/contributions/encounters', interceptReload);
  try {
    await signOut(a);
    await expect.poll(() => Boolean(originalClose)).toBe(true);
    assert.equal(originalClose.account, author.account());
    assert.match(originalClose.sessionId, /^[a-f0-9]{32}$/);
    await a.reload();
    await enter(a);
    assert.equal(repeatClose, 1, 'The new document completes the pending close before signing in');
    await checkSession(author, 'Autora');
    releaseResponse();
    assert.equal((await author.context.request.post(origin + '/api/contributions/encounters', { data: originalClose })).status(), 200);
    await checkSession(author, 'Autora');
  } finally {
    releaseResponse();
    await a.unroute('**/api/contributions/encounters', interceptReload);
  }
  for (const network of ['mainnet', 'testnet']) {
    assert.deepEqual(recordTests.filter(([n, action]) => n === network && ['publish', 'respond', 'xdr', 'anchor'].includes(action)).slice(0, 4),
      ['publish', 'respond', 'xdr', 'anchor'].map(action => [network, action]));
  }
  assert.equal(active.size, 2);
  assert.deepEqual(errors, []);
  console.log('Encounter proposal, session, response, anchor, private links, proof, voice and axe passed in both networks.');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.close();
}
process.exit(process.exitCode ?? 0);
