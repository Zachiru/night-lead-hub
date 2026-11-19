// Night Lead Hub user interface. Plain JavaScript, no build step.
import {translator} from './i18n.js';
import {resolveQuestions, checkAnswers, shiftDate, labelFor} from './rules.js';
import {exportReports, formatAnswer, formatTime} from './export.js';
import {createSupabaseApi, ApiError} from './api-supabase.js';
import {createDemoApi} from './api-demo.js';
import {voiceSupported, speak, stopSpeaking} from './voice.js';
import {parseChecklistTable, checklistTable, templateRows, downloadChecklist, readTableFile} from './checklist-io.js';

const cfg = window.NLH_CONFIG || {};
// "?demo" on this computer (localhost only) runs the sample-data demo, for tests; the live site can't be switched.
const localDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('demo');
const api = cfg.supabaseUrl && cfg.supabaseAnonKey && !localDemo ? createSupabaseApi(cfg) : createDemoApi();
const root = document.getElementById('app');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const S = {
  lang: store.get('nlh-lang') || ((navigator.language || '').startsWith('es') ? 'es' : 'en'),
  me: null, tab: null, screen: 'loading', authMode: 'signin', busy: false, flash: null,
  checklist: null, answers: {}, lastAnswers: {}, errors: {}, sent: null, editing: false, token: null, myReports: null,
  people: [], groups: [], questions: [], overrides: [], reports: [], invites: [], newInvite: null,
  filters: null, target: 'everyone', editQ: null, previewOpen: false, tour: null, showSupervisor: false,
  resetInputs: false, // true = next render starts forms fresh instead of keeping typed text
  notes: [], acks: [], comments: [], open: new Set(), loading: false,
  voiceOn: voiceSupported && store.get('nlh-voice') === true, // read the tour and answers out loud
  io: null, ioOpen: false, // checklist import: {items, skipped, fileName} waiting for the supervisor's OK
  join: null, // opened from a shared link: {code} (code is '' for a Night Lead link)
};
// Shared links: "?join" opens the make-an-account form; "?invite=CODE" also fills in a supervisor code.
{
  const qs = new URLSearchParams(location.search);
  if (qs.has('join') || qs.has('invite')) {
    const code = (qs.get('invite') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 40);
    S.join = {code};
    S.authMode = 'signup';
    S.showSupervisor = !!code;
    qs.delete('join'); qs.delete('invite');
    const rest = qs.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }
}
const siteLink = (extra = '') => location.origin + location.pathname + extra;
let t = translator(S.lang);

