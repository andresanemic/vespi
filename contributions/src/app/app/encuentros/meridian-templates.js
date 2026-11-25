import { english } from './meridian-copy';
import { vespiSocialLinks } from '../AppFooter';
import { contributionNetwork, DEFAULT_NETWORK } from '@/lib/contributions/network';
import { deriveRecordTitle, hasUnsupportedEncounterCharacters, isEncounterDate, isEncounterId } from '@/lib/contributions/encounters';
import { withContributionNetwork } from '../client';
import { mergeVoiceText, mountVoiceRecorder, voiceSuggestion } from '../voice-recorder';
import { draftKey, guestDraft, readDraft, saveDraft } from '../composer-draft';
import { hasPendingSubmission, readMobileIdentity } from '../mobile-identity';
import { focusEvent, focusPhase, focusRoot, focusSignPath } from '@/lib/contributions/focus-event';
import { watchLumaChange } from '@/lib/luma-event';

// HTML templates imported from VESPI_FRONTEND_MERIDIAN_AJUSTADO.html.
export function mountMeridian(root, backend, entry, setTheme, network = DEFAULT_NETWORK) {

let locale;
const t = text => locale === 'en' ? english[text] ?? text : text;
const mainnetErrors = {
  'account-not-allowed': 'Esta cuenta no está habilitada para firmar en Stellar mainnet.',
  'recipient-not-allowed': 'La otra cuenta no está habilitada para firmar en Stellar mainnet.',
  'mainnet-unavailable': 'Stellar mainnet no está disponible ahora.',
  'mainnet-not-supported': 'Este paso solo está disponible en testnet.',
  'account-unavailable': 'No pudimos comprobar tu cuenta en Stellar mainnet.',
  'profile-unavailable': 'No pudimos leer o guardar el nombre de tu cuenta.',
  'busy': 'El alta está ocupada. Inténtalo en un momento.',
  'testnet-account-missing': 'Tu cuenta ya no existe en Stellar testnet. La red de pruebas puede haberse reiniciado. Sal y vuelve a entrar para reactivarla.',
};
const errorText = (error, fallback) => t(((mainnet || error?.message === 'testnet-account-missing') && mainnetErrors[error?.message]) ||
  (Object.hasOwn(english, error?.message) ? error.message : fallback));
function setLocale(language) {
  root.lang = language;
  document.documentElement.lang = language;
  try { localStorage.setItem('vespi-lang', language); } catch {}
}
try { locale = localStorage.getItem('vespi-lang'); } catch {}
const mainnet = network === 'mainnet';
const linkedLanguage = new URL(location.href).searchParams.get('lang');
if (linkedLanguage === 'en' || linkedLanguage === 'es') locale = linkedLanguage;
locale = locale === 'es' || locale === 'en' ? locale : document.documentElement.lang.startsWith('es') ? 'es' : 'en';
root.lang = locale;
let draftOwner = readMobileIdentity()?.account ?? guestDraft;
const encounterDraftKey = (legacy = false, owner = draftOwner, revision) =>
  draftKey(owner, network, (legacy ? 'encounter' : 'record') + (revision ? ':revision:' + revision : ''));
function savedDraft(legacy, revision, owner = draftOwner) {
  const normalKey = encounterDraftKey(legacy, owner);
  const normal = readDraft(normalKey);
  if (isEncounterId(normal?.revisionOf)) {
    const oldRevision = encounterDraftKey(legacy, owner, normal.revisionOf);
    if (!readDraft(oldRevision)) saveDraft(oldRevision, normal);
    const migrated = readDraft(oldRevision);
    if (migrated) saveDraft(normalKey);
    if (revision === normal.revisionOf) return migrated ?? normal;
  }
  return revision ? readDraft(encounterDraftKey(legacy, owner, revision)) : normal?.revisionOf ? undefined : normal;
}
let state={view:'home',step:1,exampleStep:1,records:[],draft:null,legacyDraft:false,current:null,authModal:null,afterAuth:null,signActor:null,sessionName:null,mainnetEligible:false};
const today=()=>new Date().toLocaleDateString('sv-SE');
const esc=(s)=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeLink=(s)=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}};
const el=root.querySelector('#app');
const uid=()=>String(Date.now())+Math.random().toString(36).slice(2,7);
function blank(type='reunion'){return{id:uid(),type,title:'',date:today(),where:'',summary:'',a:'',b:'',contributions:[{id:uid(),from:'a',text:'',url:''}],confirmations:{a:false,b:false},status:'draft',revision:1,created:Date.now()}}
function hasUnsupportedRecordDetails(r) {
  return [r.where, ...r.contributions.flatMap(c => [c.text, c.url])].some(hasUnsupportedEncounterCharacters);
}
function startDraft(legacy = false, revision) {
  state.legacyDraft = legacy;
  const saved = savedDraft(legacy, revision);
  state.resumedDraft = Boolean(saved && !legacy && !revision);
  state.draft = saved ?? (legacy || revision ? null : { ...blank('ayuda'), visibility: 'public', a: state.sessionName ?? '' });
  state.step = saved?.step ?? 1;
  if (saved && !legacy && state.step > 2) {
    if (!isEncounterDate(saved.date) || hasUnsupportedRecordDetails(saved)) state.step = 2;
    else if (state.step === 4) {
      saved.title = deriveRecordTitle(saved.contributions[0].text);
      saved.summary = '';
    }
  }
  profileSearch = undefined;
}
function exampleRecord(){return{id:uid(),type:'reunion',title:'Intercambio de ideas entre dos proyectos',date:today(),where:'Reunión virtual',summary:'Compartimos un contacto útil y un recurso para continuar colaborando. Ejemplo ficticio.',a:'Camila',b:'Diego',contributions:[{id:uid(),from:'a',text:'Camila compartió el contacto de una persona que podía orientar el proyecto.',url:''},{id:uid(),from:'b',text:'Diego compartió una herramienta de código abierto para probar.',url:''}],confirmations:{a:false,b:false},status:'draft',revision:1,created:Date.now()}}
function status(r){if(r.status==='correction')return[t("Cambios solicitados"),'pending'];if(r.status==='declined')return[t("Encuentro no reconocido"),'info'];if(r.status==='draft')return[t("Borrador"),''];if(r.b&&r.confirmations.a&&r.confirmations.b)return[t("Confirmado por ambos"),'done'];if(!r.b&&r.confirmations.a)return[t("Declaración personal"),'info'];return[t("Esperando confirmación"),'pending']}
function cname(r,k){return k==='a'?r.a:(r.b||t("Comunidad / evento"))}
function cFrom(r,c){return cname(r,c.from)}
function cTo(r,c){return c.from==='a'?cname(r,'b'):cname(r,'a')}
function ctLabel(c,r){return esc(cFrom(r,c))+' → '+esc(cTo(r,c))}
let openRequest = 0;
let confirmedNow = null;
let authTrigger;
let authName = '';
let saveMainnetName;
let profileSearch;
let accessProblem;
let sessionProblem;
let authVersion = 0;
let voice;

function networkOptions() {
  const canChoose = state.mainnetEligible && state.view !== 'detail';
  if (!mainnet && !canChoose) return '';
  const label = mainnet ? 'Mainnet' : 'Testnet';
  const indicator = (mainnet ? '<span class="mobile-network-dot" aria-hidden="true"></span>' : '') + label;
  return `<div class="mobile-network" ${mainnet ? 'data-mainnet' : ''}>
    ${canChoose ? `<button type="button" class="mobile-network-label" aria-haspopup="dialog"
      aria-label="${label}, ${t('cambiar red')}" data-act="network">${indicator}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
    <dialog class="mobile-bottom-sheet" aria-labelledby="meridian-network-heading">
      <h2 id="meridian-network-heading">${t('Red de Stellar')}</h2>
      <form data-network-form>
        <fieldset class="mobile-network-options" aria-labelledby="meridian-network-heading">
          ${['testnet', 'mainnet'].map(option => `<label>
            <input type="radio" name="network" value="${option}" ${option === network ? 'checked' : ''}>
            ${option === 'mainnet' ? 'Mainnet' : 'Testnet'}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </label>`).join('')}
        </fieldset>
        <button class="btn primary">${t('Continuar')}</button>
        <button class="btn ghost" type="button" data-act="network-cancel">${t('Cancelar')}</button>
      </form>
    </dialog>` : `<span class="mobile-network-label">${indicator}</span>`}
  </div>`;
}

function mainnetNotice(action) {
  if (!mainnet) return '';
  return `<div class="mobile-mainnet-notice encounter-mainnet-notice"><p><strong>${t(action)}</strong></p>
    <p>${t('Al anclar la huella, quedan públicos y permanentes en Stellar mainnet la transacción, la huella y las cuentas que firman el anclaje y pagan la comisión.')}</p>
    <p>${t('El contenido y las firmas de propuesta y confirmación quedan en el registro privado. El recibo público de anclaje incluye la fecha y hora en que Vespi guardó el registro.')}</p>
    <p>${t('Quien tenga el enlace de la constancia puede ver si es una declaración personal o un encuentro confirmado por dos personas, cuántos aportes hay y los enlaces a la transacción en Stellar y a la verificación de la huella y la firma de anclaje.')}</p>
  </div>`;
}

function publicConsent() {
  return `<p class="record-consent">${t('Cuando ambos firmen, este texto y sus nombres serán públicos en sus perfiles. No nombres a otras personas sin su permiso.')}</p>
    ${mainnet ? `<div class="mobile-mainnet-notice encounter-mainnet-notice">
      <p><strong>${t('El contenido será público en Vespi; en Stellar queda la huella.')}</strong></p>
      <p>${t('Al anclar la huella, quedan públicos y permanentes en Stellar mainnet la transacción, la huella y las cuentas que firman el anclaje y pagan la comisión.')}</p>
    </div>` : ''}`;
}

async function checkMainnet(account) {
  const allowed = await backend.mainnetEligible(account).catch(() => false);
  if (state.accountId !== account || state.mainnetEligible === allowed) return;
  state.mainnetEligible = allowed;
  refreshNetworkOptions();
}

function refreshNetworkOptions() {
  const slot = root.querySelector('[data-network-options]');
  if (slot) slot.innerHTML = networkOptions();
}

function stopVoice() {
  voice?.dispose?.();
  voice = undefined;
}

