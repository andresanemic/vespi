// Start Next dev on port 3225. Network responses are fixtures; all receipt signatures are real.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes } from '../src/lib/contributions/kernel/contributions.js';
import { assignmentMessage } from '../src/lib/contributions/contribution-assignment.ts';
import { photoUploadMessage } from '../src/lib/contributions/photo-authorization.ts';

const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3225';
const sponsor = Keypair.random();
const receipts = new Map();
const heads = new Map();
const accounts = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (route, data, status = 200) => route.fulfill({ json: data, status, headers: { 'Access-Control-Allow-Origin': '*' } });
let head;
let corruptDelivery;
let photoAttempts = 0;
let photoEvidence;

async function setup(who, withAccount = true) {
  const context = await browser.newContext({ viewport: { width: 375, height: 629 }, isMobile: true, hasTouch: true, locale: 'es-CL' });
  const page = await context.newPage();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: async payload => { window.lastVespiShare = payload; } });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1',
    transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true } });
  await context.route('**/api/contributions/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/voice')) return json(route, { voice: false });
    if (path.endsWith('/network')) return json(route, { mainnet: false });
    if (path.endsWith('/encounters')) return json(route, { ok: true, cursor: '0', entries: [] });
    if (path.includes('/activity/')) {
      const account = path.split('/').at(-1);
      const entries = [...receipts.values()].filter(item => item.draft.actor === account && item.draft.kind === 'REQUEST')
        .map(item => ({
          root: item.digest, digest: item.digest, head: heads.get(item.digest).digest, state: heads.get(item.digest).draft.kind,
          action: item.draft.kind, statement: item.draft.statement, context: item.draft.statement, createdAt: item.draft.createdAt,
        }));
      return json(route, { cursor: '0', entries });
    }
    if (path.endsWith('/account')) {
      const actor = route.request().postDataJSON().publicKey;
      if (accounts.has(who)) assert.equal(actor, accounts.get(who));
      else accounts.set(who, actor);
      return json(route, { ok: false, reason: 'already-onboarded' }, 409);
    }
    if (path.endsWith('/profiles')) {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      return cursor === '0' ? json(route, { cursor: '2', entries: [] }) :
        json(route, { cursor: '0', entries: [...accounts].map(([displayName, account]) => ({ account, displayName })) });
    }
    if (path.includes('/profiles/')) {
      const account = path.split('/').at(-1);
      const displayName = [...accounts.keys()].find(candidate => accounts.get(candidate) === account);
      return displayName ? json(route, { account, displayName }) : json(route, { ok: false }, 404);
    }
    if (path.includes('/chains/')) {
      const request = path.split('/').at(-1);
      const latest = heads.get(request);
      return latest ? json(route, { request, head: latest.digest, kind: latest.draft.kind }) : json(route, {}, 404);
    }
    if (path.endsWith('/photos')) {
      const { actor, sha256, expiresAt, signature, base64 } = route.request().postDataJSON();
      assert.equal(actor, accounts.get(who));
      assert.equal(sha256, hash(Buffer.from(base64, 'base64')));
      assert.ok(Keypair.fromPublicKey(actor).verify(Buffer.from(photoUploadMessage(actor, sha256, expiresAt)),
        Buffer.from(signature, 'hex')));
      photoAttempts++;
      if (photoAttempts === 1) return json(route, { ok: false, reason: 'photo-unavailable' }, 503);
      photoEvidence = { uri: 'https://vespi.xyz/api/contributions/photos/' + sha256, sha256 };
      return json(route, { ok: true, evidence: photoEvidence });
    }
    if (path.endsWith('/prepare')) {
      const bytes = canonicalBytes(route.request().postDataJSON());
      return json(route, { ok: true, bytes, digest: hash(bytes) });
    }
    if (path.endsWith('/anchor')) {
      const { bytes, xdr, assignment } = route.request().postDataJSON();
      const draft = JSON.parse(bytes);
      const inner = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      assert.equal(inner.source, accounts.get(who));
      assert.equal(draft.actor, accounts.get(who));
      assert.ok(Keypair.fromPublicKey(draft.actor).verify(inner.hash(), inner.signatures[0].signature()));
      if (draft.kind === 'CONTRIBUTE') {
        assert.ok(['REQUEST', 'CONTRIBUTE'].includes(head.draft.kind));
        assert.equal(draft.prev, head.digest);
        assert.equal(draft.chain, head.draft.chain ?? head.digest);
        if (head.draft.kind === 'REQUEST') {
          assert.ok(Keypair.fromPublicKey(head.draft.actor).verify(Buffer.from(assignmentMessage(draft.chain, draft.actor)),
            Buffer.from(assignment, 'hex')));
        } else {
          assert.equal(draft.actor, head.draft.actor);
          assert.equal(assignment, undefined);
        }
      }
      if (draft.kind === 'ATTEST') {
        const observed = receipts.get(draft.subject);
        assert.equal(observed.draft.kind, 'CONTRIBUTE');
        assert.equal(head.digest, observed.digest);
        assert.equal(draft.chain, observed.draft.chain);
        assert.equal(draft.prev, null);
        assert.equal(draft.role, 'observer');
        assert.equal(draft.comment, 'Vi la demostración completa');
        assert.deepEqual(draft.evidence, photoEvidence);
        assert.notEqual(draft.actor, observed.draft.actor);
        assert.notEqual(draft.actor, receipts.get(draft.chain).draft.actor);
      }
      if (draft.kind === 'ACCEPT') {
        assert.equal(head.draft.kind, 'CONTRIBUTE');
        assert.equal(draft.subject, head.digest);
        assert.equal(draft.prev, head.digest);
        assert.equal(draft.actor, receipts.get(draft.chain).draft.actor);
      }
      const tx = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, inner, Networks.TESTNET);
      tx.sign(sponsor);
      const index = { digest: hash(bytes), txHash: tx.hash().toString('hex'), ledger: 12345, rehearsal: true };
      const confirmed = { ...index, index, bytes, draft, xdr: tx.toXDR() };
      if (draft.kind !== 'ATTEST') {
        head = confirmed;
        heads.set(draft.chain ?? index.digest, confirmed);
      }
      receipts.set(index.digest, confirmed);
      return json(route, { ok: true, index });
    }
    const data = receipts.get(path.split('/').at(-1));
    assert.ok(data);
    if (route.request().url().endsWith('?format=index')) return json(route, data.index);
    const bytes = corruptDelivery === data.digest ? data.bytes + ' ' : data.bytes;
    return route.fulfill({ body: bytes, contentType: 'application/json' });
  });
  await context.route('https://horizon-testnet.stellar.org/**', route => {
    if (route.request().url().includes('/accounts/')) return json(route, { sequence: '123' });
    const data = [...receipts.values()].find(item => route.request().url().endsWith(item.txHash));
    return json(route, { successful: true, hash: data.txHash, ledger: data.ledger, envelope_xdr: data.xdr });
  });
  if (withAccount) {
    await page.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
    await createAccount(page, who);
    await page.getByRole('heading', { name: 'Mis aportes', exact: true }).waitFor();
  }
  return page;
}

