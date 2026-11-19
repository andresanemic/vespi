import { english } from './meridian-copy';
import { vespiSocialLinks } from '../AppFooter';

// HTML templates imported from VESPI_FRONTEND_MERIDIAN_AJUSTADO.html.
export function mountMeridian(root, backend, entry, setTheme) {

let locale;
const t = text => locale === 'en' ? english[text] ?? text : text;
const errorText = (error, fallback) => t(Object.hasOwn(english, error?.message) ? error.message : fallback);
function setLocale(language) {
  root.lang = language;
  document.documentElement.lang = language;
  try { localStorage.setItem('vespi-lang', language); } catch {}
}
try { locale = localStorage.getItem('vespi-lang'); } catch {}
locale = locale === 'es' || locale === 'en' ? locale : document.documentElement.lang.startsWith('es') ? 'es' : 'en';
root.lang = locale;
const DRAFT_KEY='vespi-encuentros-borrador-integracion-v1';
let savedDraft=null;try{savedDraft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')}catch{}
let state={view:'home',step:[1,2,3].includes(savedDraft?.step) ? savedDraft.step : 1,exampleStep:1,records:[],draft:savedDraft,current:null,authModal:null,afterAuth:null,signActor:null,sessionName:null};
const today=()=>new Date().toISOString().slice(0,10);
const esc=(s)=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeLink=(s)=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}};
const el=root.querySelector('#app');
const uid=()=>String(Date.now())+Math.random().toString(36).slice(2,7);
function blank(type='reunion'){return{id:uid(),type,title:'',date:today(),where:'',summary:'',a:'',b:'',contributions:[{id:uid(),from:'a',text:'',url:''}],confirmations:{a:false,b:false},status:'draft',revision:1,created:Date.now()}}
function exampleRecord(){return{id:uid(),type:'reunion',title:'Intercambio de ideas entre dos proyectos',date:today(),where:'Reunión virtual',summary:'Compartimos un contacto útil y un recurso para continuar colaborando. Ejemplo ficticio.',a:'Camila',b:'Diego',contributions:[{id:uid(),from:'a',text:'Camila compartió el contacto de una persona que podía orientar el proyecto.',url:''},{id:uid(),from:'b',text:'Diego compartió una herramienta de código abierto para probar.',url:''}],confirmations:{a:false,b:false},status:'draft',revision:1,created:Date.now()}}
function status(r){if(r.status==='correction')return[t("Cambios solicitados"),'pending'];if(r.status==='declined')return[t("Encuentro no reconocido"),'info'];if(r.status==='draft')return[t("Borrador"),''];if(r.b&&r.confirmations.a&&r.confirmations.b)return[t("Confirmado por ambos"),'done'];if(!r.b&&r.confirmations.a)return[t("Declaración personal"),'info'];return[t("Esperando confirmación"),'pending']}
function cname(r,k){return k==='a'?r.a:(r.b||t("Comunidad / evento"))}
function cFrom(r,c){return cname(r,c.from)}
function cTo(r,c){return c.from==='a'?cname(r,'b'):cname(r,'a')}
function ctLabel(c,r){return esc(cFrom(r,c))+' → '+esc(cTo(r,c))}
let recordsScroll = 0;
let openRequest = 0;
let confirmedNow = null;
let authTrigger;
let authName = '';
let profileSearch;
let accessProblem;

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
    state.afterAuth==='publish'?t("Entra para guardar tu encuentro"):state.afterAuth?t("Entra para revisar la invitación"):t("Accede a tu cuenta");
  const r=isSign?state.records.find(x=>x.id===state.current):null;
  const body=isSign&&r?`<div class="auth-body"><p>${t("La confirmación debe corresponder a esta versión exacta del encuentro.")}</p><div class="sign-readout"><strong>${esc(r.title)}</strong><span>${t("Versión")} ${r.revision} · ${r.contributions.length} aporte(s)</span><span>${t("Declara")}: ${esc(state.sessionName||cname(r,state.signActor||'a'))}</span></div><div class="auth-notice">${t("La passkey confirma que tú revisaste esta versión.")} · Stellar testnet</div><button class="btn primary" data-act="confirm-sign">${t("Firmar y confirmar")}</button><button class="btn secondary" data-act="close-modal">${t("Volver sin confirmar")}</button></div>`:
  isAccount?`<div class="auth-body"><p><strong>${esc(state.sessionName)}</strong></p><dl class="profile-address"><dt>${t('Dirección de Stellar')}</dt><dd><code>${esc(state.accountId)}</code></dd></dl><button type="button" class="btn secondary" data-act="copy-account">${t('Copiar dirección')}</button><button class="btn secondary" data-act="logout">${t("Cerrar sesión")}</button></div>`:
  mode==='register'
    ? `<div class="auth-body"><div class="field"><label for="auth-name">${t("Nombre visible")}</label><input id="auth-name" autocomplete="nickname" maxlength="40" value="${esc(authName)}"></div><p>${t("Usarás tu passkey para volver a entrar y firmar.")}</p><button class="btn primary" data-act="auth-complete">${t("Crear cuenta con passkey")}</button><p class="auth-switch">${t("¿Ya tienes cuenta?")} <button type="button" data-act="login">${t("Iniciar sesión")}</button></p></div>`
    : `<div class="auth-body"><button class="btn primary" data-act="auth-complete">${t("Entrar con mi passkey")}</button>${state.afterAuth === 'review' ? '' : `<p class="auth-switch">${t("¿Primera vez en Vespi?")} <button type="button" data-act="register">${t("Crear cuenta")}</button></p>`}<details class="auth-help"><summary>${t("Ayuda para entrar")}</summary><p>${t("Busca la passkey en tu dispositivo o en el gestor donde la guardaste.")}</p></details></div>`;
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
  state.authModal=null;
  state.afterAuth=null;
  render();
  focusAuthTrigger();
 }
 function openDialog(mode,after=null){
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
function wrapper(content, recent = []) {
  const v = state.view;
  const homeActive = ['home', 'wizard', 'example', 'how'].includes(v);
  const recordsActive = ['records', 'detail'].includes(v);
  const brand = className => `<button type="button" class="logo ${className}" data-act="home"
    aria-label="${t('Vespi Contributions, Inicio')}"><small>Contributions</small></button>`;
  const dark = document.documentElement.dataset.theme === 'dark';
  const themeLabel = t(dark ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro');
  const nav = `<button type="button" data-act="home" ${homeActive ? 'class="active" aria-current="page"' : ''}>${t('Inicio')}</button>
    ${state.sessionName ? `<button type="button" data-act="records" ${recordsActive ? 'class="active" aria-current="page"' : ''}>${t('Mis encuentros')}</button>
      <button type="button" data-act="account">${t('Mi cuenta')}</button>` : ''}`;
  const access = `<button type="button" data-act="login">${t('Iniciar sesión')}</button>
    <button type="button" data-act="register">${t('Crear cuenta')}</button>`;
  const network = '<span class="pill"><span class="dot" aria-hidden="true"></span> Stellar testnet</span>';
  el.innerHTML = `<div class="app"${state.authModal ? ' inert' : ''}>
    <aside class="sidebar">${brand('')}
      <nav class="nav" aria-label="${t('Navegación principal')}">${nav}</nav>
      ${recent.length ? recentEncounters(recent, 'rail-recent') : ''}
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="topbar-main">
          ${brand('mobile-brand')}
          <span class="workspace-title">${t(recordsActive ? 'Mis encuentros' : 'Inicio')}</span>
          <div class="topbar-tools">
            <div class="desktop-network">${network}</div>
            <button type="button" class="locale-toggle" data-act="language"
              aria-label="${locale === 'es' ? 'Read in English' : 'Leer en español'}">${locale === 'es' ? 'EN' : 'ES'}</button>
            <button type="button" class="theme-toggle" data-act="theme" aria-label="${themeLabel}" title="${themeLabel}"><span aria-hidden="true"></span></button>
            <div class="session-actions">${state.sessionName
              ? `<button type="button" class="signed-in" data-act="account">${esc(state.sessionName)}</button>` : access}</div>
            <button type="button" class="menu-toggle" data-act="menu" aria-controls="meridian-menu" aria-expanded="false">${t('Menú')}</button>
          </div>
        </div>
        <nav id="meridian-menu" class="mobile-nav" aria-label="${t('Navegación principal')}" hidden>
          ${nav}${state.sessionName ? '' : access}${network}
        </nav>
      </header>
      <div class="content${v==='home'?' app-home':''}">${content}</div>
      <footer class="app-footer">
        <div class="footer-site"><a href="/">${t('Escritorio de Vespi')}</a>
        <a href="${locale === 'es' ? '/contributions/es' : '/contributions'}">${t('¿Qué es Vespi Contributions?')}</a></div>
        <div class="footer-social">${vespiSocialLinks.map(([name, url]) => `<a href="${url}">${name}</a>`).join('')}</div>
      </footer>
    </main>
  </div>${dialogMarkup()}`;
}

function createButton() {
  return `<button class="btn primary" data-act="${state.draft ? 'resume' : 'new'}">
    ${state.draft ? t('Continuar borrador') : t('Nuevo encuentro')}</button>`;
}

function home() {
  const pending = state.records.find(nextAction);
  const priority = pending ? `<section class="home-pending" aria-labelledby="home-pending-title">
    <h2 id="home-pending-title">${t('Me toca actuar')}</h2>${recordRow(pending)}</section>` : '';
  const recent = state.records.filter(record => record.id !== pending?.id).sort((a,b) => b.created - a.created).slice(0, 3);
  wrapper(`${priority}<section class="hero archive-home">
    <div class="home-garden" aria-hidden="true"></div>
    <div class="home-intro">
      <h1>${t('Registra un encuentro')}</h1>
      <p>${t('Cuenta qué pasó en una reunión, una charla o una colaboración y comparte el registro para que lo revisen.')}</p>
      <div class="actionrow">${createButton()}
        ${state.sessionName ? `<button class="btn secondary" data-act="records">${t('Mis encuentros')}</button>`
          : `<button class="btn secondary" data-act="example">${t('Ver ejemplo')}</button>`}
      </div>
      ${state.sessionName ? `<button class="btn ghost home-example" data-act="example">${t('Ver ejemplo')}</button>` : ''}
    </div>
  </section><section class="event-home" aria-labelledby="event-home-title">
    <h2 id="event-home-title">Tellus · 19 ${t('noviembre')}</h2>
    <div class="event-home-links">
      <a class="event-home-talk" href="/app/evento/yerko${locale === 'en' ? '?lang=en' : ''}">
        <span><strong>${t('Charla de Yerko')}</strong><small>${t('Ver la charla y sus diapositivas')}</small></span><span aria-hidden="true">↗</span>
      </a>
      <a class="event-home-survey" href="/app/encuesta${locale === 'en' ? '?lang=en' : ''}">
        <span><strong>${t('Encuesta de Tellus')}</strong><small>${t('Cuéntanos cómo estuvo el evento')}</small></span><span aria-hidden="true">↗</span>
      </a>
    </div>
  </section>${recent.length ? recentEncounters(recent, 'mobile-recent') : ''}`, recent);
}

function recentEncounters(records, place) {
  return `<section class="${place}" aria-labelledby="${place}-title">
    <h2 id="${place}-title">${t('Encuentros recientes')}</h2>
    <div class="stack">${records.map(recordRow).join('')}</div>
  </section>`;
}

function recordRow(record) {
  const action = nextAction(record);
  const [, kind] = status(record);
  return `<button class="archive-record" type="button" data-act="open" data-id="${esc(record.id)}">
    <span class="archive-record-main"><strong>${esc(record.title || t('Sin título'))}</strong>
      <span>${esc(encounterDate(record.date))} · ${esc(record.a)}${record.b ? t(' y ') + esc(record.b) : ''}</span>
    </span>
    <span class="archive-record-state ${kind}">${esc(action || statusText(record))} <span aria-hidden="true">→</span></span>
  </button>`;
}

function records() {
  const groups = { action: [], waiting: [], history: [] };
  const mine = state.accountId
    ? state.records.filter(record => [record.aAccount, record.bAccount].includes(state.accountId)) : [];
  for (const record of mine.sort((a, b) => b.created - a.created)) {
    const section = nextAction(record) ? 'action' : record.status === 'pending' ? 'waiting' : 'history';
    groups[section].push(record);
  }
  const list = [
    [t('Me toca actuar'), groups.action],
    [t('Esperando confirmación'), groups.waiting],
    [t('Historial'), groups.history],
  ].filter(([, items]) => items.length).map(([label, items]) => `<section class="archive-group">
    <h2>${label}</h2><ul>${items.map(record => `<li>${recordRow(record)}</li>`).join('')}</ul>
  </section>`).join('');
  const draft = state.draft ? `<div class="archive-draft">
    <span>${t('Borrador en este navegador')} · <strong>${esc(state.draft.title || t('Sin título'))}</strong></span>
    <button type="button" class="btn ghost" data-act="new">${t('Nuevo encuentro')}</button>
  </div>` : '';
  wrapper(`<div class="sectionhead archive-heading"><h1>${t('Mis encuentros')}</h1>${createButton()}</div>
    ${draft}${list || (state.sessionName
      ? `<p class="archive-empty">${t('Todavía no hay encuentros')}</p>`
      : `<p class="archive-empty">${t('Inicia sesión para ver tus encuentros.')}</p><button class="btn secondary" data-act="login">${t('Iniciar sesión')}</button>`)}`);
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
  if (!r.b || r.revisionOf) return '';
  if (r.inviteMode === 'link') return `<div class="recipient-picker">
    <strong>${t('Invitación para alguien sin cuenta')}</strong>
    <p>${t('Envía el enlace solo a esa persona. La primera cuenta que responda desde el enlace quedará vinculada al encuentro.')}</p>
    <button class="btn secondary" data-act="change-recipient">${t('Buscar una cuenta')}</button>
  </div>`;
  if (r.bAccount) return `<div class="recipient-picker"><strong>${t('Invitarás a')} ${esc(r.b)}</strong>
    <code>${esc(r.bAccount)}</code><button class="btn secondary" data-act="change-recipient">${t('Elegir otra cuenta')}</button></div>`;
  const search = profileSearch?.draft === r ? profileSearch : null;
  return `<div class="recipient-picker">
    <div class="field"><label for="recipient-search">${t('Busca a la persona que va a confirmar')}</label>
      <input id="recipient-search" value="${esc(search?.query ?? r.b)}" maxlength="80" autocomplete="off"></div>
    <button class="btn secondary" data-act="find-recipient">${t('Buscar en Vespi')}</button>
    <button class="btn ghost" data-act="invite-without-account">${t('La otra persona todavía no tiene cuenta')}</button>
    ${search?.profiles?.length ? `<ul>${search.profiles.map(profile => `<li><button class="btn secondary" data-act="pick-recipient" data-id="${esc(profile.account)}">
      <strong>${esc(profile.displayName)}</strong><code>${esc(profile.account)}</code></button></li>`).join('')}</ul>`
      : search?.profiles ? `<p role="status">${t('No encontramos esa cuenta. Prueba con otro nombre o con su dirección de Stellar.')}</p>` : ''}
  </div>`;
}
function wizard(){const r=state.draft;const first=`<div class="panel"><div class="formgrid"><div class="field"><label for="typ">${t("¿Qué ocurrió?")}</label><select id="typ" data-bind="type"><option value="reunion" ${r.type==='reunion'?'selected':''}>${t("Reunión o conversación")}</option><option value="ayuda" ${r.type==='ayuda'?'selected':''}>${t("Ayuda espontánea")}</option><option value="charla" ${r.type==='charla'?'selected':''}>${t("Charla / evento")}</option><option value="otro" ${r.type==='otro'?'selected':''}>${t("Otra colaboración")}</option></select></div><div class="field"><label for="date">${t("¿Cuándo fue?")}</label>${dateField(r.date)}</div><div class="field span"><label for="title">${t("Dale un nombre al encuentro")}</label><input id="title" data-bind="title" placeholder="${t("Ej. Conversación entre Vespi y ChatterPay")}" value="${esc(r.title)}" maxlength="140"></div><div class="field"><label for="a">${t("Tu nombre visible")}</label><input id="a" data-bind="a" value="${esc(r.a)}" placeholder="${t("Ej. Camila")}" maxlength="80"></div><div class="field"><label for="b">${t("Otra persona")} ${r.type==='charla'?t("(opcional)"):''}</label><input id="b" data-bind="b" value="${esc(r.b)}" placeholder="${r.type==='charla'?t("Puedes dejarlo vacío"):t("Ej. Diego")}" maxlength="80"><div class="help">${r.type==='charla'?t("Si la dejas vacía será un registro personal."):t("Esa persona podrá confirmar o corregir este registro.")}</div></div><div class="field span"><label for="where">${t("¿Dónde ocurrió? (opcional)")}</label><input id="where" data-bind="where" value="${esc(r.where)}" placeholder="${t("Ej. Reunión virtual, Tellus, Santiago")}"></div><div class="field span"><label for="sum">${t("Resumen del encuentro (opcional)")}</label><textarea id="sum" data-bind="summary" maxlength="1000" placeholder="${t("Qué pasó y qué acordaron")}">${esc(r.summary)}</textarea></div></div></div>`;
 const contrib=`<p class="contribution-hint">${t("Si ambas personas aportaron, añade un aporte por persona.")}</p>${r.contributions.map((c,i)=>`<div class="cgroup contribution"><div class="ctop"><strong>${t("Aporte")} ${i+1}</strong><button class="btn ghost" data-act="removecontrib" data-id="${esc(c.id)}" ${r.contributions.length===1?'disabled':''}>${t("Quitar")}</button></div><div class="formgrid"><div class="field span"><label for="aporte-origen-${i}">${t("¿Quién hizo este aporte?")}</label><select id="aporte-origen-${i}" data-cid="${esc(c.id)}" data-cfield="from"><option value="a" ${c.from==='a'?'selected':''}>${esc(r.a||t("Persona 1"))}</option>${r.b?`<option value="b" ${c.from==='b'?'selected':''}>${esc(r.b)}</option>`:''}</select></div><div class="field span"><label for="aporte-texto-${i}">${t("¿Qué aportó?")}</label><textarea id="aporte-texto-${i}" data-cid="${esc(c.id)}" data-cfield="text" placeholder="${t("Ej. Presenté a dos personas que podían colaborar.")}">${esc(c.text)}</textarea></div><div class="field span"><label for="aporte-enlace-${i}">${t("Enlace relacionado (opcional)")}</label><input id="aporte-enlace-${i}" data-cid="${esc(c.id)}" data-cfield="url" value="${esc(c.url)}" placeholder="https://..." type="url"><div class="help">${t("Puede ser un repo, artículo, presentación o página de referencia.")}</div></div></div></div>`).join('')}<button class="btn secondary" data-act="addcontrib">${t("+ Añadir otro aporte")}</button>`;
 let review=`<div class="panel stack"><div><span class="eyebrow">${t("El encuentro")}</span><h2 style="margin:8px 0">${esc(r.title||t("Sin título"))}</h2><p>${esc(r.date)} · ${esc(r.where||t("Lugar no especificado"))}</p><p style="margin-top:12px">${esc(r.summary||t("Sin resumen"))}</p></div><div class="divider"></div><div><h3>${esc(r.a||t("Persona 1"))}${r.b?t(" y ")+esc(r.b):''}</h3><p>${r.b?t("Cada persona podrá revisar y confirmar lo acordado."):t("Como no agregaste otra persona, este será un registro personal.")}</p></div>${r.contributions.map(c=>`<div class="inner"><div class="small" style="font-weight:850;color:var(--blue)">${ctLabel(c,r)}</div><div style="margin:8px 0">${esc(c.text||t("Sin descripción"))}</div>${safeLink(c.url)?`<a href="${esc(safeLink(c.url))}" target="_blank" rel="noopener noreferrer">${t("Abrir recurso ↗")}</a>`:c.url?`<span class="warn small">${t("El enlace no es válido (debe comenzar por https://)")}</span>`:''}</div>`).join('')}${!state.sessionName ? `<p>${t("Inicia sesión para guardar el encuentro.")}</p>` : ''}</div>`;
 review += recipientPicker(r);
 const titles=[t("¿Qué ocurrió?"),t("¿Qué aportó cada persona?"),t("Revisar antes de compartir")];
 wrapper(`<button class="back" data-act="records">${t("← Mis encuentros")}</button><div class="formtitle"><h1 style="font-size:clamp(2.1rem,4vw,3.2rem);margin:8px 0">${titles[state.step-1]}</h1>${state.step===1 && !state.sessionName ? `<p>${t("Puedes empezar ahora. Vespi te pedirá la passkey al guardar.")}</p>` : ''} </div><div class="progress"><div class="progressitem ${state.step>=1?'on':''}">${t("1. Contexto")}</div><div class="progressitem ${state.step>=2?'on':''}">${t("2. Aportes")}</div><div class="progressitem ${state.step>=3?'on':''}">${t("3. Compartir")}</div></div>${state.step===1?first:state.step===2?contrib:review}<div class="bar"><button class="btn secondary" data-act="prev" ${state.step===1?'disabled':''}>${t("← Anterior")}</button><button class="btn primary right" data-act="next">${state.step===3?(r.b ? t("Preparar invitación") : t("Guardar declaración")):t("Continuar →")}</button></div>`)
}
function canReview(record){
  return Boolean(record?.status==='pending'&&state.accountId&&state.accountId!==record.aAccount&&
    (state.accountId===record.bAccount||record.inviteMode==='link'&&state.current===record.id));
}
function detail() {
  if (accessProblem) {
    const wrong = accessProblem === 'wrong-account';
    const newAccount = accessProblem === 'claim-sign-in';
    return wrapper(`<section class="panel stack"><h1>${t(wrong ? 'Esta invitación corresponde a otra cuenta' : 'Tienes una invitación en Vespi')}</h1>
      <p>${t(newAccount ? 'Crea una cuenta o entra para revisar el encuentro.' : 'Entra con la cuenta a la que te enviaron la invitación para ver el encuentro.')}</p>
      <div class="actionrow"><button class="btn primary" data-act="review-invite">${t(wrong ? 'Cambiar de cuenta' : 'Iniciar sesión')}</button>
      ${newAccount ? `<button class="btn secondary" data-act="claim-register">${t('Crear cuenta')}</button>` : ''}
      <button class="btn secondary" data-act="home">${t('Inicio')}</button></div></section>`);
  }
  const r = state.records.find(item => item.id === state.current);
  if (!r) { state.view = 'records'; return render(); }

  const confirmed = r.status === 'confirmed';
  const finished = confirmed || r.status === 'personal';
  const creator = state.accountId === r.aAccount;
  const reviewer = canReview(r);
  const playConfirmation = confirmedNow === r.id && confirmed;
  confirmedNow = null;
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
    <button class="btn secondary" data-act="edit">${t('Pedir un cambio')}</button>
    <button class="btn ghost" data-act="decline">${t('No reconozco este encuentro')}</button>
  </div>` : '';
  const proof = finished ? `<details class="technical-details"><summary>${t('Verificación en Stellar testnet')}</summary>
    <div>
      <span>${esc(t(r.signaturesLabel) || '')}</span>
      ${r.recordHash ? `<span><strong>${t('Hash del registro:')}</strong> ${esc(r.recordHash)}</span>` : ''}
      ${r.transactionHash
        ? `<a href="https://stellar.expert/explorer/testnet/tx/${esc(r.transactionHash)}" target="_blank" rel="noopener noreferrer">${t('Ver transacción en Stellar')}</a>`
        : `<span>${t('Huella en Stellar pendiente')}</span>`}
    </div>
  </details>${r.receiptUrl ? `<button class="btn secondary" data-act="share-proof">${t('Compartir constancia')}</button>` : ''}` : '';

  wrapper(`<button type="button" class="back" data-act="records">${t('← Volver a encuentros')}</button>
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
        ${r.canAnchor && !r.transactionHash ? `<button class="btn secondary" data-act="anchor">${t('Registrar huella en Stellar')}</button>` : ''}
        ${proof}
        ${finished ? `<button class="btn ghost" data-act="copy">${t('Copiar resumen')}</button>` : ''}
      </aside>
    </div>
  </article>`);
}
function render(){if(state.view==='home')home();else if(state.view==='records')records();else if(state.view==='how')how();else if(state.view==='wizard')wizard();else if(state.view==='detail')detail();else if(state.view==='example')exampleScreen()}
function persistDraft() {
  if (!state.draft) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state.draft, step: state.step })); } catch {}
}
async function shareInvitation(record, share) {
  if (!record.inviteUrl) { notify(t('Aún no hay una invitación disponible.')); return; }
  if (share && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: record.title, url: record.inviteUrl });
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
 let r=state.draft;
 if(state.step===1){
  if(!r.title.trim()||!r.date){notify(t("Completa el título y la fecha."));return}
  if(r.type!=='charla'&&!r.b.trim()){notify(t("Agrega el nombre de la otra persona o elige Charla / evento para registro personal."));return}
  if(r.a.trim().toLowerCase()===r.b.trim().toLowerCase()&&r.b){notify(t("Las dos personas deben ser diferentes."));return}
  state.step=2;persistDraft();renderFromTop();return;
 }
 if(state.step===2){
  if(!r.contributions.length||r.contributions.some(c=>!c.text.trim())){notify(t("Describe todos los aportes antes de continuar."));return}
  if(r.contributions.some(c=>c.url&&!safeLink(c.url))){notify(t("Corrige los enlaces: deben empezar por https:// o http://"));return}
  if(state.sessionName){r.a=state.sessionName;persistDraft()}
  state.step=3;persistDraft();renderFromTop();return;
 }
 if(!state.sessionName){openDialog('login','publish');return}
 if(r.b && !r.bAccount && r.inviteMode!=='link' && !r.revisionOf){notify(t('Elige una cuenta o prepara un enlace para alguien sin cuenta.'));root.querySelector('#recipient-search')?.focus();return}
 if(r.bAccount === state.accountId){notify(t('Elige la cuenta de la otra persona.'));return}
 const publish=backend.publishEncounter;
 if(typeof publish!=='function'){notify(t("No pudimos guardar el encuentro. Inténtalo de nuevo."));return}
 try{
   const result=await publish(structuredClone(r));
   if(!result?.id||!result?.status){throw new Error('A confirmed server response is required')}
   state.draft=null;
   try{localStorage.removeItem(DRAFT_KEY)}catch{}
   show(result);notify(result.status==='personal'?t("Declaración guardada."):t("Invitación lista para compartir."));
   if(result.canAnchor)await updateAnchor(result.id);
 }catch(error){console.error(error);notify(t("No pudimos guardar el encuentro. Inténtalo de nuevo."))}
}
async function copySummary(r){const text=`VESPI · ${r.title}\n${r.date} · ${r.where||t("Sin lugar")}\n${t("Participantes")}:  ${r.a}${r.b?t(" y ")+r.b:''}\n${r.summary}\n${t("Aportes")}: \n${r.contributions.map(c=>'- '+cFrom(r,c)+' → '+cTo(r,c)+': '+c.text+(c.url?' ('+c.url+')':'')).join('\n')}\n${t("Estado")}:  ${status(r)[0]}.`;try{await navigator.clipboard.writeText(text);notify(t("Resumen copiado al portapapeles."))}catch{window.prompt(t('Copia el resumen:'),text)}}
el.addEventListener('input',e=>{if(e.target.id==='date'){updateDraftDate(e.target);return}if(e.target.id==='auth-name')authName=e.target.value;if(state.view!=='wizard')return;const r=state.draft;if(e.target.dataset.bind){r[e.target.dataset.bind]=e.target.value;if(e.target.dataset.bind==='b'){delete r.bAccount;profileSearch=undefined}persistDraft()}if(e.target.dataset.cid){const c=r.contributions.find(x=>x.id===e.target.dataset.cid);if(c){c[e.target.dataset.cfield]=e.target.value;persistDraft()}}});
el.addEventListener('change',e=>{if(e.target.id==='date'){updateDraftDate(e.target);return}if(state.view==='wizard'&&e.target.dataset.bind==='type'){state.draft.type=e.target.value;render()}});
el.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;
const act=b.dataset.act;
const pending=['auth-complete','confirm-sign','anchor','edit','decline','find-recipient'].includes(act)||(act==='next'&&state.step===3&&state.sessionName);
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
case'claim-register':openDialog('register','review-link');break;
case'copy-account':if(state.accountId)await copyText(state.accountId,t('Dirección copiada.'));break;
case'language':
 locale=locale==='es'?'en':'es';
 setLocale(locale);
 render();
 root.querySelector('[data-act="language"]')?.focus();
 break;case'close-modal':closeDialog();break;case'logout':{
 const logout=backend.logout;
 try{if(typeof logout==='function')await logout();state.accountId=null;state.sessionName=null;state.records=[];state.authModal=null;if(state.current)await open(state.current);else render();notify(t("Sesión cerrada."));}
 catch(error){console.error(error);notify(t("No se pudo cerrar la sesión."))}break;
}
case'auth-complete':{
 const input=root.querySelector('#auth-name');const name=(input?.value||'').trim();
 const mode=state.authModal;
 if(mode==='register'&&name.length<2){notify(t("Escribe un nombre de al menos dos caracteres."));return}
 const auth=mode==='register'?backend.register:backend.login;
 if(typeof auth!=='function'){notify(t("No se pudo completar el acceso. Inténtalo de nuevo."));return}
 try{
   const account=await auth({displayName:name});
   if(!account?.id||!account?.displayName){throw new Error('Verified identity is required')}
   state.accountId=account.id;state.sessionName=account.displayName;
   if(state.draft&&state.afterAuth==='publish') {state.draft.a=account.displayName;persistDraft()}
   await refreshHistory();
   const continuation=state.afterAuth;state.afterAuth=null;state.authModal=null;authName='';
   if(continuation==='publish'){render();focusAuthTrigger();}else if(continuation==='sign'){
     if(state.current)await open(state.current);
     if(canReview(state.records.find(item=>item.id===state.current)))openDialog('sign');
   }
   else if(continuation==='correct'||continuation==='decline'){await reviewDecision(continuation)}
   else{if(state.current)await open(state.current);else render();notify(t("Sesión iniciada."));}
 }catch(error){notify(errorText(error, "No se pudo completar el acceso. Inténtalo de nuevo."))}
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
   if(proof.encounter.canAnchor)await updateAnchor(r.id);
 }catch(error){console.error(error);notify(t("No se pudo completar la firma. Inténtalo de nuevo."))}
 break;
}
case'home':go('home');break;
case'records':case'backrecords':go('records');await refreshHistory();break;
case'how':go('how');break;
case'new':
 if (state.draft && !window.confirm(t('¿Reemplazar el borrador por un encuentro nuevo?'))) break;
 state.draft=blank();state.draft.a=state.sessionName||'';state.step=1;persistDraft();state.view='wizard';renderFromTop();break;
case'resume':if(state.draft){state.view='wizard';renderFromTop()}break;
case'example':state.exampleStep=1;go('example');break;
case'example-next':if(state.exampleStep<3){state.exampleStep++;renderFromTop()}break;
case'example-prev':if(state.exampleStep>1){state.exampleStep--;renderFromTop()}break;
case'prev':if(state.step>1){state.step--;persistDraft();renderFromTop()}break;
case'next':await proceed();break;
case'change-recipient':delete state.draft.bAccount;delete state.draft.inviteMode;profileSearch=undefined;persistDraft();render();root.querySelector('#recipient-search')?.focus();break;
case'invite-without-account':state.draft.inviteMode='link';delete state.draft.bAccount;persistDraft();render();root.querySelector('[data-act="next"]')?.focus();break;
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
 if (state.view === 'records') recordsScroll = window.scrollY;
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
 state.draft={...structuredClone(r),status:'draft',revisionOf:r.id,revision:r.revision+1};
 state.step=1;persistDraft();state.view='wizard';renderFromTop();break;
case'reinvite':
 r=state.records.find(x=>x.id===state.current);if(!r)break;
 if(state.draft && !window.confirm(t("¿Empezar otro encuentro y descartar el borrador actual?")))break;
 state.draft={...blank(r.type),title:r.title,date:r.date,where:r.where,summary:r.summary,a:r.a,b:r.b,contributions:structuredClone(r.contributions)};
 state.step=3;persistDraft();state.view='wizard';renderFromTop();break;
case'anchor':if(state.current)await updateAnchor(state.current);break;
case'share-proof':r=state.records.find(x=>x.id===state.current);if(r?.receiptUrl)await copyText(r.receiptUrl+(locale==='en'?'?lang=en':''));break;
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
     if (state.view === view) window.scrollTo(0, view === 'records' ? recordsScroll : 0);
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
   state.view = view; state.current = null; backend.navigate(view); renderFromTop();
 }

 function show(record) {
   accessProblem=null;
   const sameRecord = state.view === 'detail' && state.current === record.id;
   const confirmedHere = confirmedNow === record.id;
   const restoreStatusFocus = sameRecord && root.querySelector('.encounter-state') === root.getRootNode().activeElement;
   state.records = [record, ...state.records.filter(item => item.id !== record.id)];
   state.current = record.id; state.view = 'detail'; backend.navigate('detail', record.id); render();
   if (!sameRecord || confirmedHere) scrollToView('detail');
   if (confirmedHere || restoreStatusFocus) root.querySelector('.encounter-state')?.focus({ preventScroll: true });
 }

 async function open(id) {
   const request = ++openRequest;
   try {
     const record = await backend.read(id);
     if (request === openRequest) show(record);
   } catch (error) {
     if (request !== openRequest) return;
     if (['sign-in','wrong-account','claim-sign-in'].includes(error?.message)) {
       accessProblem=error.message;state.current=id;state.view='detail';backend.navigate('detail',id);renderFromTop();
     } else notify(errorText(error, 'No se pudo abrir el encuentro.'));
   }
 }
 async function refreshHistory(){
   if(!state.accountId)return;
   const account=state.accountId;
   try{
     const records=await backend.list(account);
     if(state.accountId===account){state.records=records;if(state.view!=='wizard'&&state.view!=='detail')render();}
   }catch(error){if(state.view==='records')notify(errorText(error, "No se pudieron cargar los encuentros."))}
 }
 async function copyText(text, message=t('Enlace copiado.')){
   try{await navigator.clipboard.writeText(text);notify(message)}catch{window.prompt(t('Copia el enlace:'),text)}
 }
 async function updateAnchor(id) {
   try {
     const record = await backend.anchor(id);
     if (state.view === 'detail' && state.current === id) show(record);
     else state.records = state.records.map(item => item.id === id ? record : item);
   } catch {
     if (state.current === id) notify(t("La firma está guardada. Puedes reintentar el anclaje en Stellar."));
   }
 }
 async function reviewDecision(action){
   if(!state.sessionName){openDialog('login',action);return}
   const note=action==='correct'?window.prompt(t('¿Qué hay que corregir?')):window.confirm(t("¿Confirmas que no reconoces este encuentro?"))?'':null;
   if(note===null||(action==='correct'&&!note.trim()))return;
   try{show(await backend.decide(state.current,action,note));notify(t("Respuesta guardada."))}catch(error){notify(errorText(error, "No pudimos guardar tu respuesta."))}
 }
 state.view=entry.view;
 render();
 void (async()=>{
   const account=await backend.session().catch(()=>null);
   if(account){state.accountId=account.id;state.sessionName=account.displayName;render()}
   if(entry.id)await open(entry.id);else await refreshHistory();
 })();
 return function update(next){
   if(next.id){void open(next.id);return}
   openRequest++;
   accessProblem=null;
   state.current=null;state.view=next.view;render();scrollToView(next.view);
   if(next.view==='records')void refreshHistory();
 };


}
