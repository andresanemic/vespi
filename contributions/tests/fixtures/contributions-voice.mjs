import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { readVoiceAudio } from '../../src/lib/contributions/voice/audio.ts';
import { voiceMessage } from '../../src/lib/contributions/voice/contract.ts';

export const voiceEnabled = process.env.VESPI_TEST_VOICE === '1';
export const voiceChromium = voiceEnabled ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking'] : [];
const captureDir = voiceEnabled ? process.env.VESPI_CAPTURES : undefined;
const mark = /^Propuesto por IA(?:, revísalo\.)?$/;
const id = 'Grabar nota de voz';
const encounterDraft = {
  type: 'reunion', title: 'Conversación propuesta por voz', summary: 'Revisamos un documento.',
  where: 'Santiago', otherName: 'Invitada',
  contributions: [{ from: 'a', text: 'Presenté un contacto.' }],
};

export const proposals = {
  request: { statement: 'Revisa el borrador del documento.', comment: 'Mira el ejemplo.' },
  delivery: { statement: 'Dejé comentarios en el borrador.' },
  encounter: encounterDraft,
};

export async function mockVoice(route, allowed, selectedNetwork, { pause, fail } = {}) {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/voice')) {
    await route.fulfill({ json: { voice: voiceEnabled && allowed(url.searchParams.get('account')) } });
    return true;
  }
  if (!url.pathname.endsWith('/voice-draft')) return false;
  assert.ok(voiceEnabled);
  const headers = route.request().headers();
  const { 'x-vespi-account': account, 'x-vespi-expires': expiration, 'x-vespi-signature': signature,
    'x-vespi-voice-kind': kind, 'x-vespi-audio-sha256': digest, 'x-vespi-nonce': nonce, 'content-type': rawType } = headers;
  const network = url.searchParams.get('network');
  assert.equal(network, selectedNetwork);
  assert.ok(allowed(account));
  const expires = Number(expiration);
  assert.ok(expires > Date.now() / 1000 && expires < Date.now() / 1000 + 301);
  const bytes = route.request().postDataBuffer();
  assert.equal(digest, createHash('sha256').update(bytes).digest('hex'));
  assert.match(nonce, /^[a-f0-9]{32}$/);
  assert.ok(Keypair.fromPublicKey(account).verify(Buffer.from(voiceMessage(network, account, expires, kind, digest, nonce)), Buffer.from(signature, 'hex')));
  assert.match(rawType, /^audio\/webm;codecs=opus/i);
  const audio = readVoiceAudio(bytes, 'audio/webm');
  assert.ok(audio?.duration >= 8 && audio.duration <= 120, JSON.stringify(audio));
  assert.ok(proposals[kind]);
  if (fail) {
    await route.fulfill({ status: 503, json: { ok: false, reason: 'voice-unavailable' } });
    return true;
  }
  if (pause) await pause;
  await route.fulfill({ json: { draft: proposals[kind] } });
  return true;
}

async function snapshot(page, name, audit = false) {
  const { width } = page.viewportSize();
  const panel = page.locator('.voice-draft');
  if (audit) {
    const findings = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(findings.violations.map(({ id: rule, nodes }) => [rule, nodes.map(node => node.target)]), []);
  }
  const size = await panel.boundingBox();
  assert.ok(size && size.x >= 0 && size.x + size.width <= width);
  if (!captureDir) return;
  await mkdir(captureDir, { recursive: true });
  await panel.screenshot({ path: join(captureDir, `79-${name}.png`) });
}

export async function voiceHidden(page) {
  await expect(page.getByRole('button', { name: id, exact: true })).toHaveCount(0);
}