// ------------------------------------------------------------ voice
const speakerBtn = (act, id = '', label = t('listen')) => voiceSupported
  ? `<button type="button" class="speak" data-act="${act}" ${id ? `data-id="${esc(id)}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">🔊</button>` : '';
function tourStepText() {
  const steps = t(S.me.role === 'rod' ? 'tourRod' : 'tourLead');
  const step = steps[S.tour];
  if (!step) return '';
  return `${step.title}. ${step.text === 'HOME' ? (isIOS() ? t('homeIos') : t('homeAndroid')) : step.text}`;
}
function setVoice(on) {
  S.voiceOn = on; store.set('nlh-voice', on);
  if (!on) stopSpeaking();
}

// ------------------------------------------------------------ helpers
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const roleName = r => r === 'rod' ? t('roleRod') : t('roleNightLead');
const fmtDate = d => new Intl.DateTimeFormat(S.lang === 'es' ? 'es-US' : 'en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(d + 'T00:00:00Z'));
const fmtClock = iso => new Intl.DateTimeFormat(S.lang === 'es' ? 'es-US' : 'en-US', {timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit'}).format(new Date(iso));
const draftKey = () => S.me && S.checklist ? `nlh-draft-${S.me.id}-${S.checklist.shift_date}` : null;

function errorText(e) {
  if (e && e.code === 'changed') return t('checklistChanged');
  const code = e instanceof ApiError ? e.code : (e && e.code) || 'unknown';
  const map = {network: 'errorNetwork', not_allowed: 'errorNotAllowed', bad_login: 'badLogin', email_not_confirmed: 'emailNotConfirmed',
    already_registered: 'alreadyRegistered', weak_password: 'weakPassword', rate_limited: 'rateLimited', last_supervisor: 'lastSupervisor',
    demo_only: 'demoOnly', duplicate_name: 'duplicateName', file_too_big: 'fileTooBig', file_unreadable: 'fileUnreadable'};
  if (code === 'unknown' && /duplicate key|unique/i.test(e?.message || '')) return t('duplicateName');
  if (code === 'unknown' && !navigator.onLine) return t('errorNetwork');
  return t(map[code] || 'errorGeneric');
}
function flash(text, kind = 'ok') { S.flash = {text, kind}; render(); }
async function run(fn) {
  if (S.busy) return;
  S.busy = true; S.flash = null; render();
  try { await fn(); S.resetInputs = true; } catch (e) { console.error(e); S.flash = {text: errorText(e), kind: 'err'}; }
  finally { S.busy = false; render(); }
}
function setLang(lang) {
  S.lang = lang; t = translator(lang); store.set('nlh-lang', lang);
  document.documentElement.lang = lang;
  if (S.me && S.me.locale !== lang) { S.me.locale = lang; api.updateMe({locale: lang}).catch(() => {}); }
  render();
  if (S.tour !== null && S.screen === 'app') { if (S.voiceOn) speak(tourStepText(), lang); else stopSpeaking(); }
}

// ------------------------------------------------------------ data loading
async function loadSession() {
  const has = await api.hasSession();
  if (!has) { S.me = null; S.screen = 'auth'; render(); return; }
  try {
    S.me = await api.getMe();
  } catch (e) {
    S.me = null; S.screen = 'auth'; S.flash = {text: errorText(e), kind: 'err'}; render(); return;
  }
  if (S.screen === 'recovery') return;
  if (!S.me.enabled) {
    await api.signOut(); S.me = null; S.screen = 'auth'; S.flash = {text: t('errorNotAllowed'), kind: 'err'}; render(); return;
  }
  if (S.me.locale && S.me.locale !== S.lang) { S.lang = S.me.locale; t = translator(S.lang); store.set('nlh-lang', S.lang); document.documentElement.lang = S.lang; }
  if (store.get('nlh-pending-invite') && S.me.role !== 'rod') S.flash = {text: t('inviteInvalidNotice'), kind: 'warn'};
  store.del('nlh-pending-invite');
  S.screen = 'app';
  S.tab = S.me.role === 'rod' ? 'reports' : 'today';
  history.replaceState({tab: S.tab}, '');
  if (!S.me.tutorial_done) S.tour = 0;
  await loadTab();
}

// Night Lead's supervisor notes and report comments (used for the badges on the tabs).
async function loadInbox() {
  if (!S.me || S.me.role === 'rod') return;
  [S.notes, S.acks, S.comments] = await Promise.all([api.listNotes(), api.listAcks(), api.listMyComments()]);
}
const unackedNotes = () => S.notes.filter(n => !S.acks.some(a => a.note_id === n.id && a.user_id === S.me.id));
const unreadForMe = c => S.me.role === 'rod' ? (c.author_id === c.lead_id && !c.read_by_rod_at) : (c.author_id !== S.me.id && !c.read_by_lead_at);

async function loadTab() {
  S.loading = true;
  render();
  try {
    if (S.tab === 'today') { await loadChecklist(); await loadInbox(); }
    else if (S.tab === 'history') { S.myReports = await api.myReports(); await loadInbox(); }
    else if (S.tab === 'notes') await loadNotes();
    else if (S.tab === 'reports') await loadReports();
    else if (S.tab === 'checklists') await loadBuilder();
    else if (S.tab === 'team') await loadTeam();
  } catch (e) { console.error(e); S.flash = {text: errorText(e), kind: 'err'}; }
  S.loading = false;
  render();
}

async function loadChecklist() {
  S.checklist = await api.myChecklist();
  const ids = new Set(S.checklist.questions.map(q => q.id));
  const draft = store.get(draftKey()) || {};
  S.answers = Object.fromEntries(Object.entries(draft).filter(([k]) => ids.has(k)));
  // What was sent last time, so "Change and send again" starts from those answers instead of a blank form.
  S.lastAnswers = Object.fromEntries((S.checklist.latest?.questions || [])
    .filter(q => ids.has(q.id) && q.answer !== null && q.answer !== undefined && q.answer !== '').map(q => [q.id, q.answer]));
  S.errors = {};
  S.editing = false;
  S.sent = S.checklist.latest ? {submitted_at: S.checklist.latest.submitted_at, revision: S.checklist.latest.revision, shift_date: S.checklist.latest.shift_date} : null;
  if (Object.keys(S.answers).length && S.sent) S.editing = true;
}

async function loadReports() {
  if (!S.filters) { const d = shiftDate(); S.filters = {from: d, to: d, group: '', person: '', issues: false}; }
  [S.people, S.groups, S.reports] = await Promise.all([api.listPeople(), api.listGroups(), api.listReports(S.filters)]);
  S.comments = await api.listComments(S.reports.map(r => r.id));
}
async function loadNotes() {
  [S.people, S.groups, S.notes, S.acks] = await Promise.all([api.listPeople(), api.listGroups(), api.listNotes(), api.listAcks()]);
}
const daysBefore = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
async function loadBuilder() {
  [S.people, S.groups, S.questions, S.overrides] = await Promise.all([api.listPeople(), api.listGroups(), api.listQuestions(), api.listOverrides()]);
}
async function loadTeam() {
  [S.people, S.groups, S.invites] = await Promise.all([api.listPeople(), api.listGroups(), api.listInvites()]);
}

// ------------------------------------------------------------ views: shell
function render() {
  document.title = t('appName');
  let html = '';
  if (api.mode === 'demo') html += `<div class="demo-banner" role="note">${esc(t('demoBanner'))}</div>`;
  if (S.screen === 'loading') html += `<main class="center"><p>${esc(t('loading'))}</p></main>`;
  else if (S.screen === 'recovery') html += viewRecovery();
  else if (S.screen === 'auth') html += viewAuth();
  else html += viewApp();
  if (S.tour !== null && S.screen === 'app') html += viewTour();
  const active = document.activeElement;
  const keep = active && active.id ? {id: active.id, start: active.selectionStart, end: active.selectionEnd} : null;
  // Re-rendering replaces the page, so keep whatever was typed (except passwords) unless a fresh form is wanted.
  const typed = {};
  if (!S.resetInputs) {
    for (const el of root.querySelectorAll('input[id], textarea[id], select[id]')) {
      if (el.type === 'password' || el.type === 'radio' || el.type === 'file' || el.readOnly) continue;
      typed[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    }
  }
  S.resetInputs = false;
  root.innerHTML = html;
  for (const [id, v] of Object.entries(typed)) {
    const el = document.getElementById(id);
    if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; }
  }
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { if (keep.start !== null && keep.start !== undefined) el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ } }
  }
}

function flashBox() {
  if (!S.flash) return '<div class="flash-slot" aria-live="polite"></div>';
  return `<div class="flash-slot" aria-live="polite"><div class="flash ${S.flash.kind}" role="${S.flash.kind === 'err' ? 'alert' : 'status'}">${esc(S.flash.text)}</div></div>`;
}

function langSwitch() {
  return `<div class="lang" role="group" aria-label="${esc(t('language'))}">
    <button type="button" data-act="lang" data-v="en" aria-pressed="${S.lang === 'en'}">EN</button>
    <button type="button" data-act="lang" data-v="es" aria-pressed="${S.lang === 'es'}">ES</button></div>`;
}

// ------------------------------------------------------------ views: auth
function viewAuth() {
  const m = S.authMode;
  let body = '';
  if (api.mode === 'demo') {
    body = `<h2>${esc(t('demoPick'))}</h2><div class="stack">
      ${api.demoAccounts().map(a => `<button class="btn big" data-act="demo-login" data-id="${esc(a.id)}">${esc(a.name)} <span class="chip">${esc(roleName(a.role))}</span></button>`).join('')}
      </div><h2>${esc(t('demoNew'))}</h2>
      <form data-form="signup" class="stack" novalidate>
        <label>${esc(t('name'))}<input id="su-name" name="name" required maxlength="80" autocomplete="name"></label>
        ${supervisorField()}
        <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('signUp'))}</button>
      </form>`;
  } else if (m === 'signin') {
    body = `<form data-form="signin" class="stack" novalidate>
        <label>${esc(t('email'))}<input id="si-email" name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label>${esc(t('password'))}<input id="si-pass" name="password" type="password" required autocomplete="current-password"></label>
        ${showPassBox()}
        <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('signIn'))}</button>
      </form>
      <p><button class="link" data-act="auth-mode" data-v="forgot">${esc(t('forgotPassword'))}</button></p>
      <div class="first-time"><p>${esc(t('noAccount'))}</p>
        <button class="btn big" data-act="auth-mode" data-v="signup">${esc(t('firstTimeButton'))}</button></div>`;
  } else if (m === 'signup') {
    body = `<form data-form="signup" class="stack" novalidate>
        <label>${esc(t('name'))}<input id="su-name" name="name" required maxlength="80" autocomplete="name"></label>
        <label>${esc(t('email'))}<input id="su-email" name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label>${esc(t('password'))}<input id="su-pass" name="password" type="password" required minlength="8" autocomplete="new-password" aria-describedby="pw-hint"></label>
        <p id="pw-hint" class="hint">${esc(t('passwordHint'))}</p>
        ${showPassBox()}
        ${supervisorField()}
        <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('signUp'))}</button>
      </form>
      <p>${esc(t('haveAccount'))} <button class="link" data-act="auth-mode" data-v="signin">${esc(t('signIn'))}</button></p>`;
  } else if (m === 'forgot') {
    body = `<form data-form="forgot" class="stack" novalidate>
        <label>${esc(t('email'))}<input id="fp-email" name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('sendResetLink'))}</button>
      </form>
      <p><button class="link" data-act="auth-mode" data-v="signin">${esc(t('back'))}</button></p>`;
  } else if (m === 'check-email') {
    body = `<p class="flash ok">${esc(t('checkEmail'))}</p><p><button class="btn big" data-act="auth-mode" data-v="signin">${esc(t('signIn'))}</button></p>`;
  }
  const welcome = S.join && (m === 'signup' || api.mode === 'demo') ? `<p class="status how">${esc(S.join.code ? t('joinSupervisor') : t('joinWelcome'))}</p>` : '';
  return `<main class="auth"><header class="auth-head"><h1>${esc(t('appName'))}</h1>${langSwitch()}</header>
    ${flashBox()}${welcome}<section class="card">${m === 'signup' || api.mode === 'demo' ? '' : `<h2>${esc(m === 'forgot' ? t('forgotPassword') : t('signIn'))}</h2>`}${body}</section></main>`;
}

// Lets people see what they typed, so a typo in the password isn't a mystery.
function showPassBox() {
  return `<label class="check"><input type="checkbox" data-act="show-pass"> ${esc(t('showPassword'))}</label>`;
}

function supervisorField() {
  return `<label class="check"><input type="checkbox" id="su-is-rod" data-act="toggle-supervisor" ${S.showSupervisor ? 'checked' : ''}> ${esc(t('supervisorQ'))}</label>
    ${S.showSupervisor ? `<label>${esc(t('inviteCode'))}<input id="su-code" name="code" autocomplete="off" autocapitalize="characters" aria-describedby="code-hint" value="${esc(S.join?.code || '')}"></label>
    <p id="code-hint" class="hint">${esc(t('inviteHelp'))}</p>` : ''}`;
}

function viewRecovery() {
  return `<main class="auth"><header class="auth-head"><h1>${esc(t('appName'))}</h1>${langSwitch()}</header>${flashBox()}
    <section class="card"><h2>${esc(t('setNewPassword'))}</h2>
    <form data-form="new-password" class="stack" novalidate>
      <label>${esc(t('newPassword'))}<input id="np-pass" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <p class="hint">${esc(t('passwordHint'))}</p>
      ${showPassBox()}
      <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('save'))}</button>
    </form></section></main>`;
}

// ------------------------------------------------------------ views: app shell
function viewApp() {
  const rod = S.me.role === 'rod';
  const unreadReplies = rod ? 0 : S.comments.filter(unreadForMe).length;
  const tabs = rod ? [['reports', t('tabReports')], ['notes', t('tabNotes')], ['checklists', t('tabChecklists')], ['team', t('tabTeam')], ['help', t('help')]]
                   : [['today', t('tabToday'), unackedNotes().length], ['history', t('tabHistory'), unreadReplies], ['help', t('help')]];
  let main = '';
  if (S.loading) main = `<p aria-busy="true">${esc(t('loading'))}</p>`;
  else if (S.tab === 'today') main = viewToday();
  else if (S.tab === 'history') main = viewHistory();
  else if (S.tab === 'reports') main = viewReports();
  else if (S.tab === 'checklists') main = viewBuilder();
  else if (S.tab === 'team') main = viewTeam();
  else if (S.tab === 'notes') main = viewNotes();
  else main = viewHelp();
  return `<header class="top"><div><strong>${esc(t('appName'))}</strong><span class="who">${esc(S.me.display_name)} · ${esc(roleName(S.me.role))}</span></div>${langSwitch()}</header>
    <nav class="tabs" aria-label="Main">${tabs.map(([k, label, n]) => `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${esc(label)}${n ? ` <span class="badge" aria-label="${n} new">${n}</span>` : ''}</button>`).join('')}</nav>
    <main class="content">${flashBox()}${main}</main>`;
}

// ------------------------------------------------------------ Night Lead: today
function questionField(q, {answer, error, disabled = false, prefix = 'q'}) {
  const lab = labelFor(q, S.lang);
  const name = `${prefix}-${q.id}`;
  const icons = {true: '✓', false: '✗', done: '✓', needs_attention: '⚠'};
  const opt = (value, text) => {
    const checked = answer === value;
    const icon = icons[String(value)] ? `<span class="ico" aria-hidden="true">${icons[String(value)]}</span>` : '';
    return `<label class="choice ${checked ? 'on' : ''} v-${esc(String(value))}"><input type="radio" name="${esc(name)}" value="${esc(String(value))}" data-q="${esc(q.id)}" data-kind="${q.type}" aria-label="${esc(text)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${icon}<span>${esc(text)}</span></label>`;
  };
  let input = '';
  if (q.type === 'checkbox') input = opt(true, t('completed')) + opt(false, t('notCompleted'));
  else if (q.type === 'yes_no') input = opt('yes', t('yes')) + opt('no', t('no')) + (q.allow_na ? opt('not_applicable', t('naChoice')) : '');
  else if (q.type === 'status') input = opt('done', t('done')) + opt('needs_attention', t('needsAttention')) + (q.allow_na ? opt('not_applicable', t('naChoice')) : '');
  else input = `<textarea id="${esc(name)}" data-q="${esc(q.id)}" data-kind="text" maxlength="3000" rows="2" placeholder="${esc(t('typeHere'))}" ${disabled ? 'disabled' : ''} aria-labelledby="${esc(name)}-t">${esc(answer ?? '')}</textarea>`;
  const errId = `${name}-err`;
  return `<fieldset class="q ${error ? 'has-error' : ''}" id="${esc(name)}-box" ${error ? `aria-describedby="${esc(errId)}"` : ''}>
    <legend id="${esc(name)}-l"><span class="qlabel"><span id="${esc(name)}-t">${esc(lab.text)}</span>${lab.fallback ? ` <span class="fallback">${esc(t('englishOnly'))}</span>` : ''}${q.required ? '' : ` <span class="req">${esc(t('optional'))}</span>`}</span>${disabled ? '' : speakerBtn('speak-q', q.id, t('listenQuestion'))}</legend>
    <div class="choices ${q.type === 'text' ? 'text' : ''}">${input}</div>
    ${error ? `<p class="err" id="${esc(errId)}">${esc(error === 'required' ? t('errRequired') : t('errInvalid'))}</p>` : ''}
  </fieldset>`;
}