function syncVoice() {
  const slot = root.querySelector('[data-voice-slot]');
  if (!slot || !state.accountId || state.authModal) return stopVoice();
  const r = state.draft;
  const key = [r.id, state.accountId, locale, network, r.visibility === 'public' ? r.contributions[0].from : 'legacy'].join(':');
  if (voice?.key !== key) {
    stopVoice();
    const host = document.createElement('div');
    const hasContribution = c => c.text.trim() || c.url.trim();
    const dispose = mountVoiceRecorder(host, {
      account: state.accountId, lang: locale, network, kind: 'encounter', composer: true,
      getSigner: backend.voiceSigner, needsPasskey: backend.voiceNeedsPasskey,
      hasWritten(draft) {
        if (r.visibility === 'public') return Boolean(r.contributions[0].text.trim());
        return 'title' in draft && Boolean(
          draft.title && r.title.trim() || draft.summary && r.summary.trim() || draft.where && r.where.trim() ||
          draft.otherName && r.b.trim() && draft.otherName !== r.b || draft.contributions.length && r.contributions.some(hasContribution) ||
          draft.type && r.type !== 'reunion' && draft.type !== r.type || draft.date && r.date && r.date !== today() && draft.date !== r.date
        );
      },
      onDraft(draft, choice) {
        if (!('title' in draft) || r !== state.draft) return;
        if (r.visibility === 'public') {
          const contribution = r.contributions[0];
          const text = draft.contributions.find(item => item.from === contribution.from)?.text ||
            draft.summary || draft.contributions[0]?.text || draft.title;
          contribution.text = mergeVoiceText(contribution.text, text, choice, 1000);
          r.voiceSuggested = true;
          persistDraft();
          render();
          root.querySelector('#record-text')?.focus({ preventScroll: true });
          return;
        }
        const replace = choice === 'replace';
        if (draft.type && replace) r.type = draft.type;
        if (draft.date && (replace || !r.date)) r.date = draft.date;
        r.title = mergeVoiceText(r.title, draft.title, choice, 140, ' ');
        r.where = mergeVoiceText(r.where, draft.where ?? '', choice, 200, ' ');
        r.summary = mergeVoiceText(r.summary, draft.summary, choice, 1000);
        if (draft.otherName && !r.revisionOf && !r.bAccount && (!r.b.trim() ||
            replace && !r.contributions.some(c => c.from === 'b' && hasContribution(c)))) r.b = draft.otherName;
        const written = replace ? [] : r.contributions.filter(hasContribution);
        const offered = draft.contributions.filter(c => c.from === 'a' || draft.otherName === r.b)
          .filter(c => !written.some(previous => previous.from === c.from && previous.text === c.text));
        if (offered.length) {
          r.contributions = [...written, ...offered.slice(0, Math.max(0, 12 - written.length)).map(c => ({ ...c, id: uid(), url: '' }))];
        }
        r.voiceSuggested = true;
        persistDraft();
        render();
      },
    });
    voice = { key, host, dispose };
  }
  slot.append(voice.host);
}

function clearVoiceSuggestion() {
  if (!state.draft?.voiceSuggested) return;
  delete state.draft.voiceSuggested;
  const mark = root.querySelector('.voice-suggestion');
  if (mark) mark.hidden = true;
}

function encounterDate(date) {
  const parsed = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsed.valueOf())) return date;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-CL' : 'en', { dateStyle:'medium', timeZone:'UTC' }).format(parsed);
}

function dateField(date) {
  return `<div class="date-field">
    <span id="date-display" aria-hidden="true">${esc(encounterDate(date) || t('Elige una fecha'))}</span>
    <input id="date" type="date" value="${esc(date)}">
  </div>`;
}

function updateDraftDate(input) {
  if (state.view !== 'wizard' || state.draft.date === input.value) return;
  clearVoiceSuggestion();
  state.draft.date = input.value;
  root.querySelector('#date-display').textContent = encounterDate(input.value) || t('Elige una fecha');
  persistDraft();
}

function nextAction(record) {
  if (record.status === 'correction' && record.aAccount === state.accountId) return t('Revisar cambios');
  if (record.status === 'pending' && record.bAccount === state.accountId && canReview(record)) return t('Revisar encuentro');
  return '';
}

