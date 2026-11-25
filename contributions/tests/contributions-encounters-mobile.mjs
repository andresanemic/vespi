// Chromium uses real passkeys and signatures. The application's HTTP endpoints and Horizon are fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes } from '../src/lib/contributions/kernel/contributions.js';
import { decisionMessage, encounterAccess, proposalMessage } from '../src/lib/contributions/encounters.ts';
import { englishDarkConsent, mockVoice, proposals, recordVoice, voiceChromium, voiceEnabled } from './fixtures/contributions-voice.mjs';
import { seedLegacyDraft } from './fixtures/contributions-legacy-draft.mjs';

const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM, args: voiceChromium });
const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3235';
const sponsor = Keypair.random();
const encounters = new Map();
const profiles = new Map();
let anchor;
let postsToStellar = 0;

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
const json = (route, data, status = 200) => route.fulfill({ json: data, status, headers: { 'Access-Control-Allow-Origin': '*' } });
const proof = (account, message, signature) =>
  Keypair.fromPublicKey(account).verify(Buffer.from(message), Buffer.from(signature, 'hex'));

async function newParticipant(name) {
  const context = await browser.newContext({ viewport: { width: 375, height: 629 }, isMobile: true, hasTouch: true, locale: 'es-CL' });
  if (voiceEnabled) await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true } });
  let account;
  let signedIn = false;
  await context.route('**/api/contributions/**', async route => {
    const url = new URL(route.request().url());
    if (await mockVoice(route, key => signedIn && name === 'Autora' && key === account, 'testnet')) return;
    if (url.pathname.endsWith('/network')) return json(route, { mainnet: false });
    if (url.pathname.endsWith('/account')) {
      account = route.request().postDataJSON().publicKey;
      return json(route, { ok: false, reason: 'already-onboarded' }, 409);
    }
    if (url.pathname.endsWith('/profiles')) {
      if (route.request().method() === 'GET') return json(route, { cursor: '0', entries: [...profiles.values()] });
      profiles.set(account, { account, displayName: name });
      return json(route, { ok: true });
    }
    if (url.pathname.includes('/profiles/')) return json(route, { account, displayName: name });
    if (url.pathname.endsWith('/encounters')) {
      if (route.request().method() === 'GET') {
        if (url.searchParams.has('session')) return json(route, { ok: true, profile: signedIn ? { account, displayName: name } : null });
        const id = url.searchParams.get('id');
        if (id) {
          const encounter = encounters.get(id);
          if (!encounter) return json(route, { ok: false, reason: 'not-found' }, 404);
          const access = encounterAccess(encounter, encounter.confirmed, signedIn ? account : null, {
            valid: route.request().headers()['x-vespi-invitation'] === digest(id),
            respondent: encounter.respondedBy?.account,
          });
          const visible = encounter.inviteMode === 'link' && account !== encounter.a.account
            ? { ...encounter, inviteUrl: undefined } : encounter;
          return access === 'allowed' ? json(route, { ok: true, encounter: visible })
            : json(route, { ok: false, reason: access }, access.endsWith('sign-in') ? 401 : 403);
        }
        return json(route, { ok: true, cursor: '0', entries: [...encounters.values()].filter(e =>
          e.a.account === account || e.b?.account === account || e.respondedBy?.account === account) });
      }
      const body = route.request().postDataJSON();
      if (body.action === 'session' || body.action === 'logout') {
        signedIn = body.action === 'session';
        return json(route, { ok: true });
      }
      if (body.action === 'publish') {
        assert.equal(body.draft.a.account, account);
        assert.ok(proof(account, proposalMessage(body.id, body.draft), body.signature));
        const encounter = { ...body.draft, id: body.id, createdAt: new Date().toISOString(),
          status: 'pending', confirmed: false, proposalSignature: body.signature, revision: 1,
          inviteUrl: '/app?encuentro=' + body.id + (body.draft.inviteMode === 'link' ? '#invitation=' + digest(body.id) : '') };
        encounters.set(body.id, encounter);
        return json(route, { ok: true, encounter });
      }
      const encounter = encounters.get(body.id);
      if (body.action === 'respond') {
        if (encounter.inviteMode === 'link') {
          assert.equal(body.invitation, digest(body.id));
          assert.equal(encounter.confirmed, false);
          assert.notEqual(encounter.a.account, account);
        } else assert.equal(encounter.b.account, account);
        assert.ok(proof(account, decisionMessage(body.id, encounter.proposalSignature, body.choice, body.note), body.signature));
        Object.assign(encounter, { status: 'confirmed', confirmed: true, decisionSignature: body.signature,
          respondedBy: { account, displayName: name }, anchorCommitment: 'c'.repeat(64) });
      }
      if (body.action === 'anchor') {
        assert.equal(body.receipt, anchor.digest);
        Object.assign(encounter, { anchor: body.receipt, receiptToken: 'd'.repeat(32) });
      }
      return json(route, { ok: true, encounter });
    }
    if (url.pathname.endsWith('/prepare')) {
      postsToStellar++;
      const bytes = canonicalBytes(route.request().postDataJSON());
      return json(route, { ok: true, bytes, digest: digest(bytes) });
    }
    if (url.pathname.endsWith('/anchor')) {
      const { bytes, xdr } = route.request().postDataJSON();
      const inner = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      assert.equal(inner.source, account);
      assert.ok(proof(account, inner.hash(), inner.signatures[0].signature().toString('hex')));
      const tx = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, Networks.TESTNET);
      tx.sign(sponsor);
      anchor = { bytes, digest: digest(bytes), txHash: tx.hash().toString('hex'), ledger: 12345,
        rehearsal: true, envelope_xdr: tx.toXDR() };
      return json(route, { ok: true, index: anchor });
    }
    if (url.searchParams.get('format') === 'index') return json(route, anchor);
    return route.fulfill({ body: anchor.bytes, contentType: 'application/json' });
  });
  await context.route('https://horizon-testnet.stellar.org/**', route =>
    route.request().url().includes('/accounts/') ? json(route, { sequence: '123' }) :
      json(route, { successful: true, hash: anchor.txHash, ledger: anchor.ledger, envelope_xdr: anchor.envelope_xdr }));
  return page;
}