function viewToday() {
  const c = S.checklist;
  if (!c) return `<p>${esc(t('loading'))}</p>`;
  const hasDraft = Object.keys(S.answers).length > 0;
  const head = `<h1>${esc(t('shiftOf', {date: fmtDate(c.shift_date)}))}</h1>${viewLeadNotes()}`;
  if (S.sent && !S.editing) {
    return `${head}<section class="card sent" role="status"><h2>${esc(t('sentTitle'))}</h2>
      <p>${esc(t('sentBody', {time: fmtClock(S.sent.submitted_at), date: fmtDate(S.sent.shift_date)}))}</p>
      ${S.sent.revision > 1 ? `<p class="chip">${esc(t('update', {n: S.sent.revision}))}</p>` : ''}
      <button class="btn big" data-act="edit-again">${esc(t('editResend'))}</button></section>`;
  }
  if (!c.questions.length) return `${head}<p class="card">${esc(t('noQuestions'))}</p>`;
  const status = S.sent && S.editing ? `<p class="status how">${esc(t('editingHint'))}</p>
      <p><button type="button" class="btn" data-act="cancel-edit">${esc(t('keepSent'))}</button></p>`
    : hasDraft ? `<p class="status draft">${esc(t('statusDraft'))}</p>` : (S.sent ? `<p class="status">${esc(t('statusSent', {time: fmtClock(S.sent.submitted_at)}))}</p>` : `<p class="status how">${esc(t('howToFill'))}</p>`);
  const errCount = Object.keys(S.errors).length;
  return `${head}${status}
    <form data-form="report" novalidate>
      ${errCount ? `<p class="flash err" role="alert">${esc(t('fixErrors'))}</p>` : ''}
      ${c.questions.map(q => questionField(q, {answer: S.answers[q.id], error: S.errors[q.id]})).join('')}
      <div class="sticky-submit"><p class="progress" aria-live="polite">${esc(t('progress', {n: c.questions.filter(q => S.answers[q.id] !== undefined && S.answers[q.id] !== '').length, m: c.questions.length}))}</p>
      <button class="btn primary big" id="send-report" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(S.busy ? t('sending') : t('submit'))}</button></div>
    </form>`;
}

function viewComment(c) {
  const who = c.author_id === S.me.id ? t('youWord') : (c.author_name || t('supervisorWord'));
  const mine = c.author_id === S.me.id;
  return `<div class="comment ${mine ? 'mine' : ''} ${c.author_id === c.lead_id ? 'from-lead' : 'from-rod'}">
    <p class="meta">${esc(t('fromName', {name: who, date: formatTime(c.created_at, S.lang)}))}${unreadForMe(c) ? ` <span class="badge">${esc(t('newNote'))}</span>` : ''}</p>
    <p>${esc(c.body)}</p></div>`;
}

function viewSnapshot(r) {
  const comments = S.comments.filter(c => c.submission_id === r.id);
  const lead = S.me.role === 'rod' ? S.people.find(p => p.id === r.lead_id) : S.me;
  const general = comments.filter(c => !c.question_id);
  return `<ul class="answers">${r.questions.map(q => {
    const lab = labelFor(q, S.lang);
    const a = formatAnswer(q, t);
    const bad = q.answer === false || q.answer === 'needs_attention' || q.answer === 'no';
    const qc = comments.filter(c => c.question_id === q.id);
    return `<li><div class="ans"><span>${esc(lab.text)}</span><strong class="${bad ? 'warn' : ''}">${esc(a || '—')}</strong></div>${qc.map(viewComment).join('')}</li>`;
  }).join('')}</ul>
  ${general.length ? `<h3>${esc(t('commentsTitle'))}</h3>${general.map(viewComment).join('')}` : ''}
  <form data-form="comment" class="stack comment-form" data-sub="${esc(r.id)}">
    ${S.me.role === 'rod' ? `<label>${esc(t('commentAbout'))}<select name="question" id="cq-${esc(r.id)}"><option value="">${esc(t('wholeReport'))}</option>
      ${r.questions.map(q => `<option value="${esc(q.id)}">${esc(labelFor(q, S.lang).text)}</option>`).join('')}</select></label>` : ''}
    <label>${esc(S.me.role === 'rod' ? t('addComment', {name: lead?.display_name || '?'}) : t('writeReply'))}
      <textarea name="body" id="cb-${esc(r.id)}" rows="2" maxlength="1000"></textarea></label>
    <button class="btn">${esc(S.me.role === 'rod' ? t('sendComment') : t('sendReply'))}</button>
  </form>`;
}

function viewLeadNotes() {
  if (!S.notes.length) return '';
  return `<section class="notes" aria-label="${esc(t('notesTitle'))}"><h2>${esc(t('notesTitle'))}</h2>${S.notes.map(n => {
    const acked = S.acks.some(a => a.note_id === n.id && a.user_id === S.me.id);
    return `<div class="card note ${acked ? 'acked' : ''}"><p class="note-body">${esc(n.body)}</p>
      <p class="meta">${esc(t('fromName', {name: n.created_by_name || t('supervisorWord'), date: formatTime(n.created_at, S.lang)}))}</p>
      ${acked ? `<p class="done-mark">${esc(t('youRead'))}</p>` : `<button class="btn primary" data-act="ack" data-id="${esc(n.id)}">${esc(t('gotIt'))}</button>`}</div>`;
  }).join('')}</section>`;
}

function viewHistory() {
  if (!S.myReports) return `<p>${esc(t('loading'))}</p>`;
  if (!S.myReports.length) return `<h1>${esc(t('tabHistory'))}</h1><p class="card">${esc(t('noReports'))}</p>`;
  return `<h1>${esc(t('tabHistory'))}</h1><p class="hint">${esc(t('historyHint'))}</p>${S.myReports.map(r => {
    const unread = S.comments.filter(c => c.submission_id === r.id && unreadForMe(c)).length;
    return `<details class="card report" data-sub="${esc(r.id)}" ${S.open.has(r.id) ? 'open' : ''}><summary>
    <strong>${esc(fmtDate(r.shift_date))}</strong> · ${esc(t('statusSent', {time: fmtClock(r.submitted_at)}))}
    ${r.revision > 1 ? `<span class="chip">${esc(t('update', {n: r.revision}))}</span>` : ''}
    ${unread ? `<span class="badge">${esc(t('newNote'))}</span>` : ''}</summary>${viewSnapshot(r)}</details>`;
  }).join('')}`;
}

// ------------------------------------------------------------ Supervisor: reports
function latestOnly(reports) {
  const best = new Map();
  for (const r of reports) {
    const k = r.lead_id + '|' + r.shift_date;
    if (!best.has(k) || best.get(k).revision < r.revision) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => b.shift_date.localeCompare(a.shift_date) || a.submitted_at.localeCompare(b.submitted_at));
}

function filteredReports() {
  const f = S.filters;
  const person = id => S.people.find(p => p.id === id);
  return latestOnly(S.reports).filter(r => {
    const p = person(r.lead_id);
    if (f.person && r.lead_id !== f.person) return false;
    if (f.group && (p?.group_id || '') !== (f.group === 'none' ? '' : f.group)) return false;
    if (f.issues && !(r.needs_attention > 0 || r.not_completed > 0)) return false;
    return true;
  });
}