function statusText(record) {
  if (record.status === 'pending' && record.b) {
    if (record.visibility === 'public' && !canReview(record)) return t('Esperando la firma de {nombre}').replace('{nombre}', () => record.b);
    if (canReview(record)) return t('Por confirmar');
    if (!record.bAccount && record.inviteMode !== 'link') return t('Falta elegir quién confirma');
    return t('Falta que {nombre} confirme').replace('{nombre}', () => record.b);
  }
  return status(record)[0];
}
 function dialogMarkup(){
  if(!state.authModal)return '';
  const mode=state.authModal;
  const isSign=mode==='sign';
  const isAccount=mode==='account';
   const label=isSign?t("Revisa lo que vas a confirmar"):isAccount?t("Mi cuenta"):mode==='register'?t("Crea tu cuenta en Vespi"):
     saveMainnetName?t('Elige tu nombre en mainnet'):
    state.afterAuth==='publish'?t(state.draft?.visibility === 'public' ? 'Entra para firmar tu aporte' : 'Entra para guardar tu encuentro'):
    state.afterAuth==='voice'?t('Entra para usar el micrófono'):state.afterAuth?t("Entra para revisar la invitación"):t("Accede a tu cuenta");
  const r=isSign?state.records.find(x=>x.id===state.current):null;
  const body=isSign&&r?`<div class="auth-body">${r.visibility === 'public' ?
    recordReadout(r) + publicConsent() :
    `<p>${t("La confirmación debe corresponder a esta versión exacta del encuentro.")}</p><div class="sign-readout"><strong>${esc(r.title)}</strong><span>${t("Versión")} ${r.revision} · ${r.contributions.length} ${t(r.contributions.length === 1 ? 'aporte' : 'aportes')}</span><span>${t("Declara")}: ${esc(state.sessionName||cname(r,state.signActor||'a'))}</span></div>${mainnet ? mainnetNotice('Tu firma confirma esta versión del encuentro.') : `<div class="auth-notice">${t("La passkey confirma que tú revisaste esta versión.")} · Stellar testnet</div>`}`}
    <button class="btn primary" data-act="confirm-sign">${t(r.visibility === 'public' ? 'Firmar' : 'Firmar y confirmar')}</button><button class="btn secondary" data-act="close-modal">${t("Volver sin confirmar")}</button></div>`:
  isAccount?`<div class="auth-body"><p><strong>${esc(state.sessionName)}</strong></p><dl class="profile-address"><dt>${t('Dirección de Stellar')}</dt><dd><code>${esc(state.accountId)}</code></dd></dl><button type="button" class="btn secondary" data-act="copy-account">${t('Copiar dirección')}</button><button class="btn secondary" data-act="logout">${t("Cerrar sesión")}</button></div>`:
  mode==='register'
    ? `<div class="auth-body"><div class="field"><label for="auth-name">${t("Nombre visible")}</label><input id="auth-name" autocomplete="nickname" maxlength="40" value="${esc(authName)}"></div><p>${t("Usarás tu passkey para volver a entrar y firmar.")}</p><button class="btn primary" data-act="auth-complete">${t("Crear cuenta con passkey")}</button><p class="auth-switch">${t("¿Ya tienes cuenta?")} <button type="button" data-act="login">${t("Iniciar sesión")}</button></p></div>`
     : saveMainnetName ? `<div class="auth-body"><div class="field"><label for="auth-name">${t("Nombre visible")}</label><input id="auth-name" autocomplete="nickname" maxlength="40" value="${esc(authName)}"></div><p>${t('Tu nombre quedará visible en el directorio de mainnet.')}</p>${state.authError ? `<p role="alert">${esc(state.authError)}</p>` : ''}<button class="btn primary" data-act="auth-complete">${t('Guardar nombre y entrar')}</button></div>`
     : `<div class="auth-body">${mainnet ? `<p class="mobile-mainnet-notice encounter-mainnet-notice">${t('Solo pueden entrar cuentas habilitadas. Si es tu primera entrada, Stellar publicará la transacción de alta y tu dirección. Vespi guardará tu nombre visible en el directorio de mainnet.')}</p>` : ''}
        ${state.authError ? `<p role="alert">${esc(state.authError)}</p>` : ''}
        <button class="btn primary" data-act="auth-complete">${t("Entrar con mi passkey")}</button>${mainnet || state.afterAuth === 'review' ? '' : `<p class="auth-switch">${t("¿Primera vez en Vespi?")} <button type="button" data-act="register">${t("Crear cuenta")}</button></p>`}<details class="auth-help"><summary>${t("Ayuda para entrar")}</summary><p>${t("Busca la passkey en tu dispositivo o en el gestor donde la guardaste.")}</p></details></div>`;
  return `<div class="auth-overlay" data-overlay="true"><section class="auth-card" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="auth-top"><div><h2>${esc(label)}</h2></div><button type="button" class="close-auth" aria-label="${t("Cerrar ventana")}" data-act="close-modal">×</button></div>${body}</section></div>`;
 }
 function focusAuthTrigger(){
  if (!authTrigger) return;
  const { action, id, inMenu } = authTrigger;
  if (inMenu && root.querySelector('[data-act="menu"]')?.getClientRects().length) setMenu(true);
  const scope = inMenu ? root.querySelector('#meridian-menu') : root;
  const trigger = [...scope.querySelectorAll('[data-act]')].find(button =>
    button.dataset.act === action && button.dataset.id === id && button.getClientRects().length);
  (trigger ?? root.querySelector('[data-act="menu"]'))?.focus({ preventScroll: true });
 }
 function closeDialog(){
  authVersion++;
  state.authModal=null;
  state.afterAuth=null;
   if (saveMainnetName) authName='';
   saveMainnetName=undefined;
  render();
  focusAuthTrigger();
 }
 function openDialog(mode,after=null){
  authVersion++;
  state.authError=null;
  if (!state.authModal) {
    const active = root.getRootNode().activeElement ?? root.activeElement;
    authTrigger = active?.dataset?.act ? { action: active.dataset.act, id: active.dataset.id,
      inMenu: root.querySelector('#meridian-menu')?.contains(active) } : undefined;
  }
  state.authModal=mode;
  if(after)state.afterAuth=after;
  render();
  const focus = root.querySelector('#auth-name, [data-act="auth-complete"], [data-act="confirm-sign"]') ?? root.querySelector('.auth-card button');
  focus?.focus({ preventScroll: true });
 }
 function navigation() {
   const v = state.view;
  const homeActive = ['home', 'wizard', 'example', 'how'].includes(v);
  const recordsActive = v === 'detail';
   return `<button type="button" data-act="home" ${homeActive ? 'class="active" aria-current="page"' : ''}>${t('Inicio')}</button>
    ${state.sessionName ? `<button type="button" data-act="records" ${recordsActive ? 'class="active" aria-current="page"' : ''}>${t('Mis aportes')}</button>
      <button type="button" data-act="account">${t('Mi cuenta')}</button>` : ''}`;
 }
 function sessionActions() {
   return state.sessionName
     ? `<button type="button" class="signed-in" data-act="account">${esc(state.sessionName)}</button>`
     : `<button type="button" data-act="login">${t('Iniciar sesión')}</button>
       ${mainnet ? '' : `<button type="button" data-act="register">${t('Crear cuenta')}</button>`}`;
 }
 function testnetBadge() {
   return mainnet ? '' : '<span class="pill"><span class="dot" aria-hidden="true"></span> Stellar testnet</span>';
 }
 function wrapper(content, recent = []) {
   const v = state.view;
   const recordsActive = v === 'detail';
  const brand = className => `<button type="button" class="logo ${className}" data-act="home"
    aria-label="${t('Vespi Contributions, Inicio')}"><small>Contributions</small></button>`;
  const dark = document.documentElement.dataset.theme === 'dark';
  const themeLabel = t(dark ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro');
  const nav = navigation();
  el.innerHTML = `<div class="app" data-view="${v}"${state.authModal ? ' inert' : ''}>
    <aside class="sidebar">${brand('')}
      <nav class="nav" aria-label="${t('Navegación principal')}">${nav}</nav>
      ${recent.length ? recentEncounters(recent, 'rail-recent') : ''}
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="topbar-main">
          ${brand('mobile-brand')}
          <span class="workspace-title">${t(recordsActive ? 'Mis aportes' : 'Inicio')}</span>
          <div class="topbar-tools">
            ${mainnet ? '' : `<div class="desktop-network">${testnetBadge()}</div>`}
            <button type="button" class="locale-toggle" data-act="language"
              aria-label="${locale === 'es' ? 'Read in English' : 'Leer en español'}">${locale === 'es' ? 'EN' : 'ES'}</button>
            <button type="button" class="theme-toggle" data-act="theme" aria-label="${themeLabel}" title="${themeLabel}"><span aria-hidden="true"></span></button>
            <div class="session-actions">${sessionActions()}</div>
            <button type="button" class="menu-toggle" data-act="menu" aria-controls="meridian-menu" aria-expanded="false">${t('Menú')}</button>
          </div>
        </div>
        <nav id="meridian-menu" class="mobile-nav" aria-label="${t('Navegación principal')}" hidden>
          ${nav}${state.sessionName ? '' : sessionActions()}${testnetBadge()}
        </nav>
      </header>
      <div class="content${v==='home'?' app-home':''}">
        <div data-network-options>${networkOptions()}</div>
        ${sessionProblem && v !== 'detail' ? `<p class="mobile-mainnet-notice" role="alert">${t(mainnetErrors[sessionProblem])}</p>` : ''}
        ${content}</div>
      <footer class="app-footer">
        <div class="footer-site"><a href="/">${t('Escritorio de Vespi')}</a>
        <a href="${locale === 'es' ? '/contributions/es' : '/contributions'}">${t('¿Qué es Vespi Contributions?')}</a></div>
        <div class="footer-social">${vespiSocialLinks.map(([name, url]) => `<a href="${url}">${name}</a>`).join('')}</div>
      </footer>
    </main>
  </div>${dialogMarkup()}`;
  syncVoice();
}

function recordActions() {
  const unowned = (() => {
    try { return localStorage.getItem('vespi-encuentros-borrador-integracion-v1' + (mainnet ? ':mainnet' : '')); }
    catch { return null; }
  })();
  return `<div class="record-actions">
    <button class="btn primary" data-act="new">${t('Registrar un aporte')}</button>
    <a class="record-text-action" href="${esc(withContributionNetwork('/app?vista=aportes&accion=pedir&lang=' + locale, network))}">${t('¿Necesitas ayuda? Pide un aporte')}</a>
    <a class="record-text-action" href="${esc(withContributionNetwork('/app?vista=aportes&lang=' + locale, network))}">${t('Mis aportes')}</a>
    ${savedDraft(true) ? `<button class="btn ghost" data-act="resume-legacy">${t('Continuar borrador privado')}</button>` : ''}
    ${unowned ? `<p class="small">${t('Hay un borrador antiguo sin cuenta asociada guardado en este navegador.')}</p>` : ''}
  </div>`;
}

function home() {
  const announcement = focusEvent.copy[locale];
  const pending = state.records.find(nextAction);
  const priority = pending ? `<section class="home-pending" aria-labelledby="home-pending-title">
    <h2 id="home-pending-title">${t('Me toca actuar')}</h2>${recordRow(pending)}</section>` : '';
  const recent = state.records.filter(record => record.id !== pending?.id).sort((a,b) => b.created - a.created).slice(0, 3);
  wrapper(`<section class="hero archive-home">
    <div class="home-garden" aria-hidden="true"></div>
    <div class="home-intro">
      <h1>${t('Registra y comparte aportes')}</h1>
      <p>${t('Deja por escrito la ayuda que diste o recibiste.')}</p>
      ${recordActions()}
    </div>
  </section>${!mainnet && focusRoot && focusPhase(Date.now()) === 'open' ? `<section class="home-announcement">
    <div><h2>${esc(announcement.title)}</h2><time datetime="${focusEvent.startsAt}">${esc(announcement.date)}</time></div>
    <div class="home-announcement-actions">
    <a class="record-text-action" href="${focusSignPath(focusRoot, locale)}">${esc(announcement.attend)} <span aria-hidden="true">→</span></a></div>
  </section>` : ''}${priority}${recent.length ? recentEncounters(recent, 'mobile-recent') : ''}`, recent);
}

function recentEncounters(records, place) {
  return `<section class="${place}" aria-labelledby="${place}-title">
    <h2 id="${place}-title">${t('Aportes recientes')}</h2>
    <div class="stack">${records.map(recordRow).join('')}</div>
  </section>`;
}

function recordRow(record) {
  const action = nextAction(record);
  const [, kind] = status(record);
  return `<button class="archive-record" type="button" data-act="open" data-id="${esc(record.id)}">
    <span class="archive-record-main"><strong>${esc(record.title || t('Sin título'))}</strong>
      <span>${esc(encounterDate(record.date))} · ${esc(record.a)}${record.b ? t(' y ') + esc(record.b) : ''}
        ${record.visibility === 'public' ? '' : ' · ' + t('Privado')}</span>
    </span>
    <span class="archive-record-state ${kind}">${esc(action || statusText(record))} <span aria-hidden="true">→</span></span>
  </button>`;
}

function how(){wrapper(`<button class="back" data-act="home">${t("← Volver al inicio")}</button><div class="eyebrow">${t("Cómo funciona")}</div><h1 style="font-size:2.7rem;margin:7px 0 16px">${t("Cómo funciona Vespi Contributions")}</h1><p style="max-width:680px;margin-bottom:25px">${t("No necesitas que alguien solicite una revisión ni que exista una tarea formal. Puedes registrar una interacción que ya ocurrió.")}</p><div class="panel">${[['01',t("Registrar"),t("Describe el encuentro y quiénes participaron.")],['02',t("Aportes en ambas direcciones"),t("Cada registro admite varios aportes, incluso cuando ambas personas ayudaron.")],['03',t("Compartir para revisar"),t("Comparte un enlace para que la otra persona revise el encuentro desde su cuenta.")],['04',t("Confirmar o corregir"),t("Cada participante confirma lo que sabe; las correcciones reabren la revisión.")],['05',t("Recibo"),t("Solo cuando ambos confirman se etiqueta como confirmado por ambas personas.")]].map(s=>`<div class="flowItem"><span class="stepnum" style="flex-shrink:0;margin:0">${s[0]}</span><div style="flex:1"><strong>${s[1]}</strong><p class="small">${s[2]}</p></div></div>`).join('')}</div><div class="trust"><strong>${t("¿Y si asististe a una charla?")}</strong><br/>${t("Puedes registrar una charla sin indicar a otra persona. Aparecerá como una declaración personal, nunca como confirmación de un organizador. Para verificarla con terceros necesitarás una contraparte real.")}</div>`)}
function exampleScreen(){
 const r=exampleRecord();
 const n=state.exampleStep;
 const titles=[t('El encuentro'),t('Aportes compartidos'),t('Confirmado por ambos')];
 const steps=[t('Contexto'),t('Aportes'),t('Confirmación')];
 const body=n===1?`<h2>${esc(t(r.title))}</h2><p>${esc(t(r.where))}</p><p>${esc(t(r.summary))}</p><p>Camila · Diego</p>`
   :n===2?r.contributions.map(c=>`<div class="inner"><strong>${ctLabel(c,r)}</strong><p>${esc(t(c.text))}</p></div>`).join('')
   :`<p>${t('Cada persona vio los mismos aportes y confirmó esta versión del encuentro.')}</p><div class="statusrow"><span>Camila</span><span class="badge done">${t('Confirmó')}</span></div><div class="statusrow"><span>Diego</span><span class="badge done">${t('Confirmó')}</span></div>`;
 wrapper(`<button class="back" data-act="home">← ${t('Volver al inicio')}</button>
   <div class="formtitle"><div class="eyebrow">${t('Ejemplo de colaboración')}</div><h1>${titles[n-1]}</h1><p>${t('Ejemplo ficticio')}</p></div>
   <div class="progress">${steps.map((step,i)=>`<span class="progressitem ${n===i+1?'on':''}" ${n===i+1?'aria-current="step"':''}>${i+1}. ${step}</span>`).join('')}</div>
   <div class="panel stack">${body}</div>
   <div class="bar"><button class="btn secondary" data-act="example-prev" ${n===1?'disabled':''}>${t('Anterior')}</button><button class="btn primary right" data-act="${n<3?'example-next':'home'}">${n<3?t('Continuar'):t('Terminar ejemplo')}</button></div>`);
}
function recipientPicker(r) {
  const isPublic = r.visibility === 'public';
  if ((!r.b && !isPublic) || r.revisionOf) return '';
  if (r.inviteMode === 'link') return `<div class="recipient-picker">
    ${isPublic ? `<div class="field"><label for="record-recipient-name">${t('Nombre de la otra persona')}</label>
      <input id="record-recipient-name" data-bind="b" value="${esc(r.b)}" maxlength="80" autocomplete="off"></div>`
      : `<strong>${t(mainnet ? 'Invitación privada en mainnet' : 'Invitación para alguien sin cuenta')}</strong>`}
    <p>${t(mainnet ? 'Envía el enlace solo a esa persona. Solo una cuenta habilitada en mainnet puede responder. La primera que lo haga quedará vinculada al encuentro.' : 'Envía el enlace solo a esa persona. La primera cuenta que responda desde el enlace quedará vinculada al encuentro.')}</p>
    <button class="btn secondary" data-act="change-recipient">${t('Buscar una cuenta')}</button>
  </div>`;
  if (r.bAccount) return `<div class="recipient-picker"><strong>${t('Invitarás a')} ${esc(r.b)}</strong>
    <code>${esc(r.bAccount)}</code><button class="btn secondary" data-act="change-recipient">${t('Elegir otra cuenta')}</button></div>`;
  const search = profileSearch?.draft === r ? profileSearch : null;
  return `<div class="recipient-picker">
    <div class="field"><label for="recipient-search">${t(isPublic ? 'Nombre o cuenta de Stellar' : 'Busca a la persona que va a confirmar')}</label>
      <input id="recipient-search" value="${esc(search?.query ?? r.b)}" maxlength="80" autocomplete="off"></div>
    <button class="btn secondary" data-act="find-recipient">${t('Buscar en Vespi')}</button>
    <button class="btn ghost" data-act="invite-without-account">${t(isPublic ? 'Invitar por enlace' : mainnet ? 'Preparar un enlace privado' : 'La otra persona todavía no tiene cuenta')}</button>
    ${search?.profiles?.length ? `<ul>${search.profiles.map(profile => `<li><button class="btn secondary" data-act="pick-recipient" data-id="${esc(profile.account)}">
      <strong>${esc(profile.displayName)}</strong><code>${esc(profile.account)}</code></button></li>`).join('')}</ul>`
      : search?.profiles ? `<p role="status">${t('No encontramos esa cuenta. Prueba con otro nombre o con su dirección de Stellar.')}</p>` : ''}
  </div>`;
}

function recordReadout(r) {
  // On a link invitation, the account holder reviews their own registered name.
  if (r.inviteMode === 'link' && canReview(r)) r = { ...r, b: state.sessionName };
  return `<div class="record-readout">
    ${r.contributions.map(c => `<div><p class="record-people"><strong>${esc(cFrom(r,c))}</strong> ${t('ayudó a')} <strong>${esc(cTo(r,c))}</strong></p>
      <p class="record-quote" dir="auto">${esc(c.text)}</p>
      ${safeLink(c.url) ? `<a class="record-text-action record-url" dir="ltr" href="${esc(safeLink(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.url.trim().normalize('NFC'))}</a>` : ''}</div>`).join('')}
    <p class="small"><time datetime="${esc(r.date)}">${esc(encounterDate(r.date))}</time>${r.where ? ' · ' + esc(r.where) : ''}</p>
  </div>`;
}

function publicWizard(r) {
  const [primary, secondary] = r.contributions;
  const gave = primary.from === 'a';
  const prompt = t(gave ? '¿Qué hiciste?' : '¿Qué hizo por ti?');
  const opposite = t(gave ? 'También me ayudó' : 'También le ayudé');
  const [title, content] = [
    [t('Registrar un aporte'), `<div class="record-choices">
      <button class="record-choice" type="button" data-act="record-direction" data-id="a">${t('Ayudé a alguien')} <span aria-hidden="true">→</span></button>
      <button class="record-choice" type="button" data-act="record-direction" data-id="b">${t('Alguien me ayudó')} <span aria-hidden="true">→</span></button>
    </div>`],
    [prompt, `<div class="mobile-composer-field">
      <textarea id="record-text" aria-labelledby="record-heading" data-cid="${esc(primary.id)}" data-cfield="text" maxlength="1000" placeholder="${t('Escribe o usa el micrófono')}">${esc(primary.text)}</textarea>
      <div data-voice-slot></div>
      ${!state.sessionName ? `<button data-wizard-signed-out type="button" class="record-mic" aria-label="${t('Grabar audio')}" data-act="record-voice">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-3 0h6"/></svg></button>` : ''}
    </div>
    ${r.voiceSuggested ? `<p class="voice-suggestion">${voiceSuggestion(locale)}</p>` : ''}
    <details class="record-details" ${secondary ? 'open' : ''}>
      <summary>${t('Más detalles')}</summary>
      <div class="formgrid">
        <div class="field"><label for="date">${t('Fecha')}</label>${dateField(r.date)}</div>
        <div class="field"><label for="record-place">${t('Lugar')}</label><input id="record-place" data-bind="where" value="${esc(r.where)}" maxlength="200"></div>
        <div class="field span"><label for="record-url">${t('Enlace del aporte')}</label><input id="record-url" data-cid="${esc(primary.id)}" data-cfield="url" type="url" value="${esc(primary.url)}" maxlength="1000" placeholder="https://…"></div>
        ${secondary ? `<div class="field span"><label for="record-extra">${opposite}</label>
          <textarea id="record-extra" data-cid="${esc(secondary.id)}" data-cfield="text" maxlength="1000">${esc(secondary.text)}</textarea>
          <button class="btn ghost" data-act="record-remove-extra">${t('Quitar segundo aporte')}</button></div>`
          : `<button class="btn secondary span" data-act="record-extra">${opposite}</button>`}
      </div>
    </details>`],
    [t('¿Con quién?'), r.revisionOf ? `<p>${esc(r.b)}</p>` : recipientPicker(r)],
    [t('Revisa tu aporte'), recordReadout({ ...r, a: state.sessionName ?? t('Tú') }) + publicConsent()],
  ][state.step - 1];
  const back = state.step === 1 ? 'home' : 'prev';
  wrapper(`<section class="record-flow" aria-labelledby="record-heading">
    <button type="button" class="back" data-act="${back}">← ${t('Volver')}</button>
    <div class="panel record-panel">
      <h1 id="record-heading">${title}</h1>
      ${state.resumedDraft ? `<div class="record-resumed"><p>${t('Retomaste tu borrador.')}</p>
        <button type="button" class="btn ghost" data-act="record-restart">${t('Empezar de nuevo')}</button></div>
        <dialog class="mobile-bottom-sheet record-restart-dialog" aria-labelledby="record-restart-heading">
          <h2 id="record-restart-heading">${t('¿Empezar de nuevo?')}</h2>
          <p>${t('Se borrará el borrador de este aporte.')}</p>
          <button type="button" class="btn secondary" data-act="record-restart-confirm">${t('Borrar borrador')}</button>
          <form method="dialog"><button class="btn ghost" autofocus>${t('Seguir editando')}</button></form>
        </dialog>` : ''}
      ${content}
      ${state.step > 1 ? `<button class="btn primary record-continue" data-act="next">${t(state.step === 4 ? 'Firmar' : 'Continuar')}</button>` : ''}
      ${state.step === 4 ? `<button class="btn ghost" data-act="record-edit">${t('Editar')}</button>` : ''}
    </div>
  </section>`);
}

function wizard(){const r=state.draft;const first=`<div class="panel"><div class="formgrid"><div class="field"><label for="typ">${t("¿Qué ocurrió?")}</label><select id="typ" data-bind="type"><option value="reunion" ${r.type==='reunion'?'selected':''}>${t("Reunión o conversación")}</option><option value="ayuda" ${r.type==='ayuda'?'selected':''}>${t("Ayuda espontánea")}</option><option value="charla" ${r.type==='charla'?'selected':''}>${t("Charla / evento")}</option><option value="otro" ${r.type==='otro'?'selected':''}>${t("Otra colaboración")}</option></select></div><div class="field"><label for="date">${t("¿Cuándo fue?")}</label>${dateField(r.date)}</div><div class="field span"><label for="title">${t("Dale un nombre al encuentro")}</label><input id="title" data-bind="title" placeholder="${t("Ej. Conversación entre Vespi y ChatterPay")}" value="${esc(r.title)}" maxlength="140"></div><div class="field"><label for="a">${t("Tu nombre visible")}</label><input id="a" data-bind="a" value="${esc(r.a)}" placeholder="${t("Ej. Camila")}" maxlength="80"></div><div class="field"><label for="b">${t("Otra persona")} ${r.type==='charla'?t("(opcional)"):''}</label><input id="b" data-bind="b" value="${esc(r.b)}" placeholder="${r.type==='charla'?t("Puedes dejarlo vacío"):t("Ej. Diego")}" maxlength="80"><div class="help">${r.type==='charla'?t("Si la dejas vacía será un registro personal."):t("Esa persona podrá confirmar o corregir este registro.")}</div></div><div class="field span"><label for="where">${t("¿Dónde ocurrió? (opcional)")}</label><input id="where" data-bind="where" value="${esc(r.where)}" placeholder="${t("Ej. Reunión virtual, Tellus, Santiago")}"></div><div class="field span"><label for="sum">${t("Resumen del encuentro (opcional)")}</label><div class="mobile-composer-field"><textarea id="sum" data-bind="summary" maxlength="1000" placeholder="${t("Qué pasó y qué acordaron")}">${esc(r.summary)}</textarea><div data-voice-slot></div></div></div></div></div>`;
 const contrib=`<p class="contribution-hint">${t("Si ambas personas aportaron, añade un aporte por persona.")}</p>${r.contributions.map((c,i)=>`<div class="cgroup contribution"><div class="ctop"><strong>${t("Aporte")} ${i+1}</strong><button class="btn ghost" data-act="removecontrib" data-id="${esc(c.id)}" ${r.contributions.length===1?'disabled':''}>${t("Quitar")}</button></div><div class="formgrid"><div class="field span"><label for="aporte-origen-${i}">${t("¿Quién hizo este aporte?")}</label><select id="aporte-origen-${i}" data-cid="${esc(c.id)}" data-cfield="from"><option value="a" ${c.from==='a'?'selected':''}>${esc(r.a||t("Persona 1"))}</option>${r.b?`<option value="b" ${c.from==='b'?'selected':''}>${esc(r.b)}</option>`:''}</select></div><div class="field span"><label for="aporte-texto-${i}">${t("¿Qué aportó?")}</label><textarea id="aporte-texto-${i}" data-cid="${esc(c.id)}" data-cfield="text" placeholder="${t("Ej. Presenté a dos personas que podían colaborar.")}">${esc(c.text)}</textarea></div><div class="field span"><label for="aporte-enlace-${i}">${t("Enlace relacionado (opcional)")}</label><input id="aporte-enlace-${i}" data-cid="${esc(c.id)}" data-cfield="url" value="${esc(c.url)}" placeholder="https://..." type="url"><div class="help">${t("Puede ser un repo, artículo, presentación o página de referencia.")}</div></div></div></div>`).join('')}<button class="btn secondary" data-act="addcontrib">${t("+ Añadir otro aporte")}</button>`;
 let review=`<div class="panel stack"><div><span class="eyebrow">${t("El encuentro")}</span><h2 style="margin:8px 0">${esc(r.title||t("Sin título"))}</h2><p>${esc(r.date)} · ${esc(r.where||t("Lugar no especificado"))}</p><p style="margin-top:12px">${esc(r.summary||t("Sin resumen"))}</p></div><div class="divider"></div><div><h3>${esc(r.a||t("Persona 1"))}${r.b?t(" y ")+esc(r.b):''}</h3><p>${r.b?t("Cada persona podrá revisar y confirmar lo acordado."):t("Como no agregaste otra persona, este será un registro personal.")}</p></div>${r.contributions.map(c=>`<div class="inner"><div class="small" style="font-weight:850;color:var(--blue)">${ctLabel(c,r)}</div><div style="margin:8px 0">${esc(c.text||t("Sin descripción"))}</div>${safeLink(c.url)?`<a href="${esc(safeLink(c.url))}" target="_blank" rel="noopener noreferrer">${t("Abrir recurso ↗")}</a>`:c.url?`<span class="warn small">${t("El enlace no es válido (debe comenzar por https://)")}</span>`:''}</div>`).join('')}${!state.sessionName ? `<p data-wizard-signed-out>${t("Inicia sesión para guardar el encuentro.")}</p>` : ''}</div>`;
 review += recipientPicker(r) + mainnetNotice('Con tu firma guardas esta versión del encuentro.');
 const titles=[t("¿Qué ocurrió?"),t("¿Qué aportó cada persona?"),t("Revisar antes de compartir")];
 const voiceArea = `${r.voiceSuggested?`<p class="voice-suggestion">${voiceSuggestion(locale)}</p>`:''}`;
 const login = mainnet && !state.sessionName && state.step === 1
   ? `<button class="btn secondary" data-act="login" data-wizard-signed-out>${t('Iniciar sesión')}</button>` : '';
 wrapper(`<button class="back" data-act="records">← ${t("Mis aportes")}</button><div class="formtitle"><h1 style="font-size:clamp(2.1rem,4vw,3.2rem);margin:8px 0">${titles[state.step-1]}</h1>${state.step===1 && !state.sessionName ? `<p data-wizard-signed-out>${t("Puedes empezar ahora. Vespi te pedirá la passkey al guardar.")}</p>` : ''} </div>${login}<div class="progress"><div class="progressitem ${state.step===1?'on':''}" ${state.step===1?'aria-current="step"':''}>${t("1. Contexto")}</div><div class="progressitem ${state.step===2?'on':''}" ${state.step===2?'aria-current="step"':''}>${t("2. Aportes")}</div><div class="progressitem ${state.step===3?'on':''}" ${state.step===3?'aria-current="step"':''}>${t("3. Compartir")}</div></div>${state.step===1?first:state.step===2?contrib:review}${voiceArea}<div class="bar"><button class="btn secondary" data-act="prev" ${state.step===1?'disabled':''}>${t("← Anterior")}</button><button class="btn primary right" data-act="next">${state.step===3?(r.b ? t("Preparar invitación") : t("Guardar declaración")):t("Continuar →")}</button></div>`)
}
function canReview(record){
  return Boolean(record?.status==='pending'&&state.accountId&&state.accountId!==record.aAccount&&
    (state.accountId===record.bAccount||record.inviteMode==='link'&&state.current===record.id));
}
function detail() {
  if (mainnetErrors[accessProblem]) {
    return wrapper(`<section class="panel stack"><h1>${t(mainnetErrors[accessProblem])}</h1>
      <button class="btn primary" data-act="review-invite">${t('Entrar con otra cuenta')}</button></section>`);
  }
  if (accessProblem === 'loading') {
    return wrapper(`<section class="panel stack"><h1>${t('Abriendo el encuentro…')}</h1></section>`);
  }
  if (accessProblem === 'incomplete' || accessProblem === 'unavailable') {
    const incomplete = accessProblem === 'incomplete';
    const goHome = `<button class="btn ${incomplete ? 'primary' : 'secondary'}" data-act="home">${t('Volver a Inicio')}</button>`;
    const action = incomplete
      ? `<button class="btn secondary" data-act="review-invite">${t('Entrar con otra cuenta')}</button>`
      : `<button class="btn primary" data-act="retry-link">${t('Reintentar')}</button>`;
    return wrapper(`<section class="panel stack invite-recovery">
      <h1>${t(incomplete ? 'Abre el enlace completo o entra con la cuenta invitada' : 'No se pudo abrir el encuentro.')}</h1>
      <div class="actionrow">${incomplete ? goHome + action : action + goHome}</div>
    </section>`);
  }
  if (accessProblem) {
    const wrong = accessProblem === 'wrong-account';
    const newAccount = accessProblem === 'claim-sign-in';
    return wrapper(`<section class="panel stack"><h1>${t(wrong ? 'Esta invitación corresponde a otra cuenta' : mainnet ? 'Entra para ver el encuentro' : 'Tienes una invitación en Vespi')}</h1>
      <p>${t(mainnet ? 'Entra con tu passkey de una cuenta habilitada en Stellar mainnet. El enlace seguirá aquí.' : newAccount ? 'Crea una cuenta o entra para revisar el encuentro.' : 'Entra con la cuenta que participa en el encuentro para verlo.')}</p>
      <div class="actionrow"><button class="btn primary" data-act="review-invite">${t(wrong ? 'Cambiar de cuenta' : 'Iniciar sesión')}</button>
      ${newAccount && !mainnet ? `<button class="btn secondary" data-act="claim-register">${t('Crear cuenta')}</button>` : ''}
      <button class="btn secondary" data-act="home">${t('Inicio')}</button></div></section>`);
  }
  const r = state.records.find(item => item.id === state.current);
  if (!r) return;

  const confirmed = r.status === 'confirmed';
  const finished = confirmed || r.status === 'personal';
  const creator = state.accountId === r.aAccount;
  const reviewer = canReview(r);
  const playConfirmation = confirmedNow === r.id && confirmed;
  confirmedNow = null;
  if (r.visibility === 'public') return publicDetail(r, { creator, reviewer, confirmed, playConfirmation });
  const [, kind] = status(r);
  const lead = reviewer
    ? t('{nombre} te invitó a revisar este encuentro.').replace('{nombre}', () => r.a)
    : t('Registrado por') + ' ' + r.a;

  const contributions = r.contributions.map(c => `<li>
      <h3>${ctLabel(c,r)}</h3><p>${esc(c.text)}</p>
      ${safeLink(c.url) ? `<a href="${esc(safeLink(c.url))}" rel="noopener noreferrer" target="_blank">${t('Ver recurso compartido ↗')}</a>` : ''}
    </li>`).join('');

  const canShare = typeof navigator.share === 'function';
  const invitation = creator && r.b && !r.bAccount && r.inviteMode !== 'link' && r.status === 'pending' ? `<div class="encounter-actions">
    <p>${t('Elige una cuenta para volver a invitar a esta persona.')}</p><button class="btn primary" data-act="reinvite">${t('Elegir a quién invitar')}</button></div>`
    : creator && r.inviteUrl && r.status === 'pending' ? `<div class="encounter-actions">
    <h2>${t('Enlace listo para compartir')}</h2>
    <p>${t('Comparte la invitación con')} <strong>${esc(r.b)}</strong>.</p>
    ${canShare ? `<button class="btn primary" data-act="share-invite">${t('Compartir invitación')}</button>` : ''}
    <button class="btn ${canShare ? 'secondary' : 'primary'}" data-act="invite">${t('Copiar enlace')}</button>
  </div>` : '';
  const reviewActions = reviewer ? `<div class="encounter-actions">
    <button class="btn primary" data-act="sign">${t('Confirmar encuentro')}</button>
    ${mainnetNotice('Si pides un cambio o no reconoces el encuentro, tu respuesta queda firmada.')}
    <button class="btn secondary" data-act="edit">${t('Pedir un cambio')}</button>
    <button class="btn ghost" data-act="decline">${t('No reconozco este encuentro')}</button>
  </div>` : '';
  const proof = finished ? `<details class="technical-details"><summary>${t(mainnet ? 'Verificación en Stellar mainnet' : 'Verificación en Stellar testnet')}</summary>
    <div>
      <span>${esc(t(r.signaturesLabel) || '')}</span>
      ${r.recordHash ? `<span><strong>${t('Hash del registro:')}</strong> ${esc(r.recordHash)}</span>` : ''}
      ${r.transactionHash
        ? `<a href="${contributionNetwork(network).explorer}/tx/${esc(r.transactionHash)}" target="_blank" rel="noopener noreferrer">${t('Ver transacción en Stellar')}</a>`
        : `<span>${t('Huella en Stellar pendiente')}</span>`}
    </div>
  </details>${r.receiptUrl ? `<button class="btn secondary" data-act="share-proof">${t('Compartir constancia')}</button>` : ''}` : '';

  wrapper(`<button type="button" class="back" data-act="records">← ${t('Mis aportes')}</button>
  <article class="encounter-sheet">
    <header class="encounter-heading">
      <p class="encounter-meta"><time datetime="${esc(r.date)}">${esc(encounterDate(r.date))}</time>${r.where ? ' · ' + esc(r.where) : ''}</p>
      <h1>${esc(r.title)}</h1><p>${esc(lead)}</p>
      <p class="encounter-state ${kind}${playConfirmation ? ' just-confirmed' : ''}" role="status" tabindex="-1">${esc(statusText(r))}</p>
    </header>
    ${invitation}
    <div class="encounter-columns">
      <div class="encounter-story">
        ${r.summary ? `<p class="encounter-summary">${esc(r.summary)}</p>` : ''}
        <h2>${t('Aportes compartidos')}</h2><ul class="encounter-contributions">${contributions}</ul>
      </div>
      <aside class="encounter-aside">
        ${reviewActions}
        ${creator && r.status === 'correction' ? `<div class="encounter-actions">
          ${r.note ? `<p>${esc(r.note)}</p>` : ''}
          <button class="btn primary" data-act="revise">${t('Preparar nueva versión')}</button>
        </div>` : ''}
        <h2>${t('Participantes')}</h2>
        <ul class="encounter-signers">
          <li><strong>${esc(r.a)}</strong><span>${r.status === 'personal' ? t('Firmó') : r.confirmations.a ? t('Confirmó') : t('Pendiente')}</span></li>
          ${r.b ? `<li><strong>${esc(r.b)}</strong><span>${r.confirmations.b ? t('Confirmó') : t('Pendiente')}</span></li>` : ''}
        </ul>
        ${r.canAnchor && !r.transactionHash ? mainnetNotice('Tu firma registra la huella en Stellar mainnet.') +
          `<button class="btn secondary" data-act="anchor">${t('Registrar huella en Stellar')}</button>` : ''}
        ${proof}
        ${finished ? `<button class="btn ghost" data-act="copy">${t('Copiar resumen')}</button>` : ''}
      </aside>
    </div>
  </article>`);
}

function publicDetail(r, { creator, reviewer, confirmed, playConfirmation }) {
  const waiting = creator && r.status === 'pending';
  const title = waiting ? statusText(r) : confirmed ? t('Firmado por los dos') : reviewer ? t('Revisa este aporte') :
    r.status === 'declined' ? t('Aporte no reconocido') : statusText(r);
  const canShare = typeof navigator.share === 'function';
  const publicPath = withContributionNetwork('/app/aporte/' + r.id + '?lang=' + locale, network);
  const action = waiting ? `<p>${t('Este aporte aún no es público.')}</p>
    ${r.inviteUrl ? `<div class="record-actions">
      ${canShare ? `<button class="btn primary" data-act="share-invite">${t('Compartir invitación')}</button>` : ''}
      <button class="btn ${canShare ? 'secondary' : 'primary'}" data-act="invite">${t('Copiar enlace')}</button>
    </div>` : ''}` : reviewer ? `${publicConsent()}
    <div class="record-actions">
      <button class="btn primary" data-act="sign">${t('Firmar')}</button>
      <button class="btn secondary" data-act="edit">${t('Pedir un cambio')}</button>
      <button class="btn ghost" data-act="decline">${t('No lo reconozco')}</button>
    </div>` : confirmed ? `<div class="record-actions">
      ${r.canAnchor && !r.transactionHash ? `
        ${mainnet ? `<p class="mobile-mainnet-notice encounter-mainnet-notice">${t('En Stellar queda la huella de las dos firmas. El anclaje en mainnet es permanente.')}</p>` : ''}
        <button class="btn primary" data-act="anchor">${t('Registrar huella en Stellar')}</button>` : ''}
      <a class="btn secondary" href="${esc(publicPath)}">${t('Abrir aporte público')}</a>
      ${r.receiptUrl ? `<button class="btn ghost" data-act="share-proof">${t('Compartir constancia')}</button>` : ''}
    </div>` : creator && r.status === 'correction' ? `
      ${r.note ? `<p dir="auto">${esc(r.note)}</p>` : ''}
      <button class="btn primary" data-act="revise">${t('Preparar nueva versión')}</button>` : '';
  wrapper(`<section class="record-flow" aria-labelledby="record-heading">
    <button type="button" class="back" data-act="records">← ${t('Mis aportes')}</button>
    <div class="panel record-panel">
      <h1 id="record-heading" class="encounter-state${playConfirmation ? ' just-confirmed' : ''}" tabindex="-1">${esc(title)}</h1>
      ${reviewer ? `<p>${esc(t('{nombre} te invitó a revisar este aporte.').replace('{nombre}', () => r.a))}</p>` : ''}
      ${recordReadout(r)}
      ${action}
    </div>
  </section>`);
}

function render(){
  if(state.view==='home')home();
  else if(state.view==='how')how();
  else if(state.view==='wizard'){
    if(state.legacyDraft)wizard();
    else publicWizard(state.draft);
  }
  else if(state.view==='detail')detail();
  else if(state.view==='example')exampleScreen();
}
function persistDraft() {
  if (!state.draft) return;
  if (draftOwner !== (readMobileIdentity()?.account ?? guestDraft)) return;
  saveDraft(encounterDraftKey(state.legacyDraft, draftOwner, state.draft.revisionOf), { ...state.draft, step: state.step });
}
async function shareInvitation(record, share) {
  if (!record.inviteUrl) { notify(t('Aún no hay una invitación disponible.')); return; }
  if (share && typeof navigator.share === 'function') {
    try {
      await navigator.share(mainnet || record.visibility === 'public' ? { url: record.inviteUrl } : { title: record.title, url: record.inviteUrl });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  await copyText(record.inviteUrl);
}

function setMenu(open) {
  root.querySelector('#meridian-menu').hidden = !open;
  root.querySelector('[data-act="menu"]').setAttribute('aria-expanded', String(open));
}
function notify(msg){const old=root.querySelector('.toast');if(old)old.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;el.append(t);setTimeout(()=>t.remove(),3500)}
async function proceed(){
 const r=state.draft;
 const isPublic = r.visibility === 'public';
 if(!isPublic && state.step===1){
  if(!r.title.trim()||!r.date){notify(t("Completa el título y la fecha."));return}
  if(r.type!=='charla'&&!r.b.trim()){notify(t("Agrega el nombre de la otra persona o elige Charla / evento para registro personal."));return}
  if(r.a.trim().toLowerCase()===r.b.trim().toLowerCase()&&r.b){notify(t("Las dos personas deben ser diferentes."));return}
  state.step=2;persistDraft();renderFromTop();return;
 }
 if(state.step===2){
  if(isPublic && !isEncounterDate(r.date)){
    root.querySelector('.record-details').open=true;
    root.querySelector('#date')?.focus();
    notify(t('Elige una fecha válida para el aporte.'));return;
  }
  if(isPublic && hasUnsupportedRecordDetails(r)){
    notify(t('Quita los emojis combinados o caracteres invisibles antes de continuar.'));return;
  }
  if(!r.contributions.length||r.contributions.some(c=>!c.text.trim())){notify(t("Describe todos los aportes antes de continuar."));return}
  if(r.contributions.some(c=>c.url&&!safeLink(c.url))){notify(t("Corrige los enlaces: deben empezar por https:// o http://"));return}
  if(state.sessionName){r.a=state.sessionName;persistDraft()}
  state.step=3;persistDraft();renderFromTop();return;
 }
 if(isPublic && state.step===3 && !r.b.trim()){
   notify(t(r.inviteMode === 'link' ? 'Escribe el nombre de la otra persona.' : 'Busca una cuenta o elige invitar por enlace.'));
   root.querySelector('#recipient-search, #record-recipient-name')?.focus();return;
 }
 if(!isPublic&&!state.sessionName){openDialog('login','publish');return}
 if(r.b && !r.bAccount && r.inviteMode!=='link' && !r.revisionOf){notify(t(mainnet ? 'Elige una cuenta habilitada en mainnet o prepara un enlace privado.' : 'Elige una cuenta o prepara un enlace para alguien sin cuenta.'));root.querySelector('#recipient-search')?.focus();return}
 if(r.bAccount && r.bAccount === state.accountId){notify(t('Elige la cuenta de la otra persona.'));return}
 if(isPublic && state.step===3){
   r.title = deriveRecordTitle(r.contributions[0].text);
   r.summary = '';
   state.step=4;persistDraft();renderFromTop();return;
 }
 if(!state.sessionName){openDialog('login','publish');return}
 const publish=backend.publishEncounter;
 if(typeof publish!=='function'){notify(t("No pudimos guardar el encuentro. Inténtalo de nuevo."));return}
 try{
   const result=await publish(structuredClone(r));
   if(!result?.id||!result?.status){throw new Error('A confirmed server response is required')}
   saveDraft(encounterDraftKey(!isPublic, draftOwner, r.revisionOf));
   state.draft=null;
   show(result);
   if(!isPublic)notify(result.status==='personal'?t("Declaración guardada."):t("Invitación lista para compartir."));
   if(result.canAnchor && !mainnet)await updateAnchor(result.id);
 }catch(error){notify(errorText(error, "No pudimos guardar el encuentro. Inténtalo de nuevo."))}
}
async function copySummary(r){const text=`VESPI · ${r.title}\n${r.date} · ${r.where||t("Sin lugar")}\n${t("Participantes")}:  ${r.a}${r.b?t(" y ")+r.b:''}\n${r.summary}\n${t("Aportes")}: \n${r.contributions.map(c=>'- '+cFrom(r,c)+' → '+cTo(r,c)+': '+c.text+(c.url?' ('+c.url+')':'')).join('\n')}\n${t("Estado")}:  ${status(r)[0]}.`;try{await navigator.clipboard.writeText(text);notify(t("Resumen copiado al portapapeles."))}catch{window.prompt(t('Copia el resumen:'),text)}}
el.addEventListener('input',e=>{if(e.target.id==='date'){updateDraftDate(e.target);return}if(e.target.id==='auth-name')authName=e.target.value;if(state.view!=='wizard')return;const r=state.draft;if(e.target.dataset.bind){clearVoiceSuggestion();r[e.target.dataset.bind]=e.target.value;if(e.target.dataset.bind==='b'){delete r.bAccount;profileSearch=undefined}persistDraft()}if(e.target.dataset.cid){const c=r.contributions.find(x=>x.id===e.target.dataset.cid);if(c){clearVoiceSuggestion();c[e.target.dataset.cfield]=e.target.value;persistDraft()}}});
el.addEventListener('change',e=>{if(e.target.id==='date'){updateDraftDate(e.target);return}if(state.view==='wizard'&&e.target.dataset.bind==='type'){state.draft.type=e.target.value;render()}});
el.addEventListener('submit', event => {
  if (!event.target.matches('[data-network-form]')) return;
  event.preventDefault();
  const next = new FormData(event.target).get('network');
  event.target.closest('dialog').close();
  if (!state.mainnetEligible || state.busy || next === network || !['mainnet', 'testnet'].includes(next)) return;
  const params = new URLSearchParams({ lang: locale });
  const view = { wizard: state.legacyDraft ? 'borrador-encuentro' : 'registro', how: 'como', example: 'ejemplo' }[state.view];
  if (view) params.set('vista', view);
  const theme = new URL(location.href).searchParams.get('theme');
  if (theme) params.set('theme', theme);
  location.assign(withContributionNetwork('/app?' + params, next));
});
el.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;
const act=b.dataset.act;
const pending=['auth-complete','confirm-sign','anchor','edit','decline','find-recipient'].includes(act)||
  (act==='next'&&state.step===(state.legacyDraft?3:4)&&state.sessionName);
const label=b.textContent;
if(pending) {
  if(state.busy)return;
  state.busy=true;
  b.disabled=true;
  b.setAttribute('aria-busy','true');
  b.textContent=t('Procesando…');
}
let r;
try { switch(act){
case'network':{
 const sheet = root.querySelector('[data-network-form]')?.closest('dialog');
 sheet?.querySelector('form')?.reset();
 sheet?.showModal();
 sheet?.querySelector(':checked')?.focus();
 break;
}
case'network-cancel':b.closest('dialog').close();break;
case'menu':setMenu(b.getAttribute('aria-expanded') !== 'true');break;
case'theme':{
 const dark=document.documentElement.dataset.theme==='dark';
 const url=new URL(location.href);
 if(url.searchParams.has('theme')){url.searchParams.delete('theme');history.replaceState(history.state,'',url)}
 setTheme(dark?'light':'dark');
 const label=t(dark?'Cambiar al tema oscuro':'Cambiar al tema claro');
 b.setAttribute('aria-label',label);b.title=label;
 break;
}
case'login':openDialog('login');break;case'register':openDialog('register');break;case'account':openDialog(state.sessionName?'account':'login');break;
case'review-invite':openDialog('login',accessProblem==='claim-sign-in'?'review-link':'review');break;
case'retry-link':if(state.current)await open(state.current,true);break;
case'claim-register':openDialog('register','review-link');break;
case'copy-account':if(state.accountId)await copyText(state.accountId,t('Dirección copiada.'));break;
case'language':
 locale=locale==='es'?'en':'es';
 setLocale(locale);
 render();
 root.querySelector('[data-act="language"]')?.focus();
 break;case'close-modal':closeDialog();break;case'logout':{
 if (state.busy || !window.confirm(t('¿Salir de tu cuenta? Se borrarán los borradores de este navegador.') +
   (hasPendingSubmission(state.accountId) ? '\n\n' + t('Hay un envío pendiente. Si sales, perderás la opción de reintentarlo desde este navegador.') : ''))) break;
 const logout=backend.logout;
 const leavingView = ++openRequest;
 const leavingId = state.current;
 try{
   const leaving=typeof logout==='function'?logout():undefined;
   draftOwner=guestDraft;
   state.accountId=null;state.sessionName=null;state.mainnetEligible=false;state.records=[];state.authModal=null;
   state.draft=null;state.step=1;profileSearch=undefined;sessionProblem=null;
   if(state.view==='wizard')startDraft();
   if(state.view==='detail')accessProblem='sign-in';
   render();
   await leaving;
   if(openRequest!==leavingView || state.accountId || readMobileIdentity())break;
   if(state.view==='detail' && state.current===leavingId && leavingId)await open(leavingId);
   notify(t("Sesión cerrada."));
 }
 catch(error){console.error(error);notify(t("No se pudo cerrar la sesión."))}break;
}
case'auth-complete':{
 const input=root.querySelector('#auth-name');const name=(input?.value||'').trim();
 const mode=state.authModal;
 const version=authVersion;
 if(mode==='register'&&name.length<2){notify(t("Escribe un nombre de al menos dos caracteres."));return}
 const auth=mode==='register'?backend.register:backend.login;
 if(typeof auth!=='function'){notify(t("No se pudo completar el acceso. Inténtalo de nuevo."));return}
 try{
   const account=await (saveMainnetName ? saveMainnetName(name) : auth({displayName:name}));
   if (account?.saveName) {
     if (version !== authVersion) break;
     saveMainnetName=account.saveName;authName='';state.authError=null;render();
     root.querySelector('#auth-name')?.focus();
     break;
   }
   if(!account?.id||!account?.displayName){throw new Error('Verified identity is required')}
   const sameDialog=version===authVersion;
   const continuation=sameDialog?state.afterAuth:null;
   if(draftOwner!==account.id){
     if(draftOwner===guestDraft){
       // What was written before signing in follows the account, unless it already had a draft and prefers that one.
       const revision=state.draft?.revisionOf;
       const own=savedDraft(state.legacyDraft, revision, account.id);
       const written=state.draft&&(state.draft.title||state.draft.summary||state.draft.contributions?.some(c=>c.text));
       if(own&&(!written||!window.confirm(t('Tu cuenta ya tenía un borrador. ¿Reemplazarlo por lo que acabas de escribir?')))){
         state.draft=own;state.step=own.step ?? 1;state.resumedDraft=!state.legacyDraft&&!revision;profileSearch=undefined;
       }
       if(state.draft) {
         saveDraft(encounterDraftKey(state.legacyDraft, draftOwner, revision));
         if(state.draft!==own)saveDraft(encounterDraftKey(state.legacyDraft, account.id, revision),{...state.draft,step:state.step});
       }
     }else {
       draftOwner=account.id;
       if(state.view==='wizard'){
         startDraft(state.legacyDraft, state.draft?.revisionOf);
         if(!state.draft)startDraft();
       }
     }
     draftOwner=account.id;
   }
   sessionProblem=null;
   state.accountId=account.id;state.sessionName=account.displayName;
   state.mainnetEligible=mainnet;
   if(!mainnet)void checkMainnet(account.id);
   if(state.draft&&state.view==='wizard') {state.draft.a=account.displayName;persistDraft()}
   if(sameDialog){state.afterAuth=null;state.authModal=null;authName='';saveMainnetName=undefined;}
   await refreshHistory();
   if(continuation==='publish'||continuation==='voice'){
     render();focusAuthTrigger();
     if(continuation==='voice')root.querySelector('.voice-mic')?.focus();
   }else if(continuation==='sign'){
     if(state.current)await open(state.current);
     if(canReview(state.records.find(item=>item.id===state.current)))openDialog('sign');
   }
   else if(continuation==='correct'||continuation==='decline'){await reviewDecision(continuation)}
   else{if(state.current)await open(state.current);else render();notify(t("Sesión iniciada."));}
 }catch(error){
   if(version!==authVersion)break;
   if (mainnet && (mainnetErrors[error?.message] || saveMainnetName)) {
     state.authError=errorText(error, "No se pudo completar el acceso. Inténtalo de nuevo.");
     render();
     root.querySelector('#auth-name, [data-act="auth-complete"]')?.focus();
   } else notify(errorText(error, "No se pudo completar el acceso. Inténtalo de nuevo."));
 }
 break;
}
case'confirm-sign':{
 r=state.records.find(x=>x.id===state.current);
 const role=state.signActor;
 if(!r||r.confirmations[role])break;
 const sign=backend.signEncounter;
 if(typeof sign!=='function'){notify(t("No se pudo completar la firma. Inténtalo de nuevo."));break}
 try{
   const proof=await sign({recordId:r.id,revision:r.revision,participantRole:role});
   if(proof?.signed!==true||proof?.verified!==true||proof?.revision!==r.revision){throw new Error('Verified signature for this revision required')}
   state.authModal = null; state.signActor = null;
   if (r.status !== 'confirmed' && proof.encounter.status === 'confirmed') confirmedNow = r.id;
   show(proof.encounter);
   if(proof.encounter.canAnchor && !mainnet)await updateAnchor(r.id);
 }catch(error){notify(errorText(error, "No se pudo completar la firma. Inténtalo de nuevo."))}
 break;
}
case'home':go('home');break;
case'records':case'backrecords':
 location.assign(withContributionNetwork('/app?vista=aportes&lang=' + locale, network));break;
case'how':go('how');break;
case'new':startDraft();go('wizard');break;
case'resume-legacy':startDraft(true);if(state.draft)go('wizard');break;
case'record-restart':root.querySelector('.record-restart-dialog')?.showModal();break;
case'record-restart-confirm':
 saveDraft(encounterDraftKey());
 startDraft();go('wizard');break;
case'record-direction':{
 const [primary, secondary] = state.draft.contributions;
 primary.from=b.dataset.id;
 if(secondary)secondary.from=primary.from==='a'?'b':'a';
 state.step=2;persistDraft();renderFromTop();break;
}
case'record-voice':openDialog('login','voice');break;
case'record-edit':state.step=2;persistDraft();renderFromTop();break;
case'record-extra':{
 const contributions=state.draft.contributions;
 contributions.push({id:uid(),from:contributions[0].from==='a'?'b':'a',text:'',url:''});
 persistDraft();render();root.querySelector('#record-extra')?.focus();break;
}
case'record-remove-extra':
 state.draft.contributions.pop();persistDraft();render();
 root.querySelector('.record-details').open=true;root.querySelector('[data-act="record-extra"]')?.focus();break;
case'example':state.exampleStep=1;go('example');break;
case'example-next':if(state.exampleStep<3){state.exampleStep++;renderFromTop()}break;
case'example-prev':if(state.exampleStep>1){state.exampleStep--;renderFromTop()}break;
case'prev':if(state.step>1){state.step--;persistDraft();renderFromTop()}break;
case'next':await proceed();break;
case'change-recipient':delete state.draft.bAccount;delete state.draft.inviteMode;profileSearch=undefined;persistDraft();render();root.querySelector('#recipient-search')?.focus();break;
case'invite-without-account':state.draft.inviteMode='link';delete state.draft.bAccount;persistDraft();render();(root.querySelector('#record-recipient-name') ?? root.querySelector('[data-act="next"]'))?.focus();break;
case'find-recipient':{
 const draft=state.draft;
 const query=root.querySelector('#recipient-search')?.value.trim();
 if(!draft || !query){root.querySelector('#recipient-search')?.focus();break}
 try {
   const profiles=await backend.findProfiles(query);
   if(state.view==='wizard' && state.step===3 && state.draft===draft){
     profileSearch={draft,query,profiles};render();
     (root.querySelector('[data-act="pick-recipient"]') ?? root.querySelector('#recipient-search'))?.focus();
   }
 }catch{notify(t('No pudimos buscar cuentas. Inténtalo de nuevo.'))}
 break;
}
case'pick-recipient':{
 const profile=profileSearch?.profiles?.find(item=>item.account===b.dataset.id);
 if(!profile || profileSearch.draft!==state.draft)break;
 state.draft.b=profile.displayName;state.draft.bAccount=profile.account;persistDraft();render();
 root.querySelector('[data-act="next"]')?.focus();break;
}
case'addcontrib':state.draft.contributions.push({id:uid(),from:state.draft.b?'b':'a',text:'',url:''});persistDraft();render();break;
case'removecontrib':state.draft.contributions=state.draft.contributions.filter(c=>c.id!==b.dataset.id);persistDraft();render();break;
case'open':
 await open(b.dataset.id);break;
case'sign':state.signActor='b';if(!state.sessionName)openDialog('login','sign');else openDialog('sign');break;
case'invite':case'share-invite':
 r = state.records.find(x => x.id === state.current);
 if (r) await shareInvitation(r, act === 'share-invite');
 break;
case'edit':await reviewDecision('correct');break;
case'decline':await reviewDecision('decline');break;
case'revise':
 r=state.records.find(x=>x.id===state.current);if(!r)break;
 startDraft(r.visibility!=='public',r.id);
 if(!state.draft){
   state.draft={...blank(r.type),title:r.title,date:r.date,where:r.where,summary:r.summary,a:r.a,b:r.b,bAccount:r.bAccount,
     contributions:structuredClone(r.contributions),visibility:r.visibility,revisionOf:r.id};
   state.step=state.legacyDraft?1:2;
 }
 persistDraft();go('wizard');break;
case'reinvite':
 r=state.records.find(x=>x.id===state.current);if(!r)break;
 if(savedDraft(true) && !window.confirm(t("¿Empezar otro encuentro y descartar el borrador actual?")))break;
 state.legacyDraft=true;
 state.draft={...blank(r.type),title:r.title,date:r.date,where:r.where,summary:r.summary,a:r.a,b:r.b,contributions:structuredClone(r.contributions)};
 state.step=3;persistDraft();go('wizard');break;
case'anchor':if(state.current)await updateAnchor(state.current);break;
case'share-proof':
 r=state.records.find(x=>x.id===state.current);
 if(r?.receiptUrl) {
   const url=new URL(r.receiptUrl);
   if(locale==='en')url.searchParams.set('lang','en');
   await copyText(url.href);
 }
 break;
case'copy':r=state.records.find(x=>x.id===state.current);if(r)await copySummary(r);break;
}
} finally {
 if(pending){state.busy=false;b.disabled=false;b.removeAttribute('aria-busy');b.textContent=label}
}
});
 root.addEventListener('click',e=>{if(e.target?.dataset?.overlay)closeDialog()});
 root.addEventListener('keydown', e => {
   if (e.key === 'Enter' && ['auth-name','recipient-search'].includes(e.target.id)) {
     e.preventDefault();
     root.querySelector(e.target.id === 'auth-name' ? '[data-act="auth-complete"]' : '[data-act="find-recipient"]')?.click();
   }
   if (state.authModal && e.key === 'Tab') {
     const controls = [...root.querySelectorAll('.auth-card :is(button,input,summary):not(:disabled)')]
       .filter(control => control.getClientRects().length);
     const edge = e.shiftKey ? controls[0] : controls.at(-1);
     if (e.target === edge) {
       e.preventDefault();
       (e.shiftKey ? controls.at(-1) : controls[0])?.focus();
     }
   }
   if (e.key !== 'Escape') return;
   if (state.authModal) {
     closeDialog();
   } else if (!root.querySelector('#meridian-menu')?.hidden) {
     setMenu(false);
     root.querySelector('[data-act="menu"]').focus();
   }
 });

 function scrollToView(view) {
   requestAnimationFrame(() => {
     if (state.view === view) window.scrollTo(0, 0);
   });
 }

 function renderFromTop() {
   render();
   const heading = root.querySelector('h1');
   heading?.setAttribute('tabindex', '-1');
   heading?.focus({ preventScroll: true });
   scrollToView(state.view);
 }

 function go(view) {
   openRequest++;
   accessProblem=null;
   state.view = view; state.current = null;
   backend.navigate(view, undefined, state.legacyDraft, state.draft?.revisionOf);
   renderFromTop();
 }

 function show(record) {
   const wasAccessScreen = Boolean(accessProblem);
   accessProblem=null;
   const sameRecord = state.view === 'detail' && state.current === record.id;
   const confirmedHere = confirmedNow === record.id;
   const status = root.querySelector('.encounter-state');
   const restoreStatusFocus = sameRecord && status && status === root.getRootNode().activeElement;
   state.records = [record, ...state.records.filter(item => item.id !== record.id)];
   state.current = record.id; state.view = 'detail'; backend.navigate('detail', record.id);
   if (wasAccessScreen) renderFromTop();
   else render();
   if (!sameRecord || confirmedHere) scrollToView('detail');
   if (confirmedHere || restoreStatusFocus) root.querySelector('.encounter-state')?.focus({ preventScroll: true });
 }

 async function open(id, openingLink = false) {
   const request = ++openRequest;
   if (openingLink) {
     accessProblem='loading';state.current=id;state.view='detail';render();
   }
   try {
     if (openingLink) {
       await restoreSession;
       if (request !== openRequest) return;
       if (sessionProblem) throw new Error(sessionProblem);
     }
     const record = await backend.read(id);
     if (request === openRequest) show(record);
   } catch (error) {
     if (request !== openRequest) return;
     if (['sign-in','wrong-account','claim-sign-in','incomplete'].includes(error?.message) ||
         mainnet && mainnetErrors[error?.message]) {
       accessProblem=error.message;state.current=id;state.view='detail';backend.navigate('detail',id);renderFromTop();
     } else if (openingLink) {
       accessProblem='unavailable';renderFromTop();
     } else notify(errorText(error, 'No se pudo abrir el encuentro.'));
   }
 }
 async function refreshHistory(){
   if(!state.accountId)return;
   const account=state.accountId;
   try{
     const records=await backend.list(account);
     if(state.accountId===account){state.records=records;if(state.view!=='wizard'&&state.view!=='detail')render();}
   }catch(error){if(state.view==='home')notify(errorText(error, "No se pudieron cargar los encuentros."))}
 }
 async function copyText(text, message=t('Enlace copiado.')){
   try{await navigator.clipboard.writeText(text);notify(message)}catch{window.prompt(t('Copia el enlace:'),text)}
 }
 async function updateAnchor(id) {
   try {
     const record = await backend.anchor(id);
     if (state.view === 'detail' && state.current === id) show(record);
     else state.records = state.records.map(item => item.id === id ? record : item);
   } catch (error) {
     if (state.current === id) notify(errorText(error, "La firma está guardada. Puedes reintentar el anclaje en Stellar."));
   }
 }
 async function reviewDecision(action){
   if(!state.sessionName){openDialog('login',action);return}
   const note=action==='correct'?window.prompt(t('¿Qué hay que corregir?')):window.confirm(t("¿Confirmas que no reconoces este encuentro?"))?'':null;
   if(note===null||(action==='correct'&&!note.trim()))return;
   try{show(await backend.decide(state.current,action,note));notify(t("Respuesta guardada."))}catch(error){notify(errorText(error, "No pudimos guardar tu respuesta."))}
 }
 if (entry.invalidNetwork) {
   wrapper(`<section class="panel stack"><h1>${t('El enlace indica una red de Stellar desconocida.')}</h1>
     <a class="btn secondary" href="/app">${t('Volver a Inicio')}</a></section>`);
   return { update() {}, dispose: stopVoice };
 }
 state.view=entry.view;
 if (state.view === 'wizard') {
   startDraft(entry.legacyDraft, entry.revision);
   if(!state.draft)startDraft();
 }
 const restoreSession = backend.session().catch(error => {
   if (mainnet && mainnetErrors[error?.message]) {
     sessionProblem = error.message;
     if (state.view !== 'detail') render();
   }
   return null;
 }).then(account => {
   if(account && !state.accountId){
     state.accountId=account.id;state.sessionName=account.displayName;
     if(mainnet)state.mainnetEligible=true;
     else void checkMainnet(account.id);
     if (state.view==='wizard') {
       if(!state.legacyDraft && state.draft)state.draft.a=account.displayName;
       if(!state.legacyDraft && state.step===4){render();return}
       refreshNetworkOptions();
       root.querySelector('.session-actions').innerHTML=sessionActions();
       root.querySelector('.sidebar .nav').innerHTML=navigation();
       root.querySelector('#meridian-menu').innerHTML=navigation()+testnetBadge();
       root.querySelectorAll('[data-wizard-signed-out]').forEach(node => node.remove());
       syncVoice();
     } else if(state.view!=='detail'&&!state.authModal)render();
   }
 });
 if(entry.id)void open(entry.id,true);
 else {
   render();
   void restoreSession.then(refreshHistory);
 }
 function update(next){
   if(next.id){void open(next.id,true);return}
   openRequest++;
   accessProblem=null;
   state.current=null;state.view=next.view;
   if(state.view==='wizard') {
     startDraft(next.legacyDraft, next.revision);
     if(!state.draft)startDraft();
   }
   render();scrollToView(next.view);
 };
 const stopAnnouncement = mainnet ? undefined : watchLumaChange(() => { if (state.view === 'home' && root.querySelector('.home-intro')) render(); });
 return { update, dispose() { stopAnnouncement?.(); stopVoice(); } };


}
