// node --import ./src/lib/contributions/test-imports.mjs tests/contributions-record-mobile.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true, level: 1 });
const webauthn = page => page.evaluate(() => Number(sessionStorage.getItem('fixture-webauthn')));
const consent = 'Cuando ambos firmen, este texto y sus nombres serán públicos en sus perfiles. No nombres a otras personas sin su permiso.';
const permanence = 'El contenido será público en Vespi; en Stellar queda la huella.';
const contributionUrl = 'https://example.invalid/recursos/planos/una-version-compartida-para-la-revision-del-patio';
const captureLabels = new Set(['01-inicio', '02-revisar', '03-recibir', '04-borrador', '05-perfil', '06-publico']);

export async function runRecordMobile({ origin, phone, register, copy, signOut, encounterStore, failStore, allow }) {
  const { proposals, recordVoice } = await import('./fixtures/contributions-voice.mjs');
  const captures = process.env.VESPI_RECORD_CAPTURES;
  if (captures) await mkdir(captures, { recursive: true });
  const [author, guest] = await Promise.all([phone('Autora'), phone('Invitada')]);
  const { page: a } = author;
  const { page: b } = guest;
  await register(author, 'Autora');
  await register(guest, 'Invitada');
  allow(author.account());
  allow(guest.account());

  async function audit(page, label, { full = false } = {}) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
    const tiny = await page.locator(':is(.record-flow, .mobile-public-view) :is(button, a, summary)').evaluateAll(nodes =>
      nodes.filter(node => node.getClientRects().length && !node.disabled).map(node => {
        const { width, height } = node.getBoundingClientRect();
        return { name: node.textContent.trim(), width, height };
      }).filter(({ width, height }) => width < 44 || height < 44));
    assert.deepEqual(tiny, [], label);
    if (full) {
      const { violations } = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)]), [], label);
    }
  }

  async function photograph(page, label) {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        localStorage.setItem('vespi-theme', theme);
        document.documentElement.dataset.theme = theme;
        window.dispatchEvent(new Event('vespi-theme-change'));
        scrollTo(0, 0);
      }, theme);
      await audit(page, label + ' ' + theme, { full: label === '05-perfil' });
      if (captures && captureLabels.has(label)) {
        await page.screenshot({ path: join(captures, label + '-' + theme + '.png'), animations: 'disabled' });
      }
    }
    await page.evaluate(() => {
      localStorage.setItem('vespi-theme', 'light');
      document.documentElement.dataset.theme = 'light';
      window.dispatchEvent(new Event('vespi-theme-change'));
    });
  }

  async function showHome(participant, network) {
    participant.expectNetwork(network);
    await participant.page.goto(origin + '/app?lang=es&network=' + network);
  }

  async function signIn(participant) {
    const page = participant.page;
    await button(page, 'Menú').click();
    await page.getByRole('navigation').getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const before = await webauthn(page);
    await button(page, 'Entrar con mi passkey').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    assert.equal(await webauthn(page) - before, 1);
  }

  const path = (pathname, network, lang = 'es') => origin + pathname + '?network=' + network + '&lang=' + lang;
  const stored = (network, id) => JSON.parse(encounterStore(network).get('record:' + id));

  for (const network of ['testnet', 'mainnet']) {
    const mainnet = network === 'mainnet';
    const otherNetwork = mainnet ? 'testnet' : 'mainnet';
    const anonymous = await phone(undefined, { network });
    const request = anonymous.context.request;
    const publicList = async (account, selected = network) => {
      const response = await request.get(path('/api/contributions/public/' + account, selected));
      assert.equal(response.status(), 200);
      const body = await response.json();
      for (const entry of body.entries) assert.deepEqual(Object.keys(entry).sort(),
        ['a', 'anchor', 'b', 'commitment', 'contributions', 'date', 'decisionSignature', 'id', 'proposalSignature', 'where']);
      return body.entries;
    };
    const profile = account => path('/app/perfil/' + account, network);
    async function hidden(id, text, accounts = [author.account(), guest.account()]) {
      const response = await request.get(path('/app/aporte/' + id, network));
      assert.equal(response.status(), 404);
      assert.ok(!(await response.text()).includes(text));
      for (const account of accounts) {
        assert.ok(!(await publicList(account)).some(entry => entry.id === id));
        const page = await request.get(profile(account));
        assert.equal(page.status(), 200);
        assert.ok(!(await page.text()).includes(text));
      }
    }

    await showHome(author, network);
    await showHome(guest, network);
    if (mainnet) {
      await signIn(author);
      await signIn(guest);
    } else {
      await button(a, 'Registrar un aporte').click();
      await button(a, 'Ayudé a alguien').click();
      const field = a.getByRole('textbox', { name: '¿Qué hiciste?' });
      await field.fill('Dejé por escrito cómo revisamos el plano del patio.');
      await showHome(author, network);
      await button(a, 'Registrar un aporte').click();
      await expect(field).toHaveValue('Dejé por escrito cómo revisamos el plano del patio.');
      await expect(button(a, 'Empezar de nuevo')).toBeVisible();
      await photograph(a, '04-borrador');
      await button(a, 'Empezar de nuevo').click();
      const restart = a.getByRole('dialog', { name: '¿Empezar de nuevo?' });
      await expect(restart).toBeVisible();
      await button(restart, 'Seguir editando').click();
      await expect(field).not.toHaveValue('');
      await button(a, 'Empezar de nuevo').click();
      await button(restart, 'Borrar borrador').click();
      await expect(button(a, 'Ayudé a alguien')).toBeVisible();
      assert.equal(await a.evaluate(account => localStorage.getItem('vespi-contributions:draft:' + account + ':testnet:record'),
        author.account()), null);
    }

    for (const variant of ['gave', 'received', 'mutual', 'link', 'correction', 'declined']) {
      const testScreens = !mainnet && variant === 'gave';
      const text = 'Aporte de prueba ' + network + ' ' + variant + ': revisé el plano del patio.';
      await showHome(author, network);
      await expect(button(a, 'Registrar un aporte')).toBeVisible();
      if (testScreens) await photograph(a, '01-inicio');
      await button(a, 'Registrar un aporte').click();
      if (testScreens) await photograph(a, '02-elegir');
      const received = variant === 'received';
      await button(a, received ? 'Alguien me ayudó' : 'Ayudé a alguien').click();
      const field = a.getByRole('textbox', { name: received ? '¿Qué hizo por ti?' : '¿Qué hiciste?' });
      if (variant === 'gave') {
        const before = await webauthn(a);
        await recordVoice(a, 'registro-' + network);
        await expect(field).toHaveValue(proposals.encounter.contributions[0].text);
        assert.equal(await webauthn(a), before);
      }
      await field.fill(text);
      if (testScreens) await photograph(a, '03-escribir');
      if (variant === 'mutual') {
        await a.getByText('Más detalles', { exact: true }).click();
        const date = a.getByLabel('Fecha', { exact: true });
        await date.fill('');
        await button(a, 'Continuar').click();
        await expect(a.getByRole('status').filter({ hasText: 'Elige una fecha válida' })).toBeVisible();
        await date.fill('2026-11-21');
        await field.fill(text + ' 👩‍💻');
        await button(a, 'Continuar').click();
        await expect(a.getByRole('status').filter({ hasText: 'Quita los emojis combinados' })).toBeVisible();
        await field.fill(text);
        await a.getByLabel('Lugar', { exact: true }).fill('Patio');
        await a.getByLabel('Enlace del aporte', { exact: true }).fill(contributionUrl);
        await button(a, 'También me ayudó').click();
        await a.getByRole('textbox', { name: 'También me ayudó' }).fill('También trajo las medidas.');
      }
      await button(a, 'Continuar').click();
      if (testScreens) await photograph(a, '04-con-quien');
      if (variant === 'link') {
        await button(a, 'Invitar por enlace').click();
        await a.getByLabel('Nombre de la otra persona').fill('Nombre provisional');
      } else {
        await a.getByLabel('Nombre o cuenta de Stellar').fill(variant === 'received' ? guest.account() : 'Invitada');
        await button(a, 'Buscar en Vespi').click();
        await a.getByRole('button', { name: 'Invitada ' + guest.account() }).click();
      }
      await button(a, 'Continuar').click();
      const review = heading(a, 'Revisa tu aporte');
      await expect(review).toBeVisible();
      await expect(a.getByText(consent, { exact: true })).toBeVisible();
      if (mainnet) await expect(a.getByText(permanence, { exact: true })).toBeVisible();
      if (variant === 'mutual') {
        await expect(a.getByRole('link', { name: contributionUrl, exact: true })).toBeVisible();
        if (!mainnet) await photograph(a, '02-revisar');
      }
      if (variant === 'gave') {
        await photograph(a, mainnet ? '06-revisar-mainnet' : '05-revisar-testnet');
        await a.setViewportSize({ width: 375, height: 629 });
        await button(a, 'Read in English').click();
        await expect(heading(a, 'Review your contribution')).toBeVisible();
        await expect(a.getByText('When you both sign, this text and your names will be public on your profiles. Do not name anyone else without their permission.', { exact: true })).toBeVisible();
        await button(a, 'Switch to dark theme').click();
        await audit(a, network + ' revisión en inglés y oscuro', { full: true });
        await button(a, 'Switch to light theme').click();
        await button(a, 'Leer en español').click();
      }
      await a.reload();
      await expect(review).toBeVisible();
      const before = await webauthn(a);
      await button(a, 'Firmar').click();
      await expect(a.getByText('Este aporte aún no es público.', { exact: true })).toBeVisible();
      assert.equal(await webauthn(a) - before, mainnet ? 1 : 0);
      if (testScreens) await photograph(a, '07-espera');
      let invitation = await copy(a, 'Copiar enlace');
      let id = invitation.searchParams.get('encuentro');
      assert.match(id, /^[0-9a-f]{32}$/);
      assert.equal(stored(network, id).draft.visibility, 'public');
      assert.equal(stored(network, id).draft.contributions[0].from, received ? 'b' : 'a');
      await hidden(id, text);
      if (testScreens) {
        const dashboard = path('/app', network) + '&vista=aportes';
        for (const [page, group] of [[a, 'Esperas a otra persona'], [b, 'Te toca firmar']]) {
          await page.goto(dashboard);
          await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible();
          await expect(page.getByText(text, { exact: true })).toBeVisible();
        }
      }

      let recipient = guest;
      if (variant === 'link') {
        assert.match(invitation.hash, /^#invitation=[a-f0-9]{64}$/);
        if (!mainnet) recipient = await phone('Vecina', { network });
        else await signOut(b);
      }
      const page = recipient.page;
      await page.goto(invitation.href);
      if (variant === 'link') {
        if (mainnet) {
          await button(page, 'Iniciar sesión').click();
          await button(page, 'Entrar con mi passkey').click();
        } else {
          await button(page, 'Crear cuenta').click();
          await page.getByRole('textbox', { name: 'Nombre visible' }).fill('Vecina');
          await button(page, 'Crear cuenta con passkey').click();
        }
      }
      await expect(heading(page, 'Revisa este aporte')).toBeVisible();
      await expect(page.getByText(consent, { exact: true })).toBeVisible();
      if (testScreens) await photograph(page, '08-recibir');
      if (variant === 'mutual') {
        const link = page.getByRole('link', { name: contributionUrl, exact: true });
        await expect(link).toBeVisible();
        assert.equal(await heading(page, 'Revisa este aporte').evaluate(node => getComputedStyle(node).outlineStyle), 'none');
        if (!mainnet) await photograph(page, '03-recibir');
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        assert.notEqual(await link.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
      }
      if (variant === 'link') {
        await expect(page.locator('.record-readout').getByText(mainnet ? 'Invitada' : 'Vecina', { exact: true })).toBeVisible();
        await expect(page.locator('.record-readout').getByText('Nombre provisional')).toHaveCount(0);
      }
      if (variant === 'declined') {
        page.once('dialog', dialog => dialog.accept());
        await button(page, 'No lo reconozco').click();
        await expect(heading(page, 'Aporte no reconocido')).toBeVisible();
        assert.equal(stored(network, id).decision.choice, 'declined');
        await hidden(id, text);
        continue;
      }
      if (variant === 'correction') {
        const original = id;
        page.once('dialog', dialog => dialog.accept('Nota privada: fue en el patio norte.'));
        await button(page, 'Pedir un cambio').click();
        await expect(heading(page, 'Cambios solicitados')).toBeVisible();
        await hidden(id, text);
        await a.reload();
        await button(a, 'Preparar nueva versión').click();
        const changed = text + ' En el patio norte.';
        await a.getByRole('textbox', { name: '¿Qué hiciste?' }).fill(changed);
        const revisionDraft = a.url();
        await showHome(author, network);
        await button(a, 'Registrar un aporte').click();
        await expect(button(a, 'Ayudé a alguien')).toBeVisible();
        await a.goto(revisionDraft);
        await expect(a.getByRole('textbox', { name: '¿Qué hiciste?' })).toHaveValue(changed);
        await button(a, 'Continuar').click();
        await button(a, 'Continuar').click();
        await button(a, 'Firmar').click();
        invitation = await copy(a, 'Copiar enlace');
        id = invitation.searchParams.get('encuentro');
        assert.notEqual(id, original);
        assert.equal(stored(network, id).draft.revisionOf, original);
        assert.equal(stored(network, id).draft.visibility, 'public');
        assert.equal(stored(network, id).draft.summary, '');
        assert.equal(stored(network, id).draft.title, changed);
        await hidden(id, text);
        await page.goto(invitation.href);
        await expect(heading(page, 'Revisa este aporte')).toBeVisible();
      }
      await page.reload();
      await expect(heading(page, 'Revisa este aporte')).toBeVisible();
      const second = await webauthn(page);
      await button(page, 'Firmar').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(consent, { exact: true })).toBeVisible();
      await button(dialog, 'Firmar').click();
      await expect(heading(page, 'Firmado por los dos')).toBeVisible();
      assert.equal(await webauthn(page) - second, mainnet ? 1 : 0);
      const publicPath = '/app/aporte/' + id;
      const detail = path(publicPath, network);
      assert.equal((await request.get(path(publicPath, otherNetwork))).status(), 404);
      if (mainnet) {
        const pending = await request.get(detail);
        assert.equal(pending.status(), 200);
        assert.match(await pending.text(), /Registro en Stellar pendiente/);
        const beforeAnchor = await webauthn(page);
        await button(page, 'Registrar huella en Stellar').click();
        await expect(button(page, 'Compartir constancia')).toBeVisible();
        assert.ok(await webauthn(page) - beforeAnchor <= 1);
      } else await expect(button(page, 'Compartir constancia')).toBeVisible();
      for (const account of [author.account(), recipient.account()]) {
        const entry = (await publicList(account)).find(entry => entry.id === id);
        assert.match(entry.anchor.txHash, /^[a-f0-9]{64}$/);
        assert.ok(entry.contributions.some(part => part.text.startsWith(text)));
        if (variant === 'mutual') {
          assert.deepEqual(entry.contributions.map(part => part.from), ['a', 'b']);
          assert.equal(entry.contributions[0].url, contributionUrl);
          assert.deepEqual([entry.date, entry.where], ['2026-11-21', 'Patio']);
        }
        if (variant === 'link') assert.equal(entry.b.displayName, mainnet ? 'Invitada' : 'Vecina');
        const profileResponse = await request.get(profile(account));
        assert.match(await profileResponse.text(), new RegExp(id));
      }
      const response = await request.get(detail);
      assert.equal(response.status(), 200);
      const html = await response.text();
      assert.match(html, /noindex/);
      assert.ok(html.includes(text));
      for (const secret of [stored(network, id).receiptToken, 'Nota privada:', 'inviteUrl', '#invitation=']) assert.ok(!html.includes(secret));
      if (variant === 'link') assert.ok(!html.includes('Nombre provisional'));
      if (variant === 'mutual') {
        await anonymous.page.goto(detail);
        const publicUrl = anonymous.page.getByRole('link', { name: contributionUrl, exact: true });
        await expect(publicUrl).toBeVisible();
        assert.ok(await publicUrl.evaluate(node => node.getBoundingClientRect().height >= 44 && node.scrollWidth <= node.clientWidth));
        await anonymous.page.getByText('Comprobación', { exact: true }).click();
        await expect(anonymous.page.getByText('Mensaje firmado de la propuesta', { exact: true })).toBeVisible();
        await expect(anonymous.page.getByText('Mensaje firmado de la confirmación', { exact: true })).toBeVisible();
        await anonymous.page.getByText('Comprobación', { exact: true }).click();
        if (!mainnet) {
          await photograph(anonymous.page, '06-publico');
          const prefetched = [];
          const observe = request => { if (request.url().includes('/app/aporte/')) prefetched.push(request.url()); };
          anonymous.page.on('request', observe);
          await anonymous.page.goto(profile(author.account()));
          await expect(anonymous.page.getByText('También trajo las medidas.', { exact: true })).toBeVisible();
          await photograph(anonymous.page, '05-perfil');
          await anonymous.page.waitForLoadState('networkidle');
          await anonymous.page.goto(path('/app/constancia/' + stored(network, id).receiptToken, network));
          await expect(anonymous.page.getByRole('link', { name: 'Abrir aporte público', exact: true })).toBeVisible();
          await anonymous.page.waitForLoadState('networkidle');
          anonymous.page.off('request', observe);
          assert.deepEqual(prefetched, [], 'Opening the profile or certificate does not prefetch public contributions');
          const headers = { 'x-forwarded-for': '192.0.2.93' };
          let limited;
          for (let attempt = 0; attempt <= 120; attempt++) limited = await request.get(profile(author.account()), { headers });
          const rateLimited = await limited.text();
          assert.match(rateLimited, /Demasiadas consultas/);
          assert.doesNotMatch(rateLimited, /Todavía no hay aportes públicos confirmados/);
          assert.equal((await request.get(detail, { headers })).status(), 200);
        }
      }
      if (testScreens) {
        await a.goto(path('/app', network) + '&vista=aportes');
        await expect(a.getByRole('heading', { name: 'Listos', exact: true })).toBeVisible();
        await expect(a.getByText(text, { exact: true })).toBeVisible();
        await anonymous.page.goto(profile(author.account()));
        await expect(anonymous.page.getByText('Ayudó a Invitada', { exact: true })).toBeVisible();
        await photograph(anonymous.page, '09-perfil');
        await anonymous.page.goto(detail);
        await photograph(anonymous.page, '10-publico');
      }
      if (variant === 'gave') {
        for (const [width, height] of [[375, 629], [390, 844]]) {
          for (const lang of ['es', 'en']) {
            for (const theme of ['light', 'dark']) {
              const viewer = await phone(undefined, { network });
              await viewer.page.setViewportSize({ width, height });
              await viewer.page.goto(path(publicPath, network, lang));
              if (theme === 'dark') await button(viewer.page, lang === 'es' ? 'Cambiar al tema oscuro' : 'Switch to dark theme').click();
              await expect(viewer.page.getByText(lang === 'es' ? 'Firmado por los dos' : 'Signed by both')).toBeVisible();
              const og = await viewer.page.locator('meta[property="og:description"]').getAttribute('content');
              assert.ok(!og.includes(text));
              await audit(viewer.page, [network, width, height, lang, theme].join(' '), { full: true });
              await viewer.context.close();
            }
          }
        }
        failStore(true);
        try { assert.equal((await request.get(detail)).status(), 503); }
        finally { failStore(false); }
      }
      if (recipient !== guest) await recipient.context.close();
    }
    await anonymous.context.close();
    console.log(network + ' · dos firmas, direcciones, enlace, revisión, rechazo, perfil, ancla, WebAuthn y axe');
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.env.VESPI_RECORD_MOBILE = '1';
  process.env.VESPI_TEST_VOICE = '1';
  void import('./contributions-encounters-mainnet-mobile.mjs').catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