function groupOptions(selected, {withAll = true, withNone = true} = {}) {
  return (withAll ? `<option value="">${esc(t('all'))}</option>` : '')
    + S.groups.map(g => `<option value="${esc(g.id)}" ${selected === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')
    + (withNone ? `<option value="none" ${selected === 'none' ? 'selected' : ''}>${esc(t('noGroup'))}</option>` : '');
}

function viewReports() {
  if (!S.filters) return `<p>${esc(t('loading'))}</p>`;
  const f = S.filters;
  const leads = S.people.filter(p => p.role === 'night_lead' && p.enabled);
  const rows = filteredReports();
  const groupName = id => S.groups.find(g => g.id === id)?.name || t('noGroup');
  let summary = '';
  if (f.from === f.to) {
    const inScope = leads.filter(p => (!f.group || (p.group_id || '') === (f.group === 'none' ? '' : f.group)) && (!f.person || p.id === f.person));
    const sentIds = new Set(latestOnly(S.reports).filter(r => r.shift_date === f.to).map(r => r.lead_id));
    const missing = inScope.filter(p => !sentIds.has(p.id));
    summary = `<section class="card"><p><strong>${esc(t('submittedCount', {n: inScope.length - missing.length, m: inScope.length, date: fmtDate(f.to)}))}</strong></p>
      ${missing.length ? `<p>${esc(t('missing'))} ${missing.map(p => esc(p.display_name)).join(', ')}</p>` : ''}</section>`;
  }
  return `<h1>${esc(t('tabReports'))}</h1>
    <div class="row ranges"><button class="btn sm" data-act="range" data-v="0">${esc(t('rangeToday'))}</button>
      <button class="btn sm" data-act="range" data-v="6">${esc(t('range7'))}</button>
      <button class="btn sm" data-act="range" data-v="29">${esc(t('range30'))}</button></div>
    <form data-form="filters" class="filters card">
      <label>${esc(t('from'))}<input type="date" name="from" id="f-from" value="${esc(f.from)}" required></label>
      <label>${esc(t('to'))}<input type="date" name="to" id="f-to" value="${esc(f.to)}" required></label>
      <label>${esc(t('group'))}<select name="group" id="f-group">${groupOptions(f.group)}</select></label>
      <label>${esc(t('person'))}<select name="person" id="f-person"><option value="">${esc(t('all'))}</option>
        ${S.people.filter(p => p.role === 'night_lead').map(p => `<option value="${esc(p.id)}" ${f.person === p.id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="issues" id="f-issues" ${f.issues ? 'checked' : ''}> ${esc(t('issuesOnly'))}</label>
    </form>
    ${summary}
    ${rows.length ? rows.map(r => {
      const p = S.people.find(x => x.id === r.lead_id);
      const replies = S.comments.filter(c => c.submission_id === r.id && unreadForMe(c)).length;
      return `<details class="card report" data-sub="${esc(r.id)}" ${S.open.has(r.id) ? 'open' : ''}><summary><strong>${esc(p?.display_name || '?')}</strong>${replies ? ` <span class="badge">${esc(t('newReply'))}</span>` : ''} · ${esc(groupName(p?.group_id))} · ${esc(fmtDate(r.shift_date))}
        <span class="meta">${esc(t('sentAt'))} ${esc(fmtClock(r.submitted_at))} · ${esc(t('answered', {a: r.answered, t: r.total}))}
        ${r.needs_attention ? ` · <span class="warn">${esc(t('issues', {n: r.needs_attention}))}</span>` : ''}
        ${r.not_completed ? ` · <span class="warn">${esc(t('notDoneCount', {n: r.not_completed}))}</span>` : ''}
        ${r.revision > 1 ? ` <span class="chip">${esc(t('update', {n: r.revision}))}</span>` : ''}</span></summary>${viewSnapshot(r)}</details>`;
    }).join('') : `<p class="card">${esc(t('noReportsFound'))}</p>`}
    <section class="card"><h2>${esc(t('download'))}</h2><div class="row">
      <button class="btn" data-act="export" data-v="xlsx" ${S.busy ? 'disabled' : ''}>${esc(t('exportExcel'))}</button>
      <button class="btn" data-act="export" data-v="csv" ${S.busy ? 'disabled' : ''}>${esc(t('exportCsv'))}</button>
      <button class="btn" data-act="export" data-v="pdf" ${S.busy ? 'disabled' : ''}>${esc(t('exportPdf'))}</button></div></section>`;
}

// ------------------------------------------------------------ Supervisor: checklist builder
function parseTarget() {
  const [kind, id] = S.target.split(':');
  if (kind === 'group') return {kind, id, groupId: id, personId: null};
  if (kind === 'person') { const p = S.people.find(x => x.id === id); return {kind, id, groupId: p?.group_id || null, personId: id}; }
  return {kind: 'everyone', id: null, groupId: null, personId: null};
}
function builderList(target = parseTarget()) {
  return resolveQuestions({questions: S.questions, overrides: S.overrides, groupId: target.groupId, personId: target.personId, includeHidden: true});
}
const ownedHere = (q, tg) => (tg.kind === 'everyone' && q.scope === 'everyone') || (tg.kind === 'group' && q.scope === 'group') || (tg.kind === 'person' && q.scope === 'person');
const overrideIdHere = (q, tg) => tg.kind === 'group' ? q.group_override_id : tg.kind === 'person' ? q.person_override_id : null;
/** The values a question would have here without this group's/person's own change. */
function inherited(q, tg) {
  const base = S.questions.find(x => x.id === q.id);
  if (tg.kind === 'person' && tg.groupId) {
    const g = resolveQuestions({questions: [base], overrides: S.overrides, groupId: tg.groupId, includeHidden: true})[0];
    if (g) return g;
  }
  return base;
}

function viewBuilder() {
  const tg = parseTarget();
  const list = builderList(tg);
  const leads = S.people.filter(p => p.role === 'night_lead');
  const note = tg.kind === 'group' ? t('scopeNoteGroup') : tg.kind === 'person' ? t('scopeNotePerson') : t('scopeNoteEveryone');
  const badge = q => {
    const b = [];
    b.push(q.scope === 'everyone' ? t('badgeShared') : q.scope === 'group' ? t('badgeGroup') : t('badgePersonal'));
    if (overrideIdHere(q, tg)) b.push(t('badgeChanged'));
    if (!q.enabled) b.push(t('badgeHidden'));
    return b.map(x => `<span class="chip">${esc(x)}</span>`).join(' ');
  };
  const typeName = {checkbox: t('typeCheckbox'), yes_no: t('typeYesNo'), status: t('typeStatus'), text: t('typeText')};
  return `<h1>${esc(t('tabChecklists'))}</h1>
    <section class="card"><label>${esc(t('editingFor'))}
      <select id="target" data-act="target">
        <option value="everyone" ${S.target === 'everyone' ? 'selected' : ''}>${esc(t('everyone'))}</option>
        ${S.groups.length ? `<optgroup label="${esc(t('groups'))}">${S.groups.map(g => `<option value="group:${esc(g.id)}" ${S.target === 'group:' + g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</optgroup>` : ''}
        ${leads.length ? `<optgroup label="${esc(t('people'))}">${leads.map(p => `<option value="person:${esc(p.id)}" ${S.target === 'person:' + p.id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</optgroup>` : ''}
      </select></label><p class="hint">${esc(note)}</p>
      <div class="row"><button class="btn primary" data-act="add-q">${esc(t('addQuestion'))}</button>
      <button class="btn" data-act="preview">${esc(t('preview'))}</button></div></section>
    ${S.editQ ? viewQuestionForm(tg) : ''}
    ${viewChecklistIo(tg, list)}
    ${S.previewOpen ? `<section class="card preview"><h2>${esc(t('previewTitle'))}</h2>${list.filter(q => q.enabled).map(q => questionField(q, {disabled: true, prefix: 'pv'})).join('') || esc(t('noQuestionsHere'))}
      <button class="btn" data-act="preview">${esc(t('close'))}</button></section>` : ''}
    ${list.length ? `<ol class="qlist">${list.map((q, i) => {
      const owned = ownedHere(q, tg);
      const changed = overrideIdHere(q, tg);
      const lab = labelFor(q, S.lang);
      return `<li class="card qitem ${q.enabled ? '' : 'hidden-q'}">
        <div class="qtext"><strong>${esc(lab.text)}</strong>${lab.fallback ? ` <span class="fallback">${esc(t('englishOnly'))}</span>` : ''}
          <div class="meta">${esc(typeName[q.type])} · ${esc(q.required ? t('required') : t('optional'))}${q.allow_na ? ' · ' + esc(t('naChoice')) : ''}</div><div>${badge(q)}</div></div>
        <div class="row tight">
          <button class="btn sm" data-act="move" data-dir="-1" data-id="${esc(q.id)}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('moveUp'))}">↑</button>
          <button class="btn sm" data-act="move" data-dir="1" data-id="${esc(q.id)}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="${esc(t('moveDown'))}">↓</button>
          <button class="btn sm" data-act="edit-q" data-id="${esc(q.id)}">${esc(t('edit'))}</button>
          <button class="btn sm" data-act="toggle-q" data-id="${esc(q.id)}">${esc(q.enabled ? t('hide') : t('show'))}</button>
          ${changed ? `<button class="btn sm" data-act="restore-q" data-id="${esc(changed)}">${esc(t('restoreShared'))}</button>` : ''}
          ${owned ? `<button class="btn sm danger" data-act="delete-q" data-id="${esc(q.id)}">${esc(t('delete'))}</button>` : ''}
        </div></li>`;
    }).join('')}</ol>` : `<p class="card">${esc(t('noQuestionsHere'))}</p>`}`;
}

function targetName(tg) {
  if (tg.kind === 'group') return S.groups.find(g => g.id === tg.id)?.name || '?';
  if (tg.kind === 'person') return S.people.find(p => p.id === tg.id)?.display_name || '?';
  return t('everyone');
}

// Import a checklist from Excel/CSV, or download the current one (same layout, so it can be edited and imported again).
function viewChecklistIo(tg, list) {
  const typeName = {checkbox: t('typeCheckbox'), yes_no: t('typeYesNo'), status: t('typeStatus'), text: t('typeText')};
  let pending = '';
  if (S.io) {
    const {items, skipped} = S.io;
    const ownedCount = list.filter(q => ownedHere(q, tg)).length;
    pending = `<div class="io-preview" id="io-preview" tabindex="-1"><h3>${esc(S.io.fileName)}</h3>
      ${items.length ? `<p class="flash ok" role="status">${esc(t('ioFound', {n: items.length}))}</p>
        <p class="hint">${esc(t('ioAddingTo', {who: targetName(tg)}))}</p>
        <ol class="io-list">${items.map(q => `<li><strong>${esc(q.label)}</strong>${q.label_es ? `<br><span class="meta">${esc(q.label_es)}</span>` : ''}
          <br><span class="meta">${esc(typeName[q.type])} · ${esc(q.required ? t('required') : t('optional'))}${q.allow_na ? ' · ' + esc(t('naChoice')) : ''}</span></li>`).join('')}</ol>`
        : `<p class="flash warn" role="status">${esc(t('ioNone'))}</p>`}
      ${skipped.length ? `<p class="warn">${esc(t('ioSkipped', {n: skipped.length}))}</p>
        <ul class="io-skipped">${skipped.map(x => `<li>${esc(t('ioRow', {n: x.row}))}: ${esc(t('ioReason_' + x.reason))}${x.text ? ` <span class="meta">(${esc(x.text)})</span>` : ''}</li>`).join('')}</ul>` : ''}
      <div class="stack">
        ${items.length ? `<button class="btn primary big" data-act="io-add" ${S.busy ? 'disabled' : ''}>${esc(t('ioAdd', {n: items.length}))}</button>` : ''}
        ${items.length && ownedCount ? `<button class="btn big danger" data-act="io-replace" ${S.busy ? 'disabled' : ''}>${esc(t('ioReplace', {n: items.length}))}</button>` : ''}
        <button class="btn big" data-act="io-cancel">${esc(t('cancel'))}</button></div></div>`;
  }
  return `<details class="card io" data-io="1" ${S.ioOpen || S.io ? 'open' : ''}><summary>${esc(t('ioTitle'))}</summary>
    <p>${esc(t('ioIntro'))}</p>
    ${pending || `<label class="btn big filepick">${esc(t('ioPick'))}
        <input type="file" id="io-file" data-act="io-file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only"></label>
      <p class="hint">${esc(t('ioHow'))}</p>
      <button class="btn big" data-act="io-template">${esc(t('ioTemplate'))}</button>
      <h3>${esc(t('ioDownload'))}</h3>
      <div class="row"><button class="btn" data-act="io-download" data-v="xlsx" ${list.length ? '' : 'disabled'}>${esc(t('exportExcel'))}</button>
        <button class="btn" data-act="io-download" data-v="csv" ${list.length ? '' : 'disabled'}>${esc(t('exportCsv'))}</button></div>`}
  </details>`;
}

async function importQuestions(replace) {
  const tg = parseTarget();
  const list = builderList(tg);
  const owned = list.filter(q => ownedHere(q, tg));
  if (replace && !confirm(t('ioConfirmReplace', {old: owned.length, n: S.io.items.length}))) return;
  await run(async () => {
    const kept = replace ? list.filter(q => !ownedHere(q, tg)) : list;
    let order = kept.length ? Math.max(...kept.map(q => q.sort_order)) : 0;
    const rows = S.io.items.map(q => ({scope: tg.kind, group_id: tg.kind === 'group' ? tg.id : null, person_id: tg.kind === 'person' ? tg.id : null,
      type: q.type, label: q.label, label_es: q.label_es, required: q.required, allow_na: q.allow_na, enabled: true, sort_order: (order += 10)}));
    if (replace) for (const q of owned) await api.deleteQuestion(q.id);
    await api.addQuestions(rows);
    const n = rows.length;
    S.io = null; S.ioOpen = false;
    await loadBuilder();
    S.flash = {text: t('ioDone', {n}), kind: 'ok'};
  });
  window.scrollTo({top: 0});
}

function viewQuestionForm(tg) {
  const e = S.editQ;
  const isNew = !e.id;
  const typeOpts = [['checkbox', t('typeCheckbox')], ['yes_no', t('typeYesNo')], ['status', t('typeStatus')], ['text', t('typeText')]];
  return `<section class="card editq"><h2>${esc(isNew ? t('addQuestion') : t('edit'))}</h2>
    <form data-form="question" class="stack" novalidate>
      ${isNew ? `<label>${esc(t('questionType'))}<select name="type" id="qf-type">${typeOpts.map(([v, l]) => `<option value="${v}" ${e.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
      <label>${esc(t('labelEn'))}<input name="label" id="qf-label" maxlength="300" required value="${esc(e.label || '')}"></label>
      ${e.labelError ? `<p class="err" role="alert">${esc(t('labelRequired'))}</p>` : ''}
      <label>${esc(t('labelEs'))}<input name="label_es" id="qf-label-es" maxlength="300" value="${esc(e.label_es || '')}"></label>
      <label class="check"><input type="checkbox" name="required" id="qf-req" ${e.required ? 'checked' : ''}> ${esc(t('isRequired'))}</label>
      ${e.type === 'yes_no' || e.type === 'status' ? `<label class="check"><input type="checkbox" name="allow_na" id="qf-na" ${e.allow_na ? 'checked' : ''}> ${esc(t('allowNa'))}</label>` : ''}
      <p class="hint">${esc(tg.kind === 'group' ? t('scopeNoteGroup') : tg.kind === 'person' ? t('scopeNotePerson') : t('scopeNoteEveryone'))}</p>
      <div class="row"><button class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(t('save'))}</button>
      <button type="button" class="btn" data-act="cancel-q">${esc(t('cancel'))}</button></div>
    </form></section>`;
}

/** Saves a change to one question for the current target (directly, or as a group/person change). */
async function applyChange(q, fields, tg = parseTarget()) {
  if (ownedHere(q, tg)) { await api.saveQuestion({id: q.id, ...fields}); return; }
  const base = inherited(q, tg);
  const existing = S.overrides.find(o => o.id === overrideIdHere(q, tg));
  const next = existing ? {...existing} : {question_id: q.id, group_id: tg.kind === 'group' ? tg.id : null, person_id: tg.kind === 'person' ? tg.id : null,
    label: null, label_es: null, required: null, enabled: null, allow_na: null, sort_order: null};
  for (const [k, v] of Object.entries(fields)) {
    const same = k === 'sort_order' ? Number(v) === Number(base[k]) : (v ?? null) === (base[k] ?? null);
    next[k] = same ? null : v;
  }
  const empty = ['label', 'label_es', 'required', 'enabled', 'allow_na', 'sort_order'].every(k => next[k] === null || next[k] === undefined);
  if (empty) { if (existing) await api.deleteOverride(existing.id); return; }
  const {id, question_id, group_id, person_id, label, label_es, required, enabled, allow_na, sort_order} = next;
  await api.saveOverride({id, question_id, group_id, person_id, label, label_es, required, enabled, allow_na, sort_order});
}

async function moveQuestion(id, dir) {
  const tg = parseTarget();
  const list = builderList(tg);
  const i = list.findIndex(q => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  if (a.sort_order !== b.sort_order) {
    await applyChange(a, {sort_order: b.sort_order}, tg);
    await applyChange(b, {sort_order: a.sort_order}, tg);
  } else {
    const order = list.map(q => q.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [k, qid] of order.entries()) {
      const q = list.find(x => x.id === qid);
      if (q.sort_order !== (k + 1) * 10) await applyChange(q, {sort_order: (k + 1) * 10}, tg);
    }
  }
}

// ------------------------------------------------------------ Supervisor: team
function viewTeam() {
  const now = new Date();
  const invites = S.invites.filter(i => i.uses_left > 0 && new Date(i.expires_at) > now);
  const canShare = typeof navigator.share === 'function';
  const linkBox = (url, id) => `<div class="linkbox"><input readonly id="${id}" value="${esc(url)}" aria-label="${esc(t('copyLink'))}" data-act="select-all">
      <div class="row"><button class="btn primary" data-act="copy-link" data-v="${esc(url)}">${esc(t('copyLink'))}</button>
      ${canShare ? `<button class="btn" data-act="share-link" data-v="${esc(url)}">${esc(t('shareSend'))}</button>` : ''}</div></div>`;
  return `<h1>${esc(t('tabTeam'))}</h1>
    <section class="card share"><h2>${esc(t('shareTitle'))}</h2><p>${esc(t('shareIntro'))}</p>${linkBox(siteLink('?join'), 'share-url')}</section>
    <section class="card"><h2>${esc(t('people'))}</h2><ul class="people">${S.people.map(p => {
      const me = p.id === S.me.id;
      return `<li class="${p.enabled ? '' : 'off'}"><div><strong>${esc(p.display_name)}</strong> ${me ? esc(t('you')) : ''}
          <div class="meta">${esc(p.email || '')} · ${esc(roleName(p.role))} · ${esc(p.enabled ? t('active') : t('disabled'))}</div></div>
        <div class="row tight">
          <label class="sr-only" for="grp-${esc(p.id)}">${esc(t('group'))}</label>
          <select id="grp-${esc(p.id)}" data-act="set-group" data-id="${esc(p.id)}"><option value="">${esc(t('noGroup'))}</option>
            ${S.groups.map(g => `<option value="${esc(g.id)}" ${p.group_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <button class="btn sm" data-act="set-role" data-id="${esc(p.id)}" data-v="${p.role === 'rod' ? 'night_lead' : 'rod'}">${esc(p.role === 'rod' ? t('makeLead') : t('makeRod'))}</button>
          <button class="btn sm ${p.enabled ? 'danger' : ''}" data-act="set-enabled" data-id="${esc(p.id)}" data-v="${p.enabled ? '0' : '1'}">${esc(p.enabled ? t('disable') : t('enable'))}</button>
        </div></li>`;
    }).join('')}</ul></section>
    <section class="card"><h2>${esc(t('groups'))}</h2>
      <ul class="people">${S.groups.map(g => `<li><strong>${esc(g.name)}</strong><div class="row tight">
        <button class="btn sm" data-act="rename-group" data-id="${esc(g.id)}">${esc(t('rename'))}</button>
        <button class="btn sm danger" data-act="delete-group" data-id="${esc(g.id)}">${esc(t('delete'))}</button></div></li>`).join('')}</ul>
      <form data-form="group" class="row"><label class="grow">${esc(t('groupName'))}<input name="name" id="g-name" maxlength="80" required></label>
        <button class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(t('addGroup'))}</button></form></section>
    <section class="card"><h2>${esc(t('invites'))}</h2>
      ${S.newInvite ? `<div class="flash ok" role="status"><p>${esc(t('inviteCreated'))}</p><p class="code" id="new-code">${esc(S.newInvite)}</p>
        <button class="btn sm" data-act="copy-code">${esc(t('copy'))}</button>
        <p class="hint">${esc(t('inviteLinkHint'))}</p>${linkBox(siteLink('?invite=' + encodeURIComponent(S.newInvite)), 'invite-url')}</div>` : ''}
      <ul class="people">${invites.length ? invites.map(i => `<li><div><span class="code">${esc(i.code)}</span>
        <div class="meta">${esc(i.note || '')} ${esc(t('usesLeft', {n: i.uses_left}))} · ${esc(t('expires', {date: fmtDate(i.expires_at.slice(0, 10))}))}</div></div>
        <div class="row tight"><button class="btn sm" data-act="copy-link" data-v="${esc(siteLink('?invite=' + encodeURIComponent(i.code)))}">${esc(t('copyLink'))}</button>
        <button class="btn sm danger" data-act="revoke" data-id="${esc(i.code)}">${esc(t('revoke'))}</button></div></li>`).join('') : `<li>${esc(t('noInvites'))}</li>`}</ul>
      <form data-form="invite" class="stack">
        <label>${esc(t('inviteUses'))}<input type="number" name="uses" id="inv-uses" min="1" max="20" value="1"></label>
        <label>${esc(t('inviteDays'))}<input type="number" name="days" id="inv-days" min="1" max="60" value="14"></label>
        <label>${esc(t('inviteNote'))}<input name="note" id="inv-note" maxlength="120"></label>
        <button class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(t('newInvite'))}</button></form></section>`;
}

// ------------------------------------------------------------ Supervisor: pinned notes
function viewNotes() {
  const leads = S.people.filter(p => p.role === 'night_lead' && p.enabled);
  const audience = n => leads.filter(p => n.scope === 'everyone' || (n.scope === 'group' && p.group_id === n.group_id) || (n.scope === 'person' && p.id === n.person_id));
  const who = n => n.scope === 'everyone' ? t('everyone') : n.scope === 'group' ? (S.groups.find(g => g.id === n.group_id)?.name || '?') : (S.people.find(p => p.id === n.person_id)?.display_name || '?');
  const now = new Date();
  return `<h1>${esc(t('tabNotes'))}</h1><p class="hint">${esc(t('notesIntro'))}</p>
    <section class="card"><form data-form="note" class="stack" novalidate>
      <label>${esc(t('noteFor'))}<select name="target" id="n-target">
        <option value="everyone">${esc(t('everyone'))}</option>
        ${S.groups.length ? `<optgroup label="${esc(t('groups'))}">${S.groups.map(g => `<option value="group:${esc(g.id)}">${esc(g.name)}</option>`).join('')}</optgroup>` : ''}
        ${leads.length ? `<optgroup label="${esc(t('people'))}">${leads.map(p => `<option value="person:${esc(p.id)}">${esc(p.display_name)}</option>`).join('')}</optgroup>` : ''}
      </select></label>
      <label>${esc(t('noteText'))}<textarea name="body" id="n-body" rows="3" maxlength="1000"></textarea></label>
      <label>${esc(t('noteUntil'))}<input type="date" name="until" id="n-until"></label>
      <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('postNote'))}</button></form></section>
    ${S.notes.length ? S.notes.map(n => {
      const aud = audience(n);
      const read = aud.filter(p => S.acks.some(a => a.note_id === n.id && a.user_id === p.id));
      const unread = aud.filter(p => !read.includes(p));
      const expired = n.expires_at && new Date(n.expires_at) <= now;
      return `<section class="card note ${expired ? 'acked' : ''}"><p class="meta">${esc(who(n))} · ${esc(formatTime(n.created_at, S.lang))}${n.expires_at ? ' → ' + esc(fmtDate(n.expires_at.slice(0, 10))) : ''}</p>
        <p class="note-body">${esc(n.body)}</p>
        <p><strong>${esc(t('readBy', {n: read.length, m: aud.length}))}</strong>${unread.length ? `<br><span class="meta">${esc(t('notReadYet'))} ${unread.map(p => esc(p.display_name)).join(', ')}</span>` : ''}</p>
        <button class="btn sm danger" data-act="del-note" data-id="${esc(n.id)}">${esc(t('removeNote'))}</button></section>`;
    }).join('') : `<p class="card">${esc(t('noNotes'))}</p>`}`;
}

// ------------------------------------------------------------ help and tour
function viewHelp() {
  return `<h1>${esc(t('helpTitle'))}</h1>
    <section class="card stack"><p>${esc(t('yourRole', {role: roleName(S.me.role)}))}</p>
      <button class="btn big" data-act="tour">${esc(t('replayTutorial'))}</button>
      ${voiceSupported ? `<label class="check"><input type="checkbox" id="voice-on" data-act="voice-toggle" ${S.voiceOn ? 'checked' : ''}> 🔊 ${esc(t('voiceSetting'))}</label>
        <p class="hint">${esc(t('voiceHint'))}</p>` : ''}
      <div><span>${esc(t('language'))}</span> ${langSwitch()}</div></section>
    <section class="card"><h2>${esc(t('homeScreenTitle'))}</h2><p>${esc(isIOS() ? t('homeIos') : t('homeAndroid'))}</p>
      <p class="hint">${esc(isIOS() ? t('homeAndroid') : t('homeIos'))}</p></section>
    <section class="card"><h2>${esc(t('faqTitle'))}</h2>${t('faq').map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
    <section class="card"><form data-form="profile" class="stack">
      <label>${esc(t('displayName'))}<input name="display_name" id="pf-name" maxlength="80" required value="${esc(S.me.display_name)}"></label>
      <button class="btn">${esc(t('save'))}</button></form></section>
    ${api.mode === 'live' ? `<section class="card"><form data-form="new-password" class="stack">
      <label>${esc(t('changePassword'))}<input name="password" id="pf-pass" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="hint">${esc(t('passwordHint'))}</p><button class="btn">${esc(t('save'))}</button></form></section>` : ''}
    ${S.me.role !== 'rod' ? `<section class="card"><form data-form="redeem" class="stack">
      <label>${esc(t('haveCode'))}<input name="code" id="rd-code" autocomplete="off" autocapitalize="characters"></label>
      <button class="btn">${esc(t('redeem'))}</button></form></section>` : ''}
    ${api.mode === 'demo' ? `<section class="card"><button class="btn" data-act="reset-demo">Reset demo data</button></section>` : ''}
    <section class="card"><button class="btn big" data-act="sign-out">${esc(t('signOut'))}</button></section>`;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Small pictures for the tour, drawn with the same styles as the real screens (for looking at, not tapping).
function tourArt(kind) {
  const choice = (txt, on, icon = '') => `<span class="choice ${on ? 'on' : ''}">${icon ? `<span class="ico">${icon}</span>` : ''}<span>${esc(txt)}</span></span>`;
  const q = (label, inner) => `<div class="q mini"><div class="legend">${esc(label)}</div><div class="choices">${inner}</div></div>`;
  const sample = S.lang === 'es' ? {doors: 'Puertas cerradas', floors: 'Pisos', rest: 'Baños revisados'} : {doors: 'Doors locked', floors: 'Floors', rest: 'Restrooms checked'};
  switch (kind) {
    case 'welcome': return `<div class="art-logo">✓</div>`;
    case 'answer': return q(sample.rest, choice(t('yes'), true) + choice(t('no'), false));
    case 'honest': return q(sample.floors, choice(t('done'), false, '✓') + choice(t('needsAttention'), true, '⚠'));
    case 'send': return `<div class="mini-btn">${esc(t('submit'))}</div><div class="card sent mini-sent"><strong>${esc(t('sentTitle'))}</strong></div>`;
    case 'note': return `<div class="card note mini-note"><p class="note-body">${esc(S.lang === 'es' ? 'Esta noche revise también las puertas del gimnasio.' : 'Tonight please also check the gym doors.')}</p><span class="mini-btn small">${esc(t('gotIt'))}</span></div>`;
    case 'comment': return `<div class="comment from-rod"><p class="meta">${esc(t('fromName', {name: 'Nora', date: ''}))}</p><p>${esc(S.lang === 'es' ? 'Buen trabajo. Mañana revise el gimnasio.' : 'Nice work. Tomorrow check the gym too.')}</p></div>`;
    case 'history': return `<div class="mini-list"><div>✓ ${esc(fmtDate(daysBefore(shiftDate(), 1)))}</div><div>✓ ${esc(fmtDate(daysBefore(shiftDate(), 2)))}</div></div>`;
    case 'reports': return `<div class="mini-list"><div>✓ Lead A · 5/5</div><div class="warn">⚠ Lead B · 1 ${esc(t('needsAttention'))}</div><div class="meta">${esc(t('missing'))} Lead C</div></div>`;
    case 'checklists': return `<div class="mini-list"><div>${esc(t('everyone'))} ▾</div><div>↑ ↓ ${esc(t('edit'))} · ${esc(t('hide'))}</div></div>`;
    case 'team': return `<div class="mini-list"><div>👥 ${esc(t('groups'))}</div><div class="code">AB12CD34EF56</div></div>`;
    case 'download': return `<div class="row"><span class="mini-btn small">Excel</span><span class="mini-btn small">CSV</span><span class="mini-btn small">PDF</span></div>`;
    case 'home': return `<div class="art-logo">${isIOS() ? '⬆︎' : '⋮'}</div>`;
    case 'help': return `<div class="mini-tabs"><span>${esc(t('tabToday'))}</span><span>${esc(t('tabHistory'))}</span><span class="on">${esc(t('help'))}</span></div>`;
    default: return '';
  }
}

function viewTour() {
  const steps = t(S.me.role === 'rod' ? 'tourRod' : 'tourLead');
  const i = S.tour;
  const last = i === steps.length - 1;
  const step = steps[i];
  const text = step.text === 'HOME' ? (isIOS() ? t('homeIos') : t('homeAndroid')) : step.text;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text"><div class="card tour">
    <div class="tour-top"><p class="dots" aria-label="${i + 1} / ${steps.length}">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</p>${langSwitch()}</div>
    <div class="tour-art" aria-hidden="true">${tourArt(step.art)}</div>
    <h2 id="tour-title" tabindex="-1">${esc(step.title)}</h2>
    <p id="tour-text" class="tour-text">${esc(text)}</p>
    ${voiceSupported ? `<button type="button" class="btn big listen ${S.voiceOn ? 'on' : ''}" data-act="tour-voice" aria-pressed="${S.voiceOn}">🔊 ${esc(S.voiceOn ? t('voiceOnTour') : t('readToMe'))}</button>` : ''}
    <div class="row">${i > 0 ? `<button class="btn big" data-act="tour-step" data-v="-1">${esc(t('back'))}</button>` : `<button class="btn big" data-act="tour-done">${esc(t('skip'))}</button>`}
    <button class="btn primary big" id="tour-next" data-act="${last ? 'tour-done' : 'tour-step'}" data-v="1">${esc(last ? t('finish') : t('next'))}</button></div></div></div>`;
}

// ------------------------------------------------------------ events
root.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id;
  if (act === 'lang') return setLang(v);
  if (act === 'auth-mode') { S.authMode = v; S.flash = null; S.resetInputs = true; return render(); }
  if (act === 'toggle-supervisor') { S.showSupervisor = el.checked; return render(); }
  if (act === 'demo-login') return run(() => api.demoSignIn(id));
  if (act === 'tab') { if (S.tab !== v) history.pushState({tab: v}, ''); return goTab(v); }
  if (act === 'range') {
    const to = shiftDate();
    S.filters = {...S.filters, from: daysBefore(to, Number(v)), to};
    return run(async () => { await loadReports(); });
  }
  if (act === 'ack') return run(async () => { await api.ackNote(id); await loadInbox(); });
  if (act === 'del-note') { if (!confirm(t('confirmRemoveNote'))) return; return run(async () => { await api.deleteNote(id); await loadNotes(); }); }
  if (act === 'sign-out') return run(async () => { await api.signOut(); });
  if (act === 'reset-demo') { api.resetDemo(); location.reload(); return; }
  if (act === 'tour') { S.tour = 0; render(); focusTour(); if (S.voiceOn) speak(tourStepText(), S.lang); return; }
  if (act === 'tour-step') { S.tour += Number(v); render(); focusTour(); if (S.voiceOn) speak(tourStepText(), S.lang); else stopSpeaking(); return; }
  if (act === 'tour-done') { stopSpeaking(); S.tour = null; S.me.tutorial_done = true; api.updateMe({tutorial_done: true}).catch(() => {}); return render(); }
  // First tap turns the voice on and reads this step; tapping again while it's on reads the step again.
  if (act === 'tour-voice') { if (!S.voiceOn) setVoice(true); render(); return speak(tourStepText(), S.lang); }
  if (act === 'speak-q') {
    const q = S.checklist?.questions.find(x => x.id === id);
    if (!q) return;
    const lab = labelFor(q, S.lang);
    // No Spanish text yet: read the English in an English voice.
    if (!speak(lab.text, lab.fallback ? 'en' : S.lang)) flash(t('noVoice'), 'warn');
    return;
  }
  if (act === 'show-pass') {
    for (const p of el.closest('form').querySelectorAll('input[name="password"]')) p.type = el.checked ? 'text' : 'password';
    return;
  }
  if (act === 'voice-toggle') { setVoice(!S.voiceOn); if (S.voiceOn) speak(t('voiceOnSample'), S.lang); return render(); }
  if (act === 'edit-again') { S.editing = true; S.token = null; if (!Object.keys(S.answers).length) S.answers = {...S.lastAnswers}; return render(); }
  if (act === 'cancel-edit') { S.editing = false; S.answers = {}; S.errors = {}; store.del(draftKey()); return render(); }
  if (act === 'export') return run(() => exportReports(v, filteredReports(), {people: S.people, groups: S.groups, comments: S.comments, lang: S.lang, t, from: S.filters.from, to: S.filters.to}));
  if (act === 'add-q') { S.editQ = {type: 'checkbox', label: '', label_es: '', required: true, allow_na: false}; S.resetInputs = true; render(); return document.getElementById('qf-type')?.focus(); }
  if (act === 'cancel-q') { S.editQ = null; S.resetInputs = true; return render(); }
  if (act === 'preview') { S.previewOpen = !S.previewOpen; return render(); }
  if (act === 'edit-q') {
    const q = builderList().find(x => x.id === id);
    S.editQ = {id: q.id, type: q.type, label: q.label, label_es: q.label_es || '', required: q.required, allow_na: q.allow_na};
    S.resetInputs = true; render(); return document.getElementById('qf-label')?.focus();
  }
  if (act === 'toggle-q') return run(async () => { const q = builderList().find(x => x.id === id); await applyChange(q, {enabled: !q.enabled}); await loadBuilder(); });
  if (act === 'restore-q') return run(async () => { await api.deleteOverride(id); await loadBuilder(); });
  if (act === 'move') return run(async () => { await moveQuestion(id, Number(el.dataset.dir)); await loadBuilder(); });
  if (act === 'delete-q') {
    const q = S.questions.find(x => x.id === id);
    if (!confirm(q.scope === 'everyone' ? t('confirmDeleteShared') : t('confirmDeleteQ'))) return;
    return run(async () => { await api.deleteQuestion(id); await loadBuilder(); });
  }
  if (act === 'set-role') {
    const p = S.people.find(x => x.id === id);
    if (!confirm(t('confirmRole', {name: p.display_name, role: roleName(v)}))) return;
    return run(async () => { await api.updatePerson(id, {role: v}); await afterPeopleChange(id); });
  }
  if (act === 'set-enabled') {
    const p = S.people.find(x => x.id === id);
    if (v === '0' && !confirm(t('confirmDisable', {name: p.display_name}))) return;
    return run(async () => { await api.updatePerson(id, {enabled: v === '1'}); await afterPeopleChange(id); });
  }
  if (act === 'rename-group') {
    const g = S.groups.find(x => x.id === id);
    const name = prompt(t('groupName'), g.name);
    if (!name || !name.trim()) return;
    return run(async () => { await api.saveGroup({id, name: name.trim()}); await loadTeam(); });
  }
  if (act === 'delete-group') {
    if (!confirm(t('confirmDeleteGroup'))) return;
    return run(async () => { await api.deleteGroup(id); await loadTeam(); });
  }
  if (act === 'revoke') return run(async () => { await api.revokeInvite(id); await loadTeam(); });
  if (act === 'copy-code') return copyText(S.newInvite);
  if (act === 'copy-link') return copyText(v);
  if (act === 'select-all') return el.select?.();
  if (act === 'share-link') { navigator.share({title: t('appName'), text: t('shareText'), url: v}).catch(() => {}); return; }
  if (act === 'io-download') {
    const tg = parseTarget();
    const name = `night-lead-checklist_${targetName(tg).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'list'}`;
    return run(() => downloadChecklist(v, checklistTable(builderList(tg).filter(q => q.enabled), t), name));
  }
  if (act === 'io-template') return run(() => downloadChecklist('xlsx', templateRows(t), 'night-lead-checklist_template'));
  if (act === 'io-cancel') { S.io = null; S.ioOpen = true; return render(); }
  if (act === 'io-add') return importQuestions(false);
  if (act === 'io-replace') return importQuestions(true);
});

// Copies text, with a fallback for browsers that block the clipboard (old phones, non-secure pages).
function copyText(text) {
  const ok = () => flash(t('copied'));
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* not supported */ }
    ta.remove();
    if (done) ok();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok).catch(fallback); else fallback();
}

function goTab(v) {
  S.tab = v; S.flash = null; S.editQ = null; S.previewOpen = false; S.newInvite = null; S.io = null; S.ioOpen = false; S.resetInputs = true; S.open = new Set();
  return loadTab();
}
// Android back button / swipe back moves between tabs instead of leaving the site.
window.addEventListener('popstate', e => {
  if (S.screen !== 'app' || !S.me) return;
  const allowed = S.me.role === 'rod' ? ['reports', 'notes', 'checklists', 'team', 'help'] : ['today', 'history', 'help'];
  const v = e.state && allowed.includes(e.state.tab) ? e.state.tab : allowed[0];
  if (S.tour !== null) { S.tour = null; render(); return; }
  goTab(v);
});
// Opening a report marks its notes as read.
root.addEventListener('toggle', e => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.dataset.io) { S.ioOpen = d.open; return; }
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.sub) return;
  if (d.open) S.open.add(d.dataset.sub); else { S.open.delete(d.dataset.sub); return; }
  const unread = S.comments.filter(c => c.submission_id === d.dataset.sub && unreadForMe(c));
  if (!unread.length) return;
  api.markCommentsRead(d.dataset.sub).then(() => {
    const now = new Date().toISOString();
    for (const c of unread) { if (S.me.role === 'rod') c.read_by_rod_at = now; else c.read_by_lead_at = now; }
    setTimeout(render, 1500);
  }).catch(() => {});
}, true);

