// Run with Next dev on port 3217, or set VESPI_APP_URL. Only browser and signatures are real; HTTP data is mocked.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Account, BASE_FEE, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { profileMessage } from '../src/lib/contributions/profile-authorization.ts';
import { buildOnboardingTx } from '../src/lib/contributions/stellar-server.ts';
import { canonicalBytes } from '../src/lib/contributions/kernel/contributions.js';

const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3217';
const server = 'https://horizon-testnet.stellar.org';
const context = await browser.newContext({viewport:{width:375,height:629},isMobile:true,hasTouch:true,colorScheme:'light',locale:'es-CL'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {options:{
  protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,
  hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true,
}});
const sponsor = Keypair.random();
let firstAccount;
let onboarded = false;
let profileReads = 0;
let profilePosts = 0;
let profile;
let result;
let sequence = 123;
let mutate = true;
let addBom = false;
let submitted = 0;
let priorAttempt;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (route, data, status=200) => route.fulfill({json:data,status,headers:{'Access-Control-Allow-Origin':'*'}});
await context.route('**/api/contributions/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/voice')) return json(route, { voice: false });
  if (path.endsWith('/network')) return json(route, { mainnet: false });
  if (path.endsWith('/encounters')) return json(route, { ok: true, cursor: '0', entries: [] });
  if (path.includes('/activity/')) return route.fulfill({ json: { cursor: '0', entries: [] } });
  if (path.endsWith('/account')) {
    const body = route.request().postDataJSON();
    if (body.action === 'complete') {
      const signed = TransactionBuilder.fromXDR(body.xdr, Networks.TESTNET);
      assert.equal(body.token, 'test-token');
      assert.ok(Keypair.fromPublicKey(firstAccount).verify(signed.hash(), signed.signatures[0].signature()));
      onboarded = true;
      return json(route, { ok:true });
    }
    const key = body.publicKey;
    assert.match(key,/^G[A-Z2-7]{55}$/);
    if (firstAccount) assert.equal(key,firstAccount);
    firstAccount = key;
    if (onboarded) return json(route,{ok:false,reason:'already-onboarded'},409);
    const tx = buildOnboardingTx({ channel: new Account(Keypair.random().publicKey(), '0'),
      sponsor: sponsor.publicKey(), newAccount: key, baseFee: BASE_FEE, timeoutSeconds: 60 });
    return json(route, { ok:true, token:'test-token', xdr:tx.toXDR() });
  }
  if (path === '/api/contributions/profiles/' + firstAccount) {
    profileReads++;
    if (profileReads === 1) return json(route, { ok: false, reason: 'profile-unavailable' }, 503);
    if (!profile) return json(route, { ok: false, reason: 'not-found' }, 404);
    return json(route, profile);
  }
  if (path === '/api/contributions/profiles') {
    const { account, displayName, expiresAt, signature } = route.request().postDataJSON();
    assert.equal(account, firstAccount);
    assert.equal(displayName, 'Participante Vespi');
    assert.ok(expiresAt > Date.now() / 1000 && expiresAt <= Date.now() / 1000 + 300);
    assert.ok(Keypair.fromPublicKey(account).verify(Buffer.from(profileMessage(account, displayName, expiresAt)),
      Buffer.from(signature, 'hex')));
    profilePosts++;
    if (profilePosts === 1) {
      profile = { account, displayName };
      return route.abort('timedout');
    }
    assert.deepEqual(profile, { account, displayName });
    return json(route, { ok: true, created: false });
  }
  if (path.endsWith('/prepare')) {
    const draft = route.request().postDataJSON();
    const bytes = canonicalBytes(mutate ? {...draft,statement:'Alterada'} : draft);
    return json(route,{ok:true,bytes,digest:hash(bytes)});
  }
  if (path.endsWith('/anchor')) {
    submitted++;
    const {bytes,xdr} = route.request().postDataJSON();
    if (priorAttempt) {
      assert.equal(bytes, priorAttempt.bytes);
      if (submitted <= 3) assert.notEqual(xdr, priorAttempt.xdr);
      else assert.equal(xdr, priorAttempt.xdr);
    }
    priorAttempt = { bytes, xdr };
    if (submitted === 1) return json(route, { ok: false, reason: 'invalid-timebound' }, 400);
    if (submitted === 2) return json(route, { ok: false, reason: 'inner-failed' }, 422);
    if (submitted === 3) return route.abort('timedout');
    if (submitted === 4) return json(route, { ok: false, reason: 'anchor-pending' }, 409);
    const inner = TransactionBuilder.fromXDR(xdr,Networks.TESTNET);
    const tx = TransactionBuilder.buildFeeBumpTransaction(sponsor,BASE_FEE,inner,Networks.TESTNET);
    tx.sign(sponsor);
    result={ bytes, digest:hash(bytes), txHash:tx.hash().toString('hex'), xdr:tx.toXDR(), ledger:12345, rehearsal:true };
    return json(route,{ok:true,index:result});
  }
  assert.ok(result);
  if (route.request().url().endsWith('?format=index')) return json(route,result);
  return route.fulfill({body:(addBom ? '\uFEFF' : '') + result.bytes,contentType:'application/json'});
});
await context.route(server + '/**', route => {
  if (route.request().url().includes('/accounts/')) return json(route,{sequence:new Account(firstAccount, String(sequence++)).sequenceNumber()});
  return json(route,{successful:true,hash:result.txHash,ledger:result.ledger,envelope_xdr:result.xdr});
});
await page.goto(origin+'/app?vista=aportes',{timeout:60_000});
await page.getByRole('heading',{name:'Mis aportes'}).waitFor();
await page.getByRole('button',{name:'Crear una passkey'}).click();
await page.getByLabel('Nombre para tu passkey').fill('Ensayo');
await page.getByRole('button',{name:'Crear una passkey'}).click();
await page.getByRole('alert').getByText('No pudimos consultar tu nombre.').waitFor({timeout:20_000});
assert.equal(profilePosts, 0);
await page.getByRole('button',{name:'Volver a consultar'}).click();
await page.getByRole('heading',{name:'Elige tu nombre visible'}).waitFor();
assert.equal(profilePosts, 0);
await page.getByRole('button',{name:'Read in English'}).click();
await page.getByRole('heading',{name:'Choose your display name'}).waitFor();
await page.getByRole('button',{name:'Leer en español'}).click();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),375);
await page.getByRole('textbox',{name:'Nombre visible',exact:true}).fill('Participante Vespi');
const publishName = page.getByRole('button',{name:'Publicar nombre y continuar'});
assert.ok(await publishName.isDisabled());
assert.equal(profilePosts, 0);
await page.getByRole('checkbox',{name:'Acepto que este nombre se publique junto a mi cuenta de Stellar.'}).check();
await publishName.click();
await page.getByRole('alert').getByText('No pudimos confirmar la publicación.').waitFor();
await publishName.click();
await page.getByRole('heading',{name:'Mis aportes',exact:true}).waitFor();
assert.equal(profilePosts, 2);
await page.getByText('Participante Vespi',{exact:true}).waitFor();
await page.getByRole('link',{name:'¿Necesitas ayuda? Pide un aporte',exact:true}).click();
await page.getByLabel('Escribe tu solicitud').fill('Feedback para la demo');
await page.getByText('Más detalles', { exact: true }).click();
await page.getByLabel('Comentario opcional').fill('Revisar el flujo de alta');
await page.getByRole('button',{name:'Continuar'}).click();
await page.getByRole('button',{name:'Firmar'}).click();
await page.getByRole('alert').getByText('El contenido no coincide con la firma esperada.').waitFor();
assert.equal(submitted,0);
mutate=false;
for (let i = 0; i < 2; i++) {
  await page.getByRole('button',{name:'Firmar'}).click();
  await page.getByRole('alert').getByText('Este intento terminó sin registrar la solicitud.').waitFor();
  await page.getByRole('button',{name:'Editar'}).waitFor();
}
await page.getByRole('button',{name:'Firmar'}).click();
await page.getByRole('alert').getByText('No pudimos registrar o comprobar el recibo.').waitFor();
await page.getByRole('button',{name:'Editar'}).waitFor({state:'hidden'});
const pendingKey = 'vespi-contributions:pending:' + firstAccount;
assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), pendingKey),
  { ...priorAttempt, digest: hash(priorAttempt.bytes) });
