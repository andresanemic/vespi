// Serve with node --import ./tests/fixtures/contributions-chain-server.mjs ./node_modules/next/dist/bin/next start -H localhost -p 3278.
// Set VESPI_FIXTURE_REPOSITORY=1 on both processes to verify the configured link.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { chromium } from 'playwright';
import { chainFixture, fixtureAccounts, fixtureRepository, privateText, revisedRequestText, unavailableRequestText } from './fixtures/contributions-chain.mjs';

const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3278';
const captures = process.env.VESPI_CAPTURES;
const repository = process.env.VESPI_FIXTURE_REPOSITORY === '1' ? fixtureRepository : null;
const { root, records, accept } = chainFixture('mainnet');
const path = '/app/cadena/' + root;
const browser = await chromium.launch({ executablePath: process.env.VESPI_CHROMIUM,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] });
const violations = [];
const errors = [];

async function phone(width, height, theme, lang) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true,
    colorScheme: theme, locale: lang === 'es' ? 'es-CL' : 'en-US', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ theme }) => localStorage.setItem('vespi-theme', theme), { theme });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const tx = records.find(record => url.pathname === '/transactions/' + record.index.txHash);
    if (url.origin === 'https://horizon.stellar.org' && tx) return route.fulfill({
      json: tx.horizon, headers: { 'Access-Control-Allow-Origin': '*' },
    });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}