async function createAccount(page, who) {
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
  await page.getByRole('textbox', { name: 'Nombre para tu passkey' }).fill(who);
  await page.getByRole('button', { name: 'Crear una passkey' }).click();
}

try {
  const [a, b, observer] = await Promise.all([setup('Solicitante'), setup('Aportante', false), setup('Observadora')]);
  assert.equal(await a.getByRole('link', { name: 'Mi perfil' }).getAttribute('href'),
    '/app/perfil/' + accounts.get('Solicitante'));
  await a.getByRole('link', { name: '¿Necesitas ayuda? Pide un aporte', exact: true }).click();
  await a.getByRole('textbox', { name: 'Escribe tu solicitud' }).fill('Feedback recibido después de la charla');
  await a.getByRole('button', { name: 'Continuar' }).click();
  await a.getByRole('button', { name: 'Firmar' }).click();
  const inviteNext = a.getByRole('button', { name: 'Invita a quien entrega' });
  await inviteNext.waitFor();
  const request = head.digest;
  await a.getByRole('button', { name: 'Compartir solicitud' }).click();
  const unsignedLink = await a.evaluate(() => window.lastVespiShare.url);
  assert.equal(unsignedLink, origin + '/app?continue=' + request);
  assert.equal(accounts.has('Aportante'), false);
  await b.goto(unsignedLink, { waitUntil: 'domcontentloaded' });
  await b.getByText('Si ya tienes una cuenta, entra con ella.', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Entrar con passkey' }).waitFor();
  await createAccount(b, 'Aportante');
  await b.getByRole('heading', { name: 'Falta la autorización de Solicitante' }).waitFor();
  await b.getByRole('button', { name: 'Compartir mi cuenta con Solicitante' }).click();
  const newAccount = accounts.get('Aportante');
  const accountMessage = await b.evaluate(() => window.lastVespiShare.text);
  const accountEnding = newAccount.slice(-4);
  assert.ok(accountMessage.includes(`terminada en ${accountEnding}.`));
  assert.ok(accountMessage.endsWith(newAccount));
  const accountWhatsApp = await b.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
  assert.equal(new URL(accountWhatsApp).searchParams.get('text'), accountMessage);
  assert.notEqual(newAccount, accounts.get('Solicitante'));
  await inviteNext.click();
  assert.equal(await a.getByRole('button', { name: 'Entrar con passkey' }).count(), 0);
  const accountField = a.getByLabel('Cuenta de quien entrega (G…)');
  const confirmation = a.getByRole('heading', { name: 'Confirma la cuenta' });
  const signAuthorization = a.getByRole('button', { name: 'Firmar autorización de entrega' });
  const assertConfirmationVisible = async () => {
    await confirmation.waitFor();
    await a.waitForFunction(() => document.activeElement?.textContent === 'Confirma la cuenta');
    const bounds = await signAuthorization.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= a.viewportSize().height,
      'Signing button is fully within the viewport after confirmation receives focus');
    await a.getByText(`Cuenta terminada en ${accountEnding}`, { exact: false }).waitFor();
  };
  await accountField.fill(newAccount);
  await a.getByRole('button', { name: 'Comprobar cuenta' }).click();
  await assertConfirmationVisible();
  await accountField.press('End');
  await accountField.press('Backspace');
  assert.ok(await accountField.evaluate(field => field === document.activeElement), 'Editing keeps focus in the account field');
  assert.equal(await accountField.inputValue(), newAccount.slice(0, -1));
  assert.equal(await confirmation.count(), 0);
  assert.equal(await signAuthorization.count(), 0);
  await a.getByRole('button', { name: 'Buscar por nombre' }).click();
  await a.getByRole('button', { name: 'Cargar más nombres' }).click();
  await a.getByRole('textbox', { name: 'Nombre o cuenta G' }).fill('Aportante');
  await a.getByRole('button', { name: /Aportante · G/ }).click();
  await assertConfirmationVisible();
  await a.getByText('Aportante', { exact: true }).waitFor();
  await a.getByText(accounts.get('Aportante'), { exact: true }).waitFor();
  await signAuthorization.click();
  await a.getByText('Invitación lista para Aportante', { exact: true }).waitFor();
  await a.getByRole('button', { name: 'Invitar a entregar' }).click();
  const deliveryLink = await a.evaluate(() => window.lastVespiShare.url);
  const wa = await a.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
  assert.ok(new URL(wa).searchParams.get('text').endsWith(deliveryLink));
  assert.match(deliveryLink, /#assignment=[a-f0-9]{128}$/);
  const reopened = await a.context().newPage();
  await reopened.goto(origin + '/app?vista=aportes', { waitUntil: 'networkidle' });
  await reopened.getByRole('heading', { name: 'Mis aportes', exact: true }).waitFor();
  await reopened.getByText('Invitación preparada para', { exact: false }).waitFor();
  await reopened.getByRole('button', { name: 'Volver a compartir invitación' }).click();
  assert.equal(await reopened.evaluate(() => window.lastVespiShare.url), deliveryLink);
  assert.equal(await reopened.getByRole('button', { name: 'Entrar con passkey' }).count(), 0);
  await reopened.close();
  assert.equal(await a.getByLabel('Enlace para compartir').count(), 0);
  await a.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('Clipboard unavailable'); } },
  }));
  await a.getByRole('button', { name: 'Copiar enlace', exact: true }).click();
  assert.equal(await a.getByLabel('Enlace para compartir').inputValue(), deliveryLink);

  await b.evaluate(hash => { location.hash = hash; }, new URL(deliveryLink).hash);
  await b.getByRole('textbox', { name: 'Describe el aporte que entregas' }).waitFor();
  await b.goto(deliveryLink, { waitUntil: 'networkidle' });
  await b.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(b.url(), deliveryLink);
  await b.getByRole('textbox', { name: 'Describe el aporte que entregas' }).waitFor();
  await b.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'WhatsApp' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => { window.vespiCopied = value; },
    } });
  });
  const deliveryText = b.getByRole('textbox', { name: 'Describe el aporte que entregas' });
  await deliveryText.fill('Propuse definir el siguiente paso al terminar');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await b.getByRole('button', { name: 'Firmar entrega' }).click();
  await b.getByRole('button', { name: 'Copiar enlace para abrir en el navegador' }).click();
  assert.equal(await b.evaluate(() => window.vespiCopied), deliveryLink);
  await b.evaluate(() => { delete navigator.userAgent; delete navigator.clipboard; });
  await b.getByRole('button', { name: 'Firmar entrega' }).click();
  await b.getByRole('link', { name: 'Abrir recibo' }).click();
  const delivery = head.digest;
  await b.getByText('Aporte entregado. Está pendiente de aceptación.').waitFor();
  const testimonialPath = await b.getByRole('link', { name: 'Dar testimonio de esta entrega' }).getAttribute('href');
  assert.equal(testimonialPath, '/app?observe=' + delivery);
  await b.goto(origin + testimonialPath, { waitUntil: 'networkidle' });
  await b.getByRole('button', { name: 'Entrar con passkey' }).click();
  await b.getByText('Quien pidió o entregó el aporte no puede firmarlo.', { exact: false }).waitFor();
  assert.equal(await b.getByRole('button', { name: 'Firmar testimonio' }).count(), 0);
  await a.goto(origin + testimonialPath, { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: 'Entrar con passkey' }).click();
  await a.getByText('Quien pidió o entregó el aporte no puede firmarlo.', { exact: false }).waitFor();
  assert.equal(await a.getByRole('button', { name: 'Firmar testimonio' }).count(), 0);

  await observer.goto(origin + testimonialPath, { waitUntil: 'networkidle' });
  await observer.getByRole('button', { name: 'Entrar con passkey' }).click();
  await observer.getByText('Observé el aporte descrito en este recibo.', { exact: true }).waitFor();
  await observer.getByText('El testimonio no acepta el aporte.', { exact: false }).waitFor();
  await observer.getByRole('textbox', { name: 'Comentario opcional' }).fill('Vi la demostración completa');
  const photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#e2a700' } }).png().toBuffer();
  await observer.getByLabel('Adjuntar foto').setInputFiles({ name: 'charla.png', mimeType: 'image/png', buffer: photo });
  await observer.getByRole('img', { name: 'Foto que adjuntarás al testimonio' }).waitFor();
  await observer.getByRole('button', { name: 'Firmar testimonio' }).click();
  await observer.getByRole('alert').getByText('No se pudo preparar o subir la foto.', { exact: false }).waitFor();
  assert.equal(await observer.getByRole('textbox', { name: 'Comentario opcional' }).inputValue(), 'Vi la demostración completa');
  await observer.getByRole('button', { name: 'Firmar testimonio' }).click();
  await observer.getByRole('link', { name: 'Abrir recibo del testimonio' }).click();
  await observer.getByRole('heading', { name: 'Firma y recibo verificados' }).waitFor();
  const observed = observer.getByRole('link', { name: 'Ver la entrega observada' });
  assert.equal(await observed.getAttribute('href'), '/app?receipt=' + delivery);
  assert.equal(await observer.getByRole('link', { name: 'Ver foto adjunta' }).getAttribute('href'), photoEvidence.uri);
  assert.equal(photoAttempts, 2);
  assert.equal(head.digest, delivery);
  corruptDelivery = delivery;
  await observer.reload({ waitUntil: 'networkidle' });
  await observer.getByRole('alert').getByText('El contenido no coincide con la firma esperada.').waitFor();
  assert.equal(await observer.getByRole('heading', { name: 'Firma y recibo verificados' }).count(), 0);
  corruptDelivery = undefined;
  await b.goto(origin + '/app?receipt=' + delivery, { waitUntil: 'networkidle' });
  await b.getByText('Aporte entregado. Está pendiente de aceptación.').waitFor();
  await b.getByRole('link', { name: 'Revisar este aporte' }).click();
  await b.getByText('Corrige tu entrega.', { exact: false }).waitFor();
  assert.equal(await b.getByRole('button', { name: 'Aceptar y firmar' }).count(), 0);
  await b.getByRole('textbox', { name: 'Describe el aporte que entregas' }).fill('Propuse revisarlo el viernes');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await b.getByRole('button', { name: 'Firmar entrega' }).click();
  await b.getByRole('link', { name: 'Abrir recibo' }).waitFor();
  const corrected = head.digest;

  await b.getByRole('button', { name: 'Enviar para revisión' }).click();
  const reviewLink = await b.evaluate(() => window.lastVespiShare.url);
  assert.equal(reviewLink, origin + '/app?continue=' + corrected);
  await b.getByRole('button', { name: 'Registrar el apoyo de vuelta' }).click();
  await b.getByRole('textbox', { name: 'Escribe tu solicitud' }).waitFor();
  assert.equal(await b.getByRole('button', { name: 'Entrar con passkey' }).count(), 0);
  assert.equal(new URL(b.url()).searchParams.get('back'), request);
  await a.goto(reviewLink, { waitUntil: 'networkidle' });
  await a.getByText('Propuse revisarlo el viernes').waitFor();
  await a.getByRole('button', { name: 'Aceptar y firmar' }).click();
  await a.getByRole('link', { name: 'Abrir recibo' }).click();
  await a.getByText('Aporte aceptado por quien lo pidió.').waitFor();
  for (const stage of ['Lo pedido', 'La entrega aceptada', 'La aceptación']) {
    await a.getByRole('link', { name: 'Verificar: ' + stage }).waitFor();
  }
  await b.goto(origin + '/app?receipt=' + request, { waitUntil: 'networkidle' });
  await b.getByText('Aporte aceptado por quien lo pidió.').waitFor();
  await b.getByRole('link', { name: 'Ver el último paso firmado' }).waitFor();
  await b.goto(origin + '/app?receipt=' + delivery, { waitUntil: 'networkidle' });
  await b.getByText('Se aceptó otra versión de este aporte.').waitFor();
  const accepted = b.getByRole('link', { name: 'Ver la versión aceptada' });
  assert.equal(await accepted.getAttribute('href'), '/app?receipt=' + corrected);
  await b.goto(origin + '/app?continue=' + delivery, { waitUntil: 'networkidle' });
  await b.getByText('Se aceptó otra versión de este aporte.').waitFor();
  assert.equal(await b.getByRole('link', { name: 'Ver la versión aceptada' }).getAttribute('href'),
    '/app?receipt=' + corrected);
  assert.equal(receipts.size, 5);

  await b.goto(origin + '/app?receipt=' + request, { waitUntil: 'networkidle' });
  await b.getByRole('link', { name: 'Registrar el apoyo de vuelta' }).click();
  await b.getByRole('heading', { name: 'Registrar el apoyo de vuelta' }).waitFor();
  await b.getByRole('textbox', { name: 'Escribe tu solicitud' }).fill('Apoyo recibido para el diseño móvil');
  await b.getByRole('button', { name: 'Continuar' }).click();
  await b.getByRole('button', { name: 'Firmar' }).click();
  await b.getByRole('button', { name: 'Invita a quien entrega' }).waitFor();
  const returning = head.digest;
  assert.equal(head.draft.actor, accounts.get('Aportante'));
  await b.getByRole('button', { name: 'Invita a quien entrega' }).click();
  const counterparty = b.getByLabel('Cuenta de quien entrega (G…)');
  assert.equal(await counterparty.inputValue(), accounts.get('Solicitante'));
  assert.equal(await b.getByRole('button', { name: 'Entrar con passkey' }).count(), 0);
  assert.equal(new URL(b.url()).searchParams.get('continue'), returning);
  assert.equal(new URL(b.url()).searchParams.get('mutual'), request);
  await b.reload({ waitUntil: 'networkidle' });
  await b.waitForFunction(account => document.querySelector('#delivery-account')?.value === account,
    accounts.get('Solicitante'));
  await b.getByRole('button', { name: 'Comprobar cuenta' }).click();
  await b.getByRole('button', { name: 'Firmar autorización de entrega' }).click();
  await b.getByRole('button', { name: 'Invitar a entregar' }).click();
  const reverseInvite = await b.evaluate(() => window.lastVespiShare.url);
  assert.ok(reverseInvite.startsWith(origin + '/app?continue=' + returning + '&mutual=' + request + '&permiso=entrega#assignment='));

  await a.goto(reverseInvite, { waitUntil: 'networkidle' });
  await a.getByRole('textbox', { name: 'Describe el aporte que entregas' }).fill('Compartí una referencia de interfaz');
  await a.getByRole('button', { name: 'Continuar' }).click();
  await a.getByRole('button', { name: 'Firmar entrega' }).click();
  await a.getByRole('button', { name: 'Enviar para revisión' }).click();
  const reverseReview = await a.evaluate(() => window.lastVespiShare.url);
  assert.equal(reverseReview, origin + '/app?continue=' + head.digest + '&mutual=' + request);
  await a.getByRole('link', { name: 'Ver ambos aportes' }).click();
  await a.getByText('1 de 2 aportes aceptados', { exact: true }).waitFor();
  await a.getByText('Aportante debe revisar y decidir si acepta.', { exact: true }).waitFor();
  const pendingReview = await a.getByRole('link', { name: 'Revisar y aceptar este aporte' }).getAttribute('href');
  assert.equal(new URL(pendingReview, origin).toString(), reverseReview);

  await b.goto(reverseReview, { waitUntil: 'networkidle' });
  await b.getByRole('button', { name: 'Aceptar y firmar' }).click();
  await b.getByRole('link', { name: 'Ver ambos aportes' }).click();
  await b.getByText('2 de 2 aportes aceptados', { exact: true }).waitFor();
  await b.getByText('Primer aporte · Aportante → Solicitante', { exact: true }).waitFor();
  await b.getByText('Apoyo de vuelta · Solicitante → Aportante', { exact: true }).waitFor();
  assert.equal(receipts.size, 8);
  await b.goto(origin + '/app?mutual=' + request + '&return=' + request, { waitUntil: 'networkidle' });
  await b.getByRole('alert').getByText('Estas cadenas no acreditan aportes', { exact: false }).waitFor();
  console.log('Three-account chain: direct invitation, paginated aliases, native/WhatsApp/copy links, delivery review, independent testimony, exact-version recap and two verified directions of mutual support.');
} finally {
  await browser.close();
}
