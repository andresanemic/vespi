// Run against Next dev with VESPI_APP_URL (default http://localhost:3217).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import { teamSurveyRequestMessage } from '../src/lib/contributions/team-survey-authorization.ts';

const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3217';
const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
const record = {
  createdAt: '2026-11-19T19:00:00.000Z',
  answer: { usefulness: 5, building: true, project: 'Proyecto simulado', ambassadorInterest: false,
    nextTopic: 'Stellar', email: 'fixture@example.test' },
};
const context = await browser.newContext({ viewport: { width: 375, height: 650 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
} });
let allow = false;
const requests = [];
const nonces = new Set();
await page.route('**/api/contributions/**', async route => {
  const { pathname, search } = new URL(route.request().url());
  if (pathname.startsWith('/api/contributions/profiles/')) {
    const account = pathname.split('/').at(-1);
    await route.fulfill({ json: { account, displayName: 'Equipo Vespi' } });
    return;
  }
  assert.equal(pathname, '/api/contributions/team/survey');
  assert.equal(search, '');
  assert.equal(route.request().method(), 'POST');
  const { account, action, cohort, expiresAt, nonce, signature } = route.request().postDataJSON();
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.match(signature, /^[0-9a-f]{128}$/);
  assert.ok(!nonces.has(nonce));
  nonces.add(nonce);
  assert.ok(expiresAt > Date.now() / 1000 && expiresAt <= Date.now() / 1000 + 60);
  assert.ok(Keypair.fromPublicKey(account).verify(
    Buffer.from(teamSurveyRequestMessage(account, action, cohort, expiresAt, nonce)), Buffer.from(signature, 'hex')));
  requests.push({ account, action, cohort });
  if (!allow) await route.fulfill({ status: 403, json: { ok: false, reason: 'team-auth-required' } });
  else if (action === 'csv') await route.fulfill({ contentType: 'text/csv', body: 'usefulness\r\n5\r\n' });
  else await route.fulfill({ json: { cohort, records: cohort === 'event' ? [record] : [] } });
});

try {
  const response = await page.goto(origin + '/app/equipo');
  assert.equal(response.status(), 200);
  assert.ok(!(await response.text()).includes(record.answer.email));
  const deviceButton = page.getByRole('button', { name: 'Entrar con clave de este dispositivo' });
  await expect(deviceButton).toBeVisible();
  const rawDeviceKey = await page.evaluate(async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('vespi-contributions', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      tx.objectStore('keys').add(pair, 'device');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return [...new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))];
  });
  const deviceAccount = StrKey.encodeEd25519PublicKey(Buffer.from(rawDeviceKey));
  await expect(async () => {
    if (await page.getByRole('main').getByRole('alert').isVisible()) return;
    if (await deviceButton.isEnabled()) await deviceButton.click();
    assert.ok(await page.getByRole('main').getByRole('alert').isVisible());
  }).toPass({ timeout: 8000 });
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(/no tiene acceso/);
  await expect(page.getByText(record.answer.email)).toHaveCount(0);
  assert.equal(requests[0].account, deviceAccount);

  allow = true;
  await deviceButton.click();
  await expect(page.getByText('Equipo Vespi', { exact: true })).toBeVisible();
  await expect(page.getByText('Todavía no hay respuestas para este grupo.')).toBeVisible();
  await page.getByLabel('Grupo de respuestas').selectOption('event');
  const csv = page.getByRole('button', { name: 'Descargar CSV' });
  await expect(csv).toBeDisabled();
  await page.getByRole('button', { name: 'Consultar respuestas' }).click();
  await expect(page.getByText(record.answer.email)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), csv.click()]);
  assert.equal(download.suggestedFilename(), 'survey-event.csv');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'usefulness\r\n5\r\n');
  assert.deepEqual(requests.at(-1), { account: deviceAccount, action: 'csv', cohort: 'event' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(new URL(page.url()).search, '');
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.ok(!storage.includes(record.answer.email));

  await page.getByRole('button', { name: 'Cerrar acceso' }).click();
  await expect(page.getByText(record.answer.email)).toHaveCount(0);
  await expect(deviceButton).toBeVisible();

  await page.evaluate(async () => {
    await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: location.hostname, name: 'Vespi Contributions' },
      user: { id: crypto.getRandomValues(new Uint8Array(32)), name: 'fixture', displayName: 'Fixture' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    } });
  });
  await page.getByRole('button', { name: 'Entrar con passkey' }).click();
  await expect(page.getByText('Equipo Vespi', { exact: true })).toBeVisible();
  assert.notEqual(requests.at(-1).account, deviceAccount);
  await page.getByRole('button', { name: 'Read in English' }).click();
  await expect(page.getByRole('heading', { name: 'Survey responses' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await expect(page.getByText('Equipo Vespi', { exact: true })).toHaveCount(0);
  console.log('Private team survey passed with passkey, device key, denial, cohort selection, CSV, and reset.');
} finally {
  await browser.close();
}