async function afterPeopleChange(id) {
  if (id === S.me.id) { await loadSession(); return; }
  await loadTeam();
}

function focusTour() { setTimeout(() => document.getElementById('tour-title')?.focus(), 0); }

root.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.q && el.type === 'radio') {
    const v = el.dataset.kind === 'checkbox' ? el.value === 'true' : el.value;
    S.answers[el.dataset.q] = v; delete S.errors[el.dataset.q];
    store.set(draftKey(), S.answers);
    return render();
  }
  if (el.dataset.act === 'target') { S.target = el.value; S.editQ = null; S.previewOpen = false; S.io = null; S.resetInputs = true; return render(); }
  if (el.dataset.act === 'io-file') {
    const file = el.files && el.files[0];
    if (!file) return;
    return run(async () => {
      const rows = await readTableFile(file);
      const existing = builderList().map(q => q.label);
      S.io = {...parseChecklistTable(rows, {existingLabels: existing}), fileName: file.name};
    }).then(() => { const box = document.getElementById('io-preview'); box?.scrollIntoView({block: 'start'}); box?.focus(); });
  }
  if (el.dataset.act === 'set-group') return run(async () => { await api.updatePerson(el.dataset.id, {group_id: el.value || null}); await loadTeam(); });
  if (el.dataset.act === 'toggle-supervisor') return;
  if (el.closest('form[data-form="filters"]')) {
    const f = new FormData(el.closest('form'));
    S.filters = {from: f.get('from') || S.filters.from, to: f.get('to') || S.filters.to, group: f.get('group'), person: f.get('person'), issues: f.get('issues') === 'on'};
    if (S.filters.from > S.filters.to) S.filters.to = S.filters.from;
    if (el.name === 'from' || el.name === 'to') return run(async () => { S.reports = await api.listReports(S.filters); });
    return render();
  }
  if (el.form?.dataset.form === 'question' && el.name === 'type') { S.editQ = {...S.editQ, ...formValues(el.form)}; S.resetInputs = true; return render(); }
});