try {
  if (captures) await mkdir(captures, { recursive: true });
  for (const [width, height] of [[375, 629], [390, 844]]) {
    for (const theme of ['light', 'dark']) {
      for (const lang of ['es', 'en']) {
        const { context, page } = await phone(width, height, theme, lang);
        const url = path + '?network=mainnet&lang=' + lang;
        const response = await page.goto(origin + url);
        assert.equal(response.status(), 200);
        const es = lang === 'es';
        const heading = es ? 'Resultado de la cadena' : 'Chain result';
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(page.locator('main')).toHaveAttribute('lang', lang);
        await expect(page.locator('.mobile-network[data-mainnet] .mobile-network-label')).toHaveText('Mainnet');
        await expect(page.locator('.mobile-network-dot')).toBeVisible();
        const canonical = new URL(await page.locator('link[rel=canonical]').getAttribute('href'));
        assert.equal(canonical.pathname + canonical.search, path + '?network=mainnet');
        await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical.href);
        const image = await page.locator('meta[property="og:image"]').getAttribute('content');
        const imagePath = new URL(image).pathname;
        assert.equal(imagePath, '/og-chain-mainnet-' + lang + '.png');
        assert.equal((await context.request.get(origin + imagePath)).status(), 200);
        const steps = page.locator('.chain-steps > li');
        await expect(steps).toHaveCount(3);
        assert.deepEqual(await steps.locator('h2').allTextContents(),
          es ? ['Solicitud', 'Aporte', 'Aceptación'] : ['Request', 'Contribution', 'Acceptance']);
        for (const [i, entry] of records.entries()) {
          const step = steps.nth(i);
          await expect(step.locator('time')).toHaveAttribute('datetime', entry.receipt.createdAt);
          await expect(step.locator('code')).toHaveText(entry.index.digest);
          await expect(step.locator('a').first()).toHaveAttribute('href',
            'https://stellar.expert/explorer/public/account/' + entry.receipt.actor);
          await expect(step.locator('a').last()).toHaveAttribute('href',
            'https://stellar.expert/explorer/public/tx/' + entry.index.txHash);
        }
        await expect(steps.first().getByRole('link', { name: /Ada Fixture/ })).toBeVisible();
        await expect(page.getByText('Ada Fixture', { exact: false })).toHaveCount(1);
        await expect(page.getByRole('heading', { name: es ? '3 pasos verificados' : '3 verified steps' })).toBeVisible();
        const evidence = page.getByRole('link', { name: es ? 'Paquete de evidencia' : 'Evidence package' });
        if (repository) await expect(evidence).toHaveAttribute('href', new URL(repository).href);
        else await expect(evidence).toHaveCount(0);
        const html = await response.text();
        for (const value of [...privateText, 'ADA FIXTURE. ', 'Unmentioned Public Profile']) assert.ok(!html.includes(value), value);
        assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth === document.documentElement.clientWidth));
        if (width === 375) {
          const result = await new AxeBuilder({ page }).analyze();
          violations.push(...result.violations.map(violation => [theme, lang, violation.id]));
        }
        if (captures) await page.screenshot({ path: join(captures, width + 'x' + height + '-' + theme + '-' + lang + '.png'), fullPage: true });
        if (width === 375 && theme === 'light' && es) {
          await page.keyboard.press('Tab');
          await expect(page.getByRole('link', { name: 'Vespi Contributions' })).toBeFocused();
          await page.keyboard.press('Tab');
          const language = page.getByRole('link', { name: 'Read in English' });
          await expect(language).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(page.getByRole('heading', { name: 'Chain result', exact: true })).toBeVisible();
          await expect(page).toHaveURL(origin + path + '?network=mainnet&lang=en');
          await page.getByRole('button', { name: 'Switch to dark theme' }).click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        }
        await context.close();
      }
    }
  }

  const { context, page } = await phone(375, 629, 'light', 'es');
  const pending = await page.goto(origin + path);
  assert.equal(pending.status(), 200);
  await expect(page.getByRole('heading', { name: 'Cadena en curso' })).toBeVisible();
  await expect(page.locator('.mobile-network-label')).toHaveText('Testnet');
  await expect(page.locator('.chain-steps, meta[property="og:image"]')).toHaveCount(0);
  for (const value of [...privateText, 'Ada Fixture', fixtureAccounts.requester, fixtureAccounts.contributor]) {
    assert.ok(!(await pending.text()).includes(value), value);
  }
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  if (captures) await page.screenshot({ path: join(captures, 'incompleta-375x629-light-es.png'), fullPage: true });

  const unavailable = chainFixture('mainnet', { requestText: unavailableRequestText });
  const unavailableUrl = origin + '/app/cadena/' + unavailable.root + '?network=mainnet&lang=en';
  const retry = await page.goto(unavailableUrl);
  assert.equal(retry.status(), 503);
  assert.equal(retry.headers()['cache-control'], 'no-store');
  await expect(page.getByRole('heading', { name: 'Result unavailable' })).toBeVisible();
  await expect(page.locator('.chain-steps, meta[property="og:image"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Evidence package' })).toHaveCount(0);
  if (captures) await page.screenshot({ path: join(captures, 'no-disponible-375x629-light-en.png'), fullPage: true });
  assert.equal((await page.reload()).status(), 200);
  await expect(page.getByRole('heading', { name: 'Chain result' })).toBeVisible();

  const revised = chainFixture('mainnet', { requestText: revisedRequestText, revision: true });
  const revisedPath = '/app/cadena/' + revised.root;
  const mainnet = await page.goto(origin + revisedPath + '?network=mainnet&lang=en');
  await expect(page.locator('.chain-steps > li')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Version 1 (accepted)', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Version 2', exact: true })).toBeVisible();
  const requester = page.locator('.chain-steps > li').first().getByRole('link', { name: 'Requester ' + fixtureAccounts.requester, exact: true });
  await expect(requester).toBeVisible();
  const { requester: account } = fixtureAccounts;
  await expect(requester).toHaveText('Requester ' + account.slice(0, 6) + '…' + account.slice(-6));
  assert.ok(!(await mainnet.text()).includes('Ada Fixture'));
  const testnet = await page.goto(origin + revisedPath + '?network=testnet&lang=en');
  assert.equal(testnet.status(), 200);
  await expect(page.locator('.chain-steps > li')).toHaveCount(3);
  await expect(page.locator('.mobile-network-label')).toHaveText('Testnet');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-chain-testnet-en\.png$/);
  await expect(page.locator('main a[href^="https://stellar.expert/explorer/testnet/tx/"]')).toHaveCount(3);
  await expect(requester).toBeVisible();
  await expect(page.getByRole('link', { name: 'Evidence package' })).toHaveCount(0);
  assert.ok(!(await testnet.text()).includes('"name":"Al"'));
  assert.ok(!(await testnet.text()).includes('Ada Fixture'));

  // Without an explicit lang the page renders Spanish and leaves the saved preference alone.
  assert.equal(await page.evaluate(() => localStorage.getItem('vespi-lang')), 'en');
  await page.goto(origin + revisedPath + '?network=testnet');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await page.evaluate(() => localStorage.getItem('vespi-lang')), 'en');
  assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /initial-scale=1/);

  for (const suffix of ['?network=no-network', '?network=mainnet&network=testnet']) {
    assert.equal((await page.goto(origin + path + suffix)).status(), 404);
  }
  assert.equal((await page.goto(origin + '/app/cadena/' + 'f'.repeat(64) + '?network=mainnet')).status(), 404);
  await page.goto(origin + '/app?receipt=' + root + '&network=mainnet&lang=es');
  await expect(page.getByRole('heading', { name: 'Firma y recibo verificados' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver resultado de la cadena' })).toHaveCount(0);
  await page.goto(origin + '/app?receipt=' + accept.index.digest + '&network=mainnet&lang=es');
  const resultLink = page.getByRole('link', { name: 'Ver resultado de la cadena' });
  await expect(resultLink).toHaveAttribute('href', path + '?lang=es&network=mainnet');
  await resultLink.click();
  await expect(page.getByRole('heading', { name: 'Resultado de la cadena' })).toBeVisible();
  await context.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(violations, []);
  console.log('Eight verified views, pending, 503 and retry, evidence link, name boundaries, privacy, metadata, navigation, focus and axe passed.');
} finally {
  await browser.close();
}
