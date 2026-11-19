// Start Next dev on port 3221, or set VESPI_APP_URL. Browser signatures are real and HTTP replies are fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes, surveyCommitment } from '../src/lib/contributions/kernel/contributions.js';

const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
try {
  const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3221';
  const context = await browser.newContext({ viewport: { width: 375, height: 629 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true } });
  const hash = value => createHash('sha256').update(value).digest('hex');
  const json = (route, data, status = 200) => route.fulfill({ json: data, status, headers: { 'Access-Control-Allow-Origin': '*' } });
  const sponsor = Keypair.random();
  const salt = 'ab'.repeat(16);
  const privateAnswers = new Map();
  const accountEmail = 'private@example.test';
  let actor;
  let profileReads = 0;
  let mismatched = true;
  let lostAnonResponse = true;
  let staleCohort = true;
  let lastPost;
  let anchored;

  await context.route('**/api/contributions/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/account')) {
      const account = route.request().postDataJSON().publicKey;
      if (actor) assert.equal(account, actor);
      actor = account;
      return json(route, { ok: false, reason: 'already-onboarded' }, 409);
    }
    if (path.includes('/profiles/')) {
      profileReads++;
      return json(route, { account: actor, displayName: 'Ensayo' });
    }
    if (path.endsWith('/survey')) {
      const body = route.request().postDataJSON();
      assert.equal(body.cohort, process.env.VESPI_SURVEY_COHORT ?? 'rehearsal');
      if (staleCohort) {
        staleCohort = false;
        return json(route, { ok: false, reason: 'survey-cohort-changed' }, 409);
      }
      const stored = privateAnswers.get(body.id);
      if (stored) assert.deepEqual(body, stored);
      else privateAnswers.set(body.id, body);
      if (body.actor === null && lostAnonResponse) {
        lostAnonResponse = false;
        return route.abort('timedout');
      }
      const commitment = body.actor && mismatched ? '0'.repeat(64) : surveyCommitment(salt, body.answer);
      return json(route, { ok: true, answer: body.answer, salt, commitment });
    }
    if (path.endsWith('/prepare')) {
      const draft = route.request().postDataJSON();
      assert.equal(draft.kind, 'SURVEY');
      assert.deepEqual(Object.keys(draft.evidence), ['commitment']);
      const bytes = canonicalBytes(draft);
      return json(route, { ok: true, bytes, digest: hash(bytes) });
    }
    if (path.endsWith('/anchor')) {
      const post = route.request().postDataJSON();
      const stored = privateAnswers.get(post.surveyId);
      assert.equal(stored.actor, actor);
      assert.equal(JSON.parse(post.bytes).evidence.commitment, surveyCommitment(salt, stored.answer));
      for (const privateValue of [salt, accountEmail, stored.answer.project]) assert.ok(!post.bytes.includes(privateValue));
      if (!lastPost) {
        lastPost = post;
        return route.abort('timedout');
      }
      assert.deepEqual(lastPost, post);
      const inner = TransactionBuilder.fromXDR(post.xdr, Networks.TESTNET);
      assert.ok(Keypair.fromPublicKey(actor).verify(inner.hash(), inner.signatures[0].signature()));
      const envelope = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, Networks.TESTNET);
      envelope.sign(sponsor);
      anchored = { digest: hash(post.bytes), txHash: envelope.hash().toString('hex'), ledger: 12345,
        rehearsal: false, envelope: envelope.toXDR(), bytes: post.bytes };
      return json(route, { ok: true, index: anchored });
    }
    assert.ok(anchored);
    if (route.request().url().endsWith('?format=index')) {
      const { envelope, bytes, ...index } = anchored;
      assert.ok(envelope && bytes);
      return json(route, index);
    }
    return route.fulfill({ body: anchored.bytes, contentType: 'application/json' });
  });
  await context.route('https://horizon-testnet.stellar.org/**', route =>
    route.request().url().includes('/accounts/') ? json(route, { sequence: '123' }) :
      json(route, { successful: true, hash: anchored.txHash, ledger: anchored.ledger, envelope_xdr: anchored.envelope }));

  const fill = async email => {
    await page.getByRole('radio', { name: '4', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Estoy construyendo un proyecto' }).check();
    await page.getByRole('textbox', { name: 'Cuéntanos qué' }).fill('Proyecto privado');
    if (email) await page.locator('#survey-email').fill(email);
  };
  const send = page.getByRole('button', { name: 'Enviar respuestas' });
  await page.goto(origin + '/app/encuesta', { timeout: 60_000, waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Responder sin cuenta' }).click();
  await fill();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
  await send.click();
  await page.getByRole('alert').getByText('Terminó el ensayo.').waitFor();
  assert.ok(await send.isDisabled());
  assert.equal(privateAnswers.size, 0);
  await page.getByRole('button', { name: 'Read in English' }).click();
  await page.getByRole('alert').getByText('The rehearsal ended.').waitFor();
  await page.getByRole('button', { name: 'Leer en español' }).click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.getByRole('button', { name: 'Reabrir la encuesta' }).click(),
  ]);
  await page.getByRole('button', { name: 'Responder sin cuenta' }).click();
  await fill();
  await send.click();
  await page.getByRole('alert').getByText('No pudimos confirmar el envío.').waitFor();
  await send.click();
  await page.getByText('Recibimos tus respuestas', { exact: true }).waitFor();
  assert.equal(privateAnswers.size, 1);
  assert.equal([...privateAnswers.values()][0].answer.email, null);

  await page.goto(origin + '/app/encuesta', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
  await page.getByRole('textbox', { name: 'Nombre para tu passkey' }).fill('Ensayo');
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
  await fill(accountEmail);
  await send.click();
  await page.getByRole('alert').getByText('La huella que recibimos no coincide').waitFor();
  assert.equal(lastPost, undefined);
  mismatched = false;
  await send.click();
  await page.getByText('Recibimos tus respuestas', { exact: true }).waitFor();
  await page.locator('summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar mis respuestas y el código' }).click();
  const download = await downloadPromise;
  const proof = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(proof.salt, salt);
  assert.equal(JSON.parse(proof.canonicalAnswer).email, accountEmail);
  await page.getByRole('button', { name: 'Firmar «Respondí la encuesta»' }).click();
  await page.getByRole('alert').getByText('No pudimos confirmar la firma.').waitFor();
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!local.includes(salt) && !local.includes(accountEmail) && !local.includes('Proyecto privado'));
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Entrar para responder y obtener un recibo' }).click();
  await page.getByRole('button', { name: 'Comprobar de nuevo' }).click();
  await page.getByRole('link', { name: 'Abrir recibo público' }).click();
  await page.getByRole('heading', { name: 'Firma y recibo verificados' }).waitFor();
  assert.ok(!(await page.locator('main').innerText()).includes(accountEmail));
  assert.ok(!(await page.locator('main').innerText()).includes(salt));
  assert.equal(privateAnswers.size, 2);
  assert.equal(profileReads, 2);
  console.log('Survey: anonymous and signed, stable retries, cohort cutoff, commitment validation, optional private download, recovery without session and verified public receipt.');
} finally {
  await browser.close();
}