root.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.q && el.dataset.kind === 'text') {
    if (el.value === '') delete S.answers[el.dataset.q]; else S.answers[el.dataset.q] = el.value;
    delete S.errors[el.dataset.q];
    store.set(draftKey(), S.answers);
  }
});

function formValues(form) {
  const f = new FormData(form);
  return {type: f.get('type') || S.editQ?.type, label: f.get('label') || '', label_es: f.get('label_es') || '', required: f.get('required') === 'on', allow_na: f.get('allow_na') === 'on'};
}

root.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const kind = form.dataset.form;
  if (kind === 'signin') return run(async () => { await api.signIn(String(f.get('email')).trim(), f.get('password')); });
  if (kind === 'signup') {
    const code = S.showSupervisor ? String(f.get('code') || '').trim() : '';
    return run(async () => {
      if (code) store.set('nlh-pending-invite', true);
      const res = await api.signUp({email: String(f.get('email') || '').trim(), password: f.get('password'), displayName: String(f.get('name') || '').trim(), inviteCode: code, locale: S.lang});
      if (res.needsConfirm) S.authMode = 'check-email';
    });
  }
  if (kind === 'forgot') return run(async () => { await api.sendReset(String(f.get('email')).trim()); S.flash = {text: t('resetSent'), kind: 'ok'}; S.authMode = 'signin'; });
  if (kind === 'new-password') return run(async () => {
    await api.setNewPassword(f.get('password'));
    form.reset(); S.flash = {text: t('passwordUpdated'), kind: 'ok'};
    if (S.screen === 'recovery') await loadSession();
  });
  if (kind === 'report') return submitReport();
  if (kind === 'comment') {
    const body = String(f.get('body') || '').trim();
    if (!body) { flash(t('commentEmpty'), 'err'); return; }
    const sub = form.dataset.sub;
    return run(async () => {
      await api.addComment(sub, body, f.get('question') || null);
      S.open.add(sub);
      S.comments = S.me.role === 'rod' ? await api.listComments(S.reports.map(r => r.id)) : await api.listMyComments();
      S.flash = {text: t('saved'), kind: 'ok'};
    });
  }
  if (kind === 'note') {
    const body = String(f.get('body') || '').trim();
    if (!body) { flash(t('noteEmpty'), 'err'); return; }
    const [scope, tid] = String(f.get('target')).split(':');
    const until = f.get('until');
    return run(async () => {
      await api.saveNote({scope, group_id: scope === 'group' ? tid : null, person_id: scope === 'person' ? tid : null, body,
        expires_at: until ? new Date(until + 'T23:59:59-06:00').toISOString() : null});
      await loadNotes();
      S.flash = {text: t('saved'), kind: 'ok'};
    });
  }
  if (kind === 'question') return saveQuestionForm(form);
  if (kind === 'group') return run(async () => { await api.saveGroup({name: String(f.get('name')).trim()}); await loadTeam(); });
  if (kind === 'invite') return run(async () => {
    S.newInvite = await api.createInvite({uses: Number(f.get('uses')) || 1, days: Number(f.get('days')) || 14, note: String(f.get('note') || '').trim()});
    await loadTeam();
  });
  if (kind === 'profile') return run(async () => { await api.updateMe({display_name: String(f.get('display_name')).trim()}); S.me = await api.getMe(); S.flash = {text: t('saved'), kind: 'ok'}; });
  if (kind === 'redeem') return run(async () => {
    const ok = await api.redeemInvite(String(f.get('code')));
    if (!ok) { S.flash = {text: t('redeemBad'), kind: 'err'}; return; }
    await loadSession(); S.flash = {text: t('redeemOk'), kind: 'ok'};
  });
});

