// /contributions y /contributions/es son la guía simulada del flujo (2026-11-21): pantalla dividida,
// teléfono con pantallas de ejemplo que no se pueden pulsar, cinco pasos y salida a la app. No llama a
// ninguna API ni firma nada.
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

const origin = process.env.VIRUS_ORIGIN || 'http://localhost:3000';
const cases = [
  { path: '/contributions', h1: /How Vespi Contributions works/, label: /Example · nothing here is signed or recorded/ },
  { path: '/contributions/es', h1: /Cómo funciona Vespi Contributions/, label: /Ejemplo · aquí no se firma ni se registra nada/ },
];

(async () => {
  for (const c of cases) {
    const res = await fetch(origin + c.path, { redirect: 'manual' });
    assert.equal(res.status, 200, `${c.path}: page, not a redirect`);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    for (const c of cases) {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
        const api = [];
        page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
        page.on('console', m => { if (m.type() === 'error') errors.push(`${c.path}/${width}: ${m.text()}`); });
        await page.goto(origin + c.path, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('h1').count(), 1, `${c.path}/${width}: one h1`);
        assert.match(await page.locator('h1').innerText(), c.h1);
        assert.match(await page.locator('.ct-guide-preview').getAttribute('aria-label'), c.label, `${c.path}/${width}: the phone is announced as an example`);
        assert.equal(await page.locator('.ct-guide-example').count(), 0, `${c.path}/${width}: no visible example boxes`);
        assert.equal(await page.locator('.ct-guide-steps > li').count(), 5, `${c.path}/${width}: five steps`);
        const phones = await page.evaluate(() => [...document.querySelectorAll('.ct-guide-phone')].map(p => ({ inert: p.inert || !!p.closest('[inert]'), hidden: p.closest('[aria-hidden="true"]') !== null, focusable: p.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length })));
        assert.ok(phones.length > 0, `${c.path}/${width}: phone screens present`);
        for (const p of phones) assert.ok((p.inert || p.hidden) && (p.inert || p.focusable === 0), `${c.path}/${width}: phone screens are not interactive`);
        assert.equal(await page.locator('main a[href="/app"]').count() >= 1, true, `${c.path}/${width}: exit to the app`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${c.path}/${width}: horizontal overflow ${overflow}px`);
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } });
        assert.deepEqual(api, [], `${c.path}/${width}: no API calls`);
        await page.close();
      }
    }
    assert.deepEqual(errors, [], 'console errors');
    console.log('Contributions guide: EN/ES pages, one h1, example label, five steps, inert phone, exit to the app, no API calls, at 390 and 1440px.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