await page.reload();
await page.getByRole('heading',{name:'Revisa tu solicitud'}).waitFor();
await page.getByRole('link',{name:'Enlace de esta solicitud'}).waitFor();
await page.getByRole('button',{name:'Comprobar de nuevo'}).click();
await page.getByRole('alert').getByText('La firma todavía está pendiente de confirmación.').waitFor();
await page.getByRole('button',{name:'Editar'}).waitFor({state:'hidden'});
await page.getByRole('button',{name:'Comprobar de nuevo'}).click();
const openReceipt = page.getByRole('link',{name:'Abrir recibo público'});
await openReceipt.waitFor();
assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), null);
await openReceipt.click();
await page.getByRole('heading',{name:'Firma y recibo verificados'}).waitFor();
assert.equal(await page.locator('blockquote').textContent(),'Ensayo: Feedback para la demo');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),375);
await page.getByRole('button',{name:'Cambiar al tema oscuro'}).click();
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
await page.getByRole('button',{name:'Read in English'}).click();
await page.getByRole('heading',{name:'Signature and receipt verified'}).waitFor();
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),390);
const anonymous = await context.newPage();
await anonymous.goto(origin+'/app?receipt='+result.digest+'&lang=es');
await anonymous.getByRole('heading',{name:'Firma y recibo verificados'}).waitFor();
addBom = true;
await anonymous.reload();
await anonymous.getByRole('alert').getByText('El contenido no coincide con la firma esperada.').waitFor();
addBom = false;
await page.goto(origin+'/app?vista=aportes');
await context.clearCookies();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload();
await page.getByRole('button',{name:'Entrar con passkey'}).click();
await page.getByRole('heading',{name:'Mis aportes',exact:true}).waitFor();
await page.getByText('Participante Vespi',{exact:true}).waitFor();
assert.equal(profilePosts, 2);
assert.equal(profileReads, 3);
assert.deepEqual(errors,[]);
console.log('Chromium virtual PRF: firma y consentimiento de perfil, alta simulada, vuelve a la misma G, rechaza mutación antes del POST, renueva XDR descartado, recupera XDR incierto tras recarga y rechaza un BOM añadido, verifica recibo sin cuenta, ES/EN, ambos temas y anchos.');
await browser.close();