async function submitReport() {
  if (S.busy) return;
  const qs = S.checklist.questions;
  const check = checkAnswers(qs, S.answers);
  if (!check.ok) { S.errors = check.errors; render(); if (S.voiceOn) speak(t('fixErrors'), S.lang); return focusFirstError(); }
  S.token = S.token || crypto.randomUUID();
  await run(async () => {
    try {
      const res = await api.submitReport(check.answers, S.token);
      store.del(draftKey());
      S.sent = res; S.editing = false; S.lastAnswers = {...check.answers}; S.answers = {}; S.errors = {}; S.token = null;
      S.checklist.latest = res;
      if (S.voiceOn) speak(t('sentSpoken'), S.lang);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'validation') {
        if (Object.values(e.fields || {}).includes('not_available')) {
          await loadChecklist();
          S.answers = Object.fromEntries(Object.entries(check.answers).filter(([k]) => S.checklist.questions.some(q => q.id === k)));
          S.editing = true;
          throw Object.assign(new Error('changed'), {code: 'changed'});
        }
        S.errors = Object.fromEntries(Object.entries(e.fields || {}).map(([k, v]) => [k, v === 'required' ? 'required' : 'invalid']));
        return;
      }
      throw e;
    }
  });
  if (Object.keys(S.errors).length) focusFirstError();
  else if (S.sent && !S.editing) document.querySelector('.sent')?.focus?.();
}

