import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Keypair } from '@stellar/stellar-sdk/base';
import { chromium } from 'playwright';
import next from 'next';
import { expect } from '@playwright/test';

const account = Keypair.random().publicKey();
const missing = Keypair.random().publicKey();
const profilePath = '/app/perfil/' + account;
const alias = 'Participante Vespi';
const registry = 'https://profile-fixture.invalid';
let unavailable = false;

process.env.CONTRIB_KV_REST_API_URL = registry;
process.env.CONTRIB_KV_REST_API_TOKEN = 'profile-fixture';
const fetchNetwork = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  if (String(input) !== registry) return fetchNetwork(input, options);
  const [command, , key] = JSON.parse(options.body);
  assert.equal(command, 'HGET');
  return unavailable ? new Response(null, { status: 503 }) : Response.json({ result: key === account ? alias : null });
};

const app = next({ dev: true, webpack: true });
const server = createServer(app.getRequestHandler());
let browser;
try {
  await app.prepare();
  server.listen(0, 'localhost');
  await once(server, 'listening');
  const origin = 'http://localhost:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM });
  const context = await browser.newContext({
    viewport: { width: 375, height: 650 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  assert.equal((await page.goto(origin + profilePath)).status(), 200);
  await page.getByRole('heading', { name: alias }).waitFor();
  await page.getByText(account, { exact: true }).waitFor();
  await expect(async () => {
    const toggle = page.getByRole('button', { name: 'Read in English' });
    if (await toggle.isVisible()) await toggle.click();
    assert.ok(await page.getByRole('button', { name: 'Copy profile link' }).isVisible());
  }).toPass({ timeout: 8000 });
  await page.getByRole('button', { name: 'Copy profile link' }).click();
  await page.getByRole('status').filter({ hasText: 'Link copied.' }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin + profilePath);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  assert.equal((await page.goto(origin + '/app/perfil/' + missing)).status(), 404);
  await page.getByRole('heading', { name: 'Perfil no encontrado' }).waitFor();
  assert.equal((await page.goto(origin + '/app/perfil/invalid')).status(), 404);

  unavailable = true;
  await page.goto(origin + profilePath);
  await page.getByRole('heading', { name: 'No pudimos cargar el perfil' }).waitFor();
  unavailable = false;
  await page.getByRole('button', { name: 'Volver a intentar' }).click();
  await page.getByRole('heading', { name: alias }).waitFor();
  console.log('Public profile: registered, copied, missing, invalid and retry passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.close();
}
process.exit(0);