export async function englishDarkConsent(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Read in English', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  const panel = page.locator('.voice-draft');
  await panel.getByRole('button', { name: 'Record a voice note' }).click();
  await expect(panel.getByRole('dialog').getByText('Your audio is sent to an AI service (Vercel AI Gateway and its provider) to write the draft. Vespi does not keep it. Don’t name other people without their permission.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('dialog')).toBeVisible();
  await snapshot(page, 'encuentro-390-oscuro-en', true);
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await page.getByRole('button', { name: 'Leer en español', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 629 });
}

export async function recordVoice(page, label, { inspect = false, expectFailure, resume, field, edit, expected, choice, typedDuringWait } = {}) {
  const record = page.getByRole('button', { name: id, exact: true });
  const consent = page.getByRole('button', { name: 'Entiendo', exact: true });
  const panel = page.locator('.voice-draft');
  const status = panel.getByRole('status');
  await expect(record).toBeVisible();
  const compact = await panel.evaluate(node => node.classList.contains('voice-draft-compact'));
  const composer = await panel.evaluate(node => node.classList.contains('voice-draft-composer'));
  const disclosure = (composer ? panel.locator('dialog') : panel).getByText('Tu audio se envía a un servicio de IA (Vercel AI Gateway y su proveedor) para escribir el borrador. Vespi no lo guarda. No nombres a otras personas sin su permiso.', { exact: true });
  const firstRecording = compact && !await panel.locator('details summary').isVisible();
  if (firstRecording) {
    if (!await consent.isVisible()) {
      await expect(disclosure).toBeHidden();
      await record.click();
    }
    await expect(disclosure).toBeVisible();
    await expect(consent).toBeFocused();
  }
  if (inspect) {
    await expect(disclosure).toBeVisible();
    if (!compact) await expect(record).toBeDisabled();
    for (const button of compact ? [consent] : [record, consent]) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.width >= 44);
    }
    await snapshot(page, label + '-consentimiento', true);
  }
  if (await consent.isVisible()) await consent.click();
  if (!firstRecording) await expect(record).toBeEnabled();
  const stop = panel.getByRole('button', { name: 'Detener grabación' });
  if (inspect) {
    if (!firstRecording) await record.click();
    await stop.click();
    await expect(status).toHaveText('Graba al menos 8 segundos.');
    await expect(status).toBeFocused();
  }
  if (inspect || !firstRecording) await record.click();
  await expect(status).toHaveText('Grabando');
  await expect(status).toBeFocused();
  if (inspect) await snapshot(page, label + '-grabando', true);
  await expect(panel.getByText(composer ? '0:09' : '0:09 / 2:00', { exact: true })).toBeVisible({ timeout: 12_000 });
  await stop.click();
  await expect(status).toHaveText('Escucha tu nota antes de enviarla.');
  await expect(panel.locator('audio')).toBeVisible();
  if (inspect) await snapshot(page, label + '-escucha', true);
  const send = panel.getByRole('button', { name: 'Enviar audio' });
  await send.click();
  if (expectFailure) {
    await expect(status).toHaveText('El servicio de voz no está disponible. Puedes seguir escribiendo.');
    await expect(field).toHaveValue(expectFailure);
    await expect(panel.locator('audio')).toBeVisible();
    await snapshot(page, label + '-servicio-no-disponible', true);
    await send.click();
  }
  if (resume) {
    await expect(status).toHaveText('Escribiendo el borrador…');
    if (inspect) await snapshot(page, label + '-escribiendo');
    if (typedDuringWait) await field.fill(typedDuringWait);
    resume();
  }
  if (choice) {
    const manual = typedDuringWait ?? await field.inputValue();
    await expect(status).toHaveText('Ya hay texto en el formulario. ¿Cómo quieres usar el borrador?');
    await expect(status).toBeFocused();
    await expect(field).toHaveValue(manual);
    for (const name of ['Reemplazar', 'Agregar al final', 'Descartar']) {
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    }
    if (inspect) await snapshot(page, label + '-opciones', true);
    await panel.getByRole('button', { name: choice, exact: true }).click();
    if (choice === 'Descartar') {
      await expect(field).toHaveValue(manual);
      await expect(page.getByText(mark, { exact: true })).toBeHidden();
      await expect(record).toBeFocused();
      return;
    }
  }
  await expect(status).toHaveText('Borrador listo.');
  if (!composer) await expect(compact ? record : status).toBeFocused();
  await expect(page.getByText(mark, { exact: true })).toBeVisible();
  await snapshot(page, label + '-listo', true);
  if (inspect) {
    if (captureDir) await page.screenshot({ path: join(captureDir, `79-${label}-formulario.png`), fullPage: true });
  }
  if (field) {
    await expect(field).toHaveValue(expected);
    await field.fill(edit);
    await expect(page.getByText(mark, { exact: true })).toBeHidden();
  }
}