function focusFirstError() {
  const first = S.checklist.questions.find(q => S.errors[q.id]);
  if (!first) return;
  const box = document.getElementById(`q-${first.id}-box`);
  box?.scrollIntoView({block: 'center'});
  box?.querySelector('input,textarea')?.focus();
}

async function saveQuestionForm(form) {
  const v = formValues(form);
  if (!v.label.trim()) { S.editQ = {...S.editQ, ...v, labelError: true}; render(); return document.getElementById('qf-label')?.focus(); }
  const tg = parseTarget();
  const fields = {label: v.label.trim(), label_es: v.label_es.trim() || null, required: v.required, allow_na: v.type === 'yes_no' || v.type === 'status' ? v.allow_na : false};
  await run(async () => {
    if (S.editQ.id) {
      const q = builderList(tg).find(x => x.id === S.editQ.id);
      await applyChange(q, fields, tg);
    } else {
      const list = builderList(tg);
      const sort_order = list.length ? Math.max(...list.map(q => q.sort_order)) + 10 : 10;
      await api.saveQuestion({scope: tg.kind, group_id: tg.kind === 'group' ? tg.id : null, person_id: tg.kind === 'person' ? tg.id : null,
        type: v.type, ...fields, enabled: true, sort_order});
    }
    S.editQ = null;
    await loadBuilder();
    S.flash = {text: t('saved'), kind: 'ok'};
  });
}

// ------------------------------------------------------------ start
api.onAuthChange((event, signedIn, userId) => {
  if (event === 'PASSWORD_RECOVERY') { S.screen = 'recovery'; render(); return; }
  if (event === 'SIGNED_OUT' || (!signedIn && event !== 'INITIAL_SESSION')) {
    S.me = null; S.screen = 'auth'; S.authMode = 'signin'; S.filters = null; S.resetInputs = true; render(); return;
  }
  if (S.screen === 'recovery') return;
  // Supabase repeats SIGNED_IN when the tab regains focus; only reload for a new user or a changed account.
  if (event === 'SIGNED_IN' && S.me && S.me.id === userId) return;
  if (event === 'SIGNED_IN' || event === 'USER_UPDATED') loadSession();
});
document.documentElement.lang = S.lang;
loadSession().catch(e => { console.error(e); S.screen = 'auth'; S.flash = {text: errorText(e), kind: 'err'}; render(); });
