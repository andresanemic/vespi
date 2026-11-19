import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';

const origin = process.env.VESPI_APP_URL ?? 'http://localhost:3246';
const name = process.env.VESPI_BROWSER ?? 'webkit';
const browserType = { chromium, webkit }[name];
const browser = await browserType.launch(name === 'chromium' ? { executablePath: process.env.VESPI_CHROMIUM } : {});

async function measureScroll(page) {
  return page.evaluate(async () => {
    window.scrollTo(500, 160);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return {
      x: window.scrollX,
      y: window.scrollY,
      width: document.documentElement.clientWidth,
      scrollWidth: document.scrollingElement.scrollWidth,
    };
  });
}

try {
  for (const width of [320, 375, 390]) {
    const { defaultBrowserType, ...phone } = devices['iPhone 13'];
    const options = { ...phone, viewport: { width, height: 629 }, locale: 'es-CL', colorScheme: 'dark' };
    const page = await browser.newPage(options);
    await page.goto(origin + '/app', { waitUntil: 'domcontentloaded' });
    const newEncounter = page.getByRole('button', { name: 'Nuevo encuentro' });
    await newEncounter.click();
    const date = page.getByLabel('¿Cuándo fue?', { exact: true });
    const kind = page.getByLabel('¿Qué ocurrió?', { exact: true });
    const title = page.getByLabel('Dale un nombre al encuentro');
    const field = page.locator('.date-field');
    const [dateBounds, fieldBounds, kindBounds, titleBounds] = await Promise.all([date, field, kind, title].map(control => control.boundingBox()));
    for (const box of [kindBounds, titleBounds]) {
      assert.ok(Math.abs(box.x - fieldBounds.x) <= 1 && Math.abs(box.width - fieldBounds.width) <= 1,
        JSON.stringify({ name, width, fieldBounds, box }));
    }
    assert.ok(dateBounds.x >= fieldBounds.x && dateBounds.x + dateBounds.width <= fieldBounds.x + fieldBounds.width &&
      dateBounds.width >= fieldBounds.width - 2, 'Native date control fits inside its frame');
    await date.fill('2026-02-11');
    const formatted = await page.evaluate(() => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: 'UTC' })
      .format(new Date('2026-02-11T00:00:00Z')));
    assert.equal(await page.locator('#date-display').textContent(), formatted);
    const scroll = await measureScroll(page);
    assert.equal(scroll.x, 0);
    assert.equal(scroll.width, scroll.scrollWidth);
    assert.ok(scroll.y > 0, 'Vertical scrolling remains available');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continuar borrador' }).click();
    assert.equal(await date.inputValue(), '2026-02-11');
    await page.close();

    for (const path of ['/app/evento/yerko', '/app/encuesta']) {
      const detail = await browser.newPage(options);
      await detail.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await detail.locator('.mobile-content h1').waitFor();
      const { x, width: visible, scrollWidth } = await measureScroll(detail);
      assert.equal(x, 0);
      assert.equal(scrollWidth, visible);
      await detail.close();
    }
  }
  console.log(name + ': aligned date field, saved draft, vertical-only scrolling at 320, 375 and 390px.');
} finally {
  await browser.close();
}