async function createPasskey(page, name) {
  const dialog = page.getByRole('dialog');
  if (await dialog.getByRole('button', { name: 'Crear cuenta', exact: true }).isVisible()) {
    await dialog.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  }
  await dialog.getByRole('textbox', { name: 'Nombre visible' }).fill(name);
  await dialog.getByRole('button', { name: 'Crear cuenta con passkey' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

try {
  const header = await browser.newPage({ viewport: { width: 1920, height: 900 }, locale: 'es-CL' });
  await header.addInitScript(() => {
    window.gardenEntrances = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains('home-garden')) window.gardenEntrances++;
      return animate.apply(this, args);
    };
  });
  let releaseStyle;
  const delayedStyle = new Promise(resolve => { releaseStyle = resolve; });
  await header.route('**/meridian-front.css', async route => { await delayedStyle; await route.continue(); });
  await header.goto(origin + '/app', { waitUntil: 'domcontentloaded' });
  await header.locator('.meridian-entry').waitFor({ state: 'visible' });
  assert.equal(await header.getByRole('heading', { name: 'Registra y comparte aportes' }).isVisible(), false, 'Unstyled app is hidden');
  releaseStyle();
  await header.getByRole('heading', { name: 'Registra y comparte aportes' }).waitFor();
  await header.unroute('**/meridian-front.css');
  const appBackground = () => header.locator('.meridian-body').evaluate(el => getComputedStyle(el).backgroundColor);
  const originalBackground = await appBackground();
  const dark = await header.locator('html').getAttribute('data-theme') === 'dark';
  await header.getByRole('button', { name: dark ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro' }).click();
  assert.notEqual(await appBackground(), originalBackground, 'The app palette changes along with the theme');
  await header.getByRole('button', { name: dark ? 'Cambiar al tema oscuro' : 'Cambiar al tema claro' }).click();
  assert.equal(await header.evaluate(() => window.gardenEntrances), 1);
  for (const lang of ['es', 'en']) {
    if (lang === 'en') {
      await header.getByRole('button', { name: 'Read in English' }).click();
      await header.getByRole('heading', { name: 'Record and share contributions' }).waitFor();
    }
    const bar = await header.locator('.topbar').boundingBox();
    const row = await header.locator('.topbar-main').boundingBox();
    const controls = await header.locator('.topbar-tools').boundingBox();
    assert.ok(bar.x + bar.width - controls.x - controls.width <= 72, 'Desktop controls are aligned right');
    assert.ok(controls.x > row.x + row.width / 2, 'Desktop controls are in the right half');
    assert.ok(Math.abs((row.y + row.height / 2) - (controls.y + controls.height / 2)) <= 2);
  }
  for (const [width, height] of [[320, 640], [375, 629], [390, 844]]) {
    await header.setViewportSize({ width, height });
    assert.ok(await header.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const tools = header.locator('.topbar-tools');
    const controls = await tools.boundingBox();
    const brand = await header.locator('.mobile-brand').boundingBox();
    assert.ok(brand.x + brand.width <= controls.x, 'Brand and controls fit on one row');
    assert.ok(Math.abs(brand.y + brand.height / 2 - controls.y - controls.height / 2) <= 2, 'Mobile brand and tools share a row');
    for (const button of await tools.getByRole('button').all()) {
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44, 'Mobile header controls are touch-sized');
    }
    for (const [lang, destinations] of [['Menu', ['Home', 'Sign in', 'Create account']], ['Menú', ['Inicio', 'Iniciar sesión', 'Crear cuenta']]]) {
      const toggle = header.getByRole('button', { name: lang, exact: true });
      await toggle.click();
      const menu = header.getByRole('navigation');
      for (const name of destinations) {
        const button = menu.getByRole('button', { name, exact: true });
        assert.ok(await button.isVisible(), name + ' is visible');
        assert.ok(await button.evaluate(element => parseFloat(getComputedStyle(element).fontSize) > 10), name + ' has painted text');
      }
      await header.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      assert.ok(await toggle.evaluate(element => element.getRootNode().activeElement === element));
      await header.getByRole('button', { name: lang === 'Menu' ? 'Leer en español' : 'Read in English' }).click();
    }
  }
  await header.close();
  const [a, b, c] = await Promise.all([newParticipant('Autora'), newParticipant('Invitada'), newParticipant('Otra cuenta')]);
  for (const [page, name] of [[b, 'Invitada'], [c, 'Otra cuenta']]) {
    await page.goto(origin + '/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Menú', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await createPasskey(page, name);
  }
  await a.goto(origin + '/app', { waitUntil: 'domcontentloaded' });
  await a.getByRole('heading', { name: 'Registra y comparte aportes' }).waitFor();
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth), 375);
  if (voiceEnabled) {
    await a.getByRole('button', { name: 'Menú', exact: true }).click();
    await a.getByRole('navigation').getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await createPasskey(a, 'Autora');
  }
  await seedLegacyDraft(a);
  await a.goto(origin + '/app?vista=borrador-encuentro', { waitUntil: 'domcontentloaded' });
  if (voiceEnabled) {
    await englishDarkConsent(a);
    const title = a.getByLabel('Dale un nombre al encuentro');
    const date = a.getByLabel('¿Cuándo fue?');
    const initialDate = await date.inputValue();
    assert.match(initialDate, /^\d{4}-\d{2}-\d{2}$/);
    await title.fill('Título escrito');
    await recordVoice(a, 'testnet-encuentro', {
      inspect: true, field: title, choice: 'Agregar al final',
      expected: 'Título escrito ' + proposals.encounter.title, edit: 'Conversación de ensayo',
    });
    assert.equal(await a.getByLabel('Otra persona').inputValue(), 'Invitada');
    assert.equal(await date.inputValue(), initialDate);
    assert.equal(postsToStellar, 0);
    assert.equal(encounters.size, 0);
  } else await a.getByLabel('Dale un nombre al encuentro').fill('Conversación de ensayo');
  await a.getByLabel('Otra persona').fill('Invitada');
  const beforeExample = await a.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(key => key.endsWith(':testnet:encounter'))));
  await a.goto(origin + '/app?vista=ejemplo', { waitUntil: 'domcontentloaded' });
  await a.getByRole('heading', { name: 'El encuentro', level: 1 }).waitFor();
  await a.getByRole('button', { name: 'Continuar', exact: true }).click();
  await a.getByRole('button', { name: 'Continuar', exact: true }).click();
  await a.getByRole('heading', { name: 'Confirmado por ambos' }).waitFor();
  await a.getByRole('button', { name: 'Terminar ejemplo' }).click();
  assert.equal(await a.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(key => key.endsWith(':testnet:encounter')))), beforeExample);
  assert.equal(encounters.size, 0);
  await a.getByRole('button', { name: 'Continuar borrador privado' }).click();
  await a.getByRole('button', { name: /Continuar/ }).click();
  await a.getByRole('heading', { name: '¿Qué aportó cada persona?' }).waitFor();
  await a.waitForFunction(() => window.scrollY <= 2);
  await a.locator('[data-cfield="text"]').first().fill('Presenté un contacto.');
  await a.getByRole('button', { name: 'Read in English' }).click();
  await a.getByRole('heading', { name: 'What did each person contribute?' }).waitFor();
  assert.equal(await a.locator('[data-cfield="text"]').first().inputValue(), 'Presenté un contacto.');
  await a.getByRole('button', { name: 'Leer en español' }).click();
  await a.getByRole('button', { name: /Añadir otro aporte/ }).click();
  await a.locator('[data-cfield="text"]').last().fill('Compartió una referencia.');
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a.getByRole('heading', { name: '¿Qué aportó cada persona?' }).waitFor();
  assert.equal(await a.locator('[data-cfield="text"]').first().inputValue(), 'Presenté un contacto.');
  await a.getByRole('button', { name: /Continuar/ }).click();
  await a.getByRole('heading', { name: 'Revisar antes de compartir' }).waitFor();
  assert.equal(postsToStellar, 0);
  await a.getByRole('button', { name: 'Buscar en Vespi' }).click();
  await a.getByRole('button', { name: /^Invitada G[A-Z2-7]{55}$/ }).click();
  if (!voiceEnabled) {
    await a.getByRole('button', { name: 'Preparar invitación' }).click();
    await createPasskey(a, 'Autora');
  }
  assert.equal(encounters.size, 0, 'Signing in does not publish the invitation');
  await a.getByRole('button', { name: 'Preparar invitación' }).click();
  await a.getByRole('button', { name: 'Copiar enlace' }).waitFor();
  if (voiceEnabled) {
    assert.equal([...encounters.values()][0].title, 'Conversación de ensayo');
    assert.equal([...encounters.values()][0].where, 'Santiago');
  }
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await a.getByRole('button', { name: 'Copiar enlace' }).click();
  const shared = await a.evaluate(() => navigator.clipboard.readText());
  assert.equal(shared, a.url());
  await a.getByRole('heading', { name: 'Enlace listo para compartir' }).waitFor();
  assert.equal(await a.getByRole('button', { name: 'Confirmar encuentro' }).count(), 0);
  assert.equal(postsToStellar, 0);
  assert.match(a.url(), /encuentro=[a-f0-9]{32}$/);
  await c.goto(shared, { waitUntil: 'domcontentloaded' });
  await c.getByRole('heading', { name: 'Abre el enlace completo o entra con la cuenta invitada' }).waitFor();
  await c.getByRole('button', { name: 'Entrar con otra cuenta' }).waitFor();
  assert.equal(await c.getByText('Presenté un contacto.', { exact: true }).count(), 0);
  assert.equal(await c.getByRole('button', { name: 'Confirmar encuentro' }).count(), 0);
  await c.goto(origin + '/app?encuentro=' + 'f'.repeat(32), { waitUntil: 'domcontentloaded' });
  await c.getByRole('heading', { name: 'No se pudo abrir el encuentro.' }).waitFor();
  await c.getByRole('button', { name: 'Reintentar' }).waitFor();
  assert.equal(await c.getByRole('button', { name: 'Entrar con otra cuenta' }).count(), 0);
  await b.goto(shared, { waitUntil: 'domcontentloaded' });
  await b.getByText('Presenté un contacto.', { exact: true }).waitFor();
  await b.getByText('Compartió una referencia.', { exact: true }).waitFor();
  assert.equal(await b.getByText('Confirmado por ambos', { exact: true }).count(), 0);
  const invitation = b.url();
  await b.getByRole('button', { name: 'Read in English' }).click();
  await b.getByText('Autora invited you to review this encounter.', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Confirm encounter' }).waitFor();
  assert.equal(b.url(), invitation);
  await b.getByRole('button', { name: 'Leer en español' }).click();
  await b.getByRole('button', { name: 'Confirmar encuentro' }).click();
  assert.equal(encounters.values().next().value.confirmed, false);
  await b.getByRole('button', { name: 'Firmar y confirmar' }).click();
  await b.getByText('Confirmado por ambos', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Compartir constancia' }).waitFor();
  assert.equal(postsToStellar, 1);
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a.getByText('Confirmado por ambos', { exact: true }).waitFor();
  assert.equal(await a.locator('.encounter-state.just-confirmed').count(), 0, 'A saved confirmation does not replay');
  await a.getByRole('button', { name: 'Menú', exact: true }).click();
  await a.getByRole('navigation').getByRole('button', { name: 'Mi cuenta' }).click();
  await a.getByRole('dialog', { name: 'Mi cuenta' }).getByText(/^G[A-Z2-7]{55}$/).waitFor();
  a.once('dialog', dialog => dialog.accept());
  await a.getByRole('button', { name: 'Cerrar sesión' }).click();
  await a.getByRole('button', { name: 'Menú', exact: true }).click();
  await a.getByRole('navigation').getByRole('button', { name: 'Iniciar sesión' }).click();
  await a.getByRole('button', { name: 'Entrar con mi passkey' }).click();
  await a.getByRole('dialog').waitFor({ state: 'hidden' });
  await a.getByRole('button', { name: 'Vespi Contributions, Inicio' }).click();
  await seedLegacyDraft(a);
  await a.goto(origin + '/app?vista=borrador-encuentro', { waitUntil: 'domcontentloaded' });
  const dateBounds = await a.locator('input[type=date]').evaluate(node => ({
    date: node.getBoundingClientRect().right,
    field: node.parentElement.getBoundingClientRect().right,
  }));
  assert.ok(dateBounds.date <= dateBounds.field + 1, 'Date fits its column');
  await a.getByLabel('Dale un nombre al encuentro').fill('Invitación para una cuenta nueva');
  await a.getByLabel('Otra persona').fill('Persona nueva');
  await a.getByRole('button', { name: /Continuar/ }).click();
  await a.locator('[data-cfield="text"]').first().fill('Compartí una guía para el evento.');
  await a.getByRole('button', { name: /Continuar/ }).click();
  await a.getByRole('button', { name: 'La otra persona todavía no tiene cuenta' }).click();
  await a.getByRole('button', { name: 'Preparar invitación' }).click();
  await a.getByRole('button', { name: 'Copiar enlace' }).click();
  const link = await a.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#invitation=[a-f0-9]{64}$/);
  const freshGuest = await newParticipant('Invitada nueva');
  await freshGuest.goto(link.split('#')[0], { waitUntil: 'domcontentloaded' });
  await freshGuest.getByRole('heading', { name: 'Abre el enlace completo o entra con la cuenta invitada' }).waitFor();
  await freshGuest.getByRole('button', { name: 'Volver a Inicio' }).waitFor();
  await freshGuest.goto(link, { waitUntil: 'domcontentloaded' });
  await freshGuest.getByRole('heading', { name: 'Tienes una invitación en Vespi' }).waitFor();
  await freshGuest.reload({ waitUntil: 'domcontentloaded' });
  await freshGuest.getByRole('heading', { name: 'Tienes una invitación en Vespi' }).waitFor();
  assert.equal(freshGuest.url(), link);
  assert.equal(await freshGuest.getByText('Compartí una guía para el evento.', { exact: true }).count(), 0);
  await freshGuest.locator('[data-act="claim-register"]').click();
  await createPasskey(freshGuest, 'Invitada nueva');
  await freshGuest.waitForFunction(() =>
    document.querySelector('#meridian-reference').shadowRoot.activeElement?.textContent === 'Invitación para una cuenta nueva');
  await freshGuest.getByRole('button', { name: 'Confirmar encuentro' }).click();
  await freshGuest.getByRole('button', { name: 'Firmar y confirmar' }).click();
  await freshGuest.getByText('Confirmado por ambos', { exact: true }).waitFor();
  await freshGuest.getByRole('button', { name: 'Compartir constancia' }).waitFor();
  await c.goto(link, { waitUntil: 'domcontentloaded' });
  await c.getByRole('heading', { name: 'Esta invitación corresponde a otra cuenta' }).waitFor();
  assert.equal(await c.getByText('Compartí una guía para el evento.', { exact: true }).count(), 0);
  const ownerKey = Keypair.random();
  const peerKey = Keypair.random();
  const owner = { account: ownerKey.publicKey(), displayName: 'Autora' };
  const peer = { account: peerKey.publicKey(), displayName: 'Sofía' };
  const archive = [
    { status: 'pending', title: 'Revisión de Sofía', a: peer, b: owner },
    { status: 'correction', title: 'Cambios del equipo', a: owner, b: peer },
    { status: 'pending', title: 'Pendiente de Ana', a: owner, b: { account: '', displayName: 'Ana' } },
    ...['Apunte del lunes', 'Apunte del martes', 'Apunte del miércoles', 'Apunte del jueves', 'Apunte del viernes']
      .map(title => ({ status: 'personal', title, a: owner, b: null })),
  ];
  const historyRows = archive.map((sample, index) => {
    const id = (index + 1).toString(16).padStart(32, '0');
    const record = {
      ...sample, id, type: 'charla', date: '2026-11-18', where: 'Santiago',
      summary: '', createdAt: new Date(Date.UTC(2026, 10, 18, index)).toISOString(),
      contributions: [{ from: 'a', text: 'Compartimos los apuntes.', url: '' }],
    };
    const key = record.a === owner ? ownerKey : peerKey;
    record.proposalSignature = key.sign(Buffer.from(proposalMessage(id, record))).toString('hex');
    if (record.status === 'correction') {
      record.respondedBy = peer;
      record.note = 'Falta indicar el horario.';
      record.decisionSignature = peerKey.sign(Buffer.from(decisionMessage(id, record.proposalSignature, 'correction', record.note))).toString('hex');
    }
    return record;
  });
  const historyPage = await browser.newPage({ viewport: { width: 375, height: 629 }, isMobile: true, hasTouch: true, locale: 'es-CL' });
  await historyPage.addInitScript(person => localStorage.setItem('vespi-contributions:identity:v1', JSON.stringify(person)), owner);
  await historyPage.route('**/api/contributions/activity/**', route => json(route, { cursor: '0', entries: [] }));
  await historyPage.route('**/api/contributions/encounters?*', route => {
    const { searchParams } = new URL(route.request().url());
    if (searchParams.has('session')) return json(route, { ok: true, profile: owner });
    if (searchParams.has('id')) return json(route, { ok: true, encounter: historyRows.find(record => record.id === searchParams.get('id')) });
    return json(route, { ok: true, cursor: '0', entries: historyRows });
  });
  await historyPage.goto(origin + '/app', { waitUntil: 'domcontentloaded' });
  await historyPage.getByRole('heading', { name: 'Me toca actuar' }).waitFor();
  await historyPage.getByRole('button', { name: 'Menú', exact: true }).click();
  await historyPage.getByRole('navigation').getByRole('button', { name: 'Mis aportes', exact: true }).click();
  await historyPage.getByRole('heading', { name: 'Mis aportes', level: 1 }).waitFor();
  await historyPage.getByRole('heading', { name: 'Te toca firmar', exact: true }).waitFor();
  await historyPage.getByText('Revisión de Sofía', { exact: true }).waitFor();
  await historyPage.getByText('Cambios del equipo', { exact: true }).waitFor();
  await historyPage.getByRole('heading', { name: 'Esperas a otra persona', exact: true }).waitFor();
  await historyPage.getByText('Pendiente de Ana', { exact: true }).waitFor();
  assert.equal(await historyPage.getByRole('link', { name: 'Ver registro', exact: true }).count(), historyRows.length);
  assert.equal(await historyPage.locator('.mobile-history article').filter({ hasText: 'Privado' }).count(), historyRows.length);
  const oldRecord = historyPage.getByRole('article').filter({ hasText: 'Apunte del lunes' }).getByRole('link', { name: 'Ver registro' });
  await oldRecord.scrollIntoViewIfNeeded();
  const scroll = await historyPage.evaluate(() => window.scrollY);
  assert.ok(scroll > 30, 'The archive is long enough to verify scroll restoration');
  await oldRecord.click();
  await historyPage.getByRole('heading', { name: 'Apunte del lunes', level: 1 }).waitFor();
  await historyPage.getByText('Declaración personal', { exact: true }).waitFor();
  await historyPage.goBack();
  await historyPage.getByRole('heading', { name: 'Mis aportes', level: 1 }).waitFor();
  await historyPage.waitForFunction(position => Math.abs(window.scrollY - position) <= 2, scroll);
  console.log('Meridian: responsive menu, draft and language, one artwork reveal, directed and one-use invitations, virtual passkeys, explicit confirmation and Stellar fixture.');
} finally {
  await browser.close();
}
