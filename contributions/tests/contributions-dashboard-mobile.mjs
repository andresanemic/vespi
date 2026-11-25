// Run against the local app. HTTP responses are fixtures; the passkey and XDR signature are real.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes } from '../src/lib/contributions/kernel/contributions.js';

const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
try {
  const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3235';
  const context = await browser.newContext({ viewport: { width: 375, height: 629 }, isMobile: true, hasTouch: true, locale: 'es-CL' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true } });
  const sponsor = Keypair.random();
  const otherAccount = Keypair.random().publicKey();
  let account;
  let accountPosts = 0;
  let signPosts = 0;
  let confirmed;
  let activityPages = false;
  let activityOffline = true;
  const json = (route, data, status = 200) => route.fulfill({ json: data, status, headers: { 'Access-Control-Allow-Origin': '*' } });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  await context.route('**/api/contributions/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/voice')) return json(route, { voice: false });
    if (path.endsWith('/network')) return json(route, { mainnet: false });
    if (path.endsWith('/account')) {
      accountPosts++;
      account = route.request().postDataJSON().publicKey;
      return json(route, { ok: false, reason: 'already-onboarded' }, 409);
    }
    if (path.includes('/profiles/')) {
      const actor = path.split('/').at(-1);
      return json(route, { account: actor, displayName: actor === otherAccount ? 'Contraparte' : 'Participante' });
    }
    if (path.includes('/activity/')) {
      if (!activityPages) return json(route, { cursor: '0', entries: [] });
      const second = new URL(route.request().url()).searchParams.get('cursor') === '7';
      if (second && activityOffline) return json(route, {}, 503);
      const digest = (second ? '2' : '1').repeat(64);
      const context = second ? 'Solicitud de la segunda página' : 'Solicitud de la primera página';
      return json(route, { cursor: second ? '0' : '7', entries: [{
        root: digest, digest, head: digest, action: 'REQUEST', state: 'REQUEST', createdAt: '2026-11-23T00:00:00Z',
        statement: context, context,
      }] });
    }
    if (path.endsWith('/encounters')) return json(route, { ok: true, cursor: '0', entries: [] });
    if (path.endsWith('/prepare')) {
      signPosts++;
      const body = route.request().postDataJSON();
      assert.equal(body.actor, account);
      const bytes = canonicalBytes(body);
      return json(route, { ok: true, bytes, digest: hash(bytes) });
    }
    if (path.endsWith('/anchor')) {
      const { bytes, xdr } = route.request().postDataJSON();
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      assert.ok(Keypair.fromPublicKey(account).verify(tx.hash(), tx.signatures[0].signature()));
      const envelope = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, tx, Networks.TESTNET);
      envelope.sign(sponsor);
      confirmed = { bytes, digest: hash(bytes), txHash: envelope.hash().toString('hex'),
        envelope: envelope.toXDR(), ledger: 12345, rehearsal: true };
      return json(route, { ok: true, index: confirmed });
    }
    if (path.includes('/chains/')) return json(route, { request: confirmed.digest, head: confirmed.digest, kind: 'REQUEST' });
    if (route.request().url().endsWith('?format=index')) return json(route, confirmed);
    return route.fulfill({ body: confirmed.bytes, contentType: 'application/json' });
  });
  await context.route('https://horizon-testnet.stellar.org/**', route =>
    route.request().url().includes('/accounts/') ? json(route, { sequence: '123' }) :
      json(route, { successful: true, hash: confirmed.txHash, ledger: confirmed.ledger, envelope_xdr: confirmed.envelope }));

  await page.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('link', { name: /Charla de Yerko/ }).count(), 0);
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
  await page.getByRole('textbox', { name: 'Nombre para tu passkey' }).fill('Ensayo');
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
  await page.getByRole('heading', { name: 'Mis aportes' }).waitFor();
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('vespi-contributions:identity:v1')));
  assert.deepEqual(remembered, { account, displayName: 'Participante' });
  assert.equal(await page.getByRole('link', { name: /Charla de Yerko/ }).count(), 0);
  await page.goto(origin + '/app/evento/yerko', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Abrir presentación (PDF)' }).waitFor();
  await page.goto(origin + '/app?evento=yerko', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Revisar el registro de Yerko' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Firmar' }).waitFor();
  assert.equal(signPosts, 0);
  await page.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Mis aportes' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Crear una passkey' }).count(), 0);
  assert.equal(accountPosts, 1);

  await page.getByRole('link', { name: 'Registrar un aporte', exact: true }).click();
  await page.getByRole('button', { name: 'Alguien me ayudó' }).click();
  await page.getByRole('heading', { name: '¿Qué hizo por ti?' }).waitFor();
  await page.getByRole('textbox', { name: '¿Qué hizo por ti?' }).waitFor();
  assert.equal(signPosts, 0);
  await page.evaluate(actor => localStorage.setItem('vespi-contributions:draft:' + actor + ':testnet:request',
    JSON.stringify({ statement: 'Borrador de ayuda recibida.', received: true })), account);
  await page.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Continuar borrador de ayuda recibida' }).click();
  await page.getByLabel('Describe lo que recibiste').waitFor();
  assert.equal(await page.getByLabel('Describe lo que recibiste').inputValue(), 'Borrador de ayuda recibida.');
  await page.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: '¿Necesitas ayuda? Pide un aporte', exact: true }).click();
  await page.getByRole('heading', { name: '¿Qué aporte necesitas?' }).waitFor();
  await page.getByLabel('Escribe tu solicitud').waitFor();
  await page.getByLabel('Escribe tu solicitud').fill('Un aporte para revisar');
  await page.getByText('Más detalles', { exact: true }).click();
  await page.getByRole('textbox', { name: '¿Con quién fue? (opcional)' }).fill(otherAccount);
  await page.getByRole('button', { name: 'Comprobar cuenta' }).click();
  await page.getByText('Contraparte', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Firmar' }).waitFor();
  assert.equal(signPosts, 0);
  await page.getByRole('button', { name: 'Firmar' }).click();
  await page.getByRole('button', { name: 'Invita a quien entrega' }).click();
  assert.equal(await page.getByLabel('Cuenta de quien entrega (G…)').inputValue(), otherAccount);
  assert.equal(signPosts, 1);

  activityPages = true;
  await page.goto(origin + '/app?vista=aportes');
  await page.getByRole('alert').filter({ hasText: 'No pudimos cargar tus aportes.' }).waitFor();
  await page.getByText('Solicitud de la primera página', { exact: true }).waitFor();
  assert.equal(await page.getByText('Solicitud de la segunda página', { exact: true }).count(), 0);
  activityOffline = false;
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await page.getByText('Solicitud de la segunda página', { exact: true }).waitFor();
  await page.getByText('Solicitud de la primera página', { exact: true }).waitFor();

  await page.goto(origin + '/app?evento=yerko', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Revisar el registro de Yerko' }).click();
  await page.getByRole('button', { name: 'Editar' }).click();
  const statement = page.getByLabel('Escribe tu solicitud');
  assert.match(await statement.inputValue(), /Yerko/i);
  assert.equal(await page.getByRole('link', { name: '¿Necesitas ayuda? Pide un aporte', exact: true }).count(), 0);
  await statement.fill('Texto ajustado para Yerko');
  assert.equal(signPosts, 1);
  const witnessUrl = origin + '/app?observe=' + 'a'.repeat(64);
  await page.goto(witnessUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'WhatsApp' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => { window.vespiCopied = value; },
    } });
  });
  await page.getByRole('button', { name: 'Entrar con passkey' }).click();
  await page.getByRole('button', { name: 'Copiar enlace para abrir en el navegador' }).click();
  assert.equal(await page.evaluate(() => window.vespiCopied), witnessUrl);
  console.log('Dashboard: remembered public identity, signing unlock after refresh, explicit publication, preselected account and editable Yerko draft.');
} finally {
  await browser.close();
}
