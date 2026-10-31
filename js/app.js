// Night Lead Hub user interface. Plain JavaScript, no build step.
import {translator} from './i18n.js';
import {resolveQuestions, checkAnswers, shiftDate, labelFor} from './rules.js';
import {exportReports, formatAnswer, formatTime} from './export.js';
import {createSupabaseApi, ApiError} from './api-supabase.js';
import {createDemoApi} from './api-demo.js';

const cfg = window.NLH_CONFIG || {};
const api = cfg.supabaseUrl && cfg.supabaseAnonKey ? createSupabaseApi(cfg) : createDemoApi();
const root = document.getElementById('app');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const S = {
  lang: store.get('nlh-lang') || ((navigator.language || '').startsWith('es') ? 'es' : 'en'),
  me: null, tab: null, screen: 'loading', authMode: 'signin', busy: false, flash: null,
  checklist: null, answers: {}, errors: {}, sent: null, editing: false, token: null, myReports: null,
  people: [], groups: [], questions: [], overrides: [], reports: [], invites: [], newInvite: null,
  filters: null, target: 'everyone', editQ: null, previewOpen: false, tour: null, showSupervisor: false,
  resetInputs: false, // true = next render starts forms fresh instead of keeping typed text
};
let t = translator(S.lang);

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
    demo_only: 'demoOnly', duplicate_name: 'duplicateName'};
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
  if (S.me && S.me.locale !== lang) api.updateMe({locale: lang}).catch(() => {});
  render();
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
  if (!S.me.tutorial_done) S.tour = 0;
  await loadTab();
}

async function loadTab() {
  S.loading = true;
  render();
  try {
    if (S.tab === 'today') await loadChecklist();
    else if (S.tab === 'history') S.myReports = await api.myReports();
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
  S.errors = {};
  S.editing = false;
  S.sent = S.checklist.latest ? {submitted_at: S.checklist.latest.submitted_at, revision: S.checklist.latest.revision, shift_date: S.checklist.latest.shift_date} : null;
  if (Object.keys(S.answers).length && S.sent) S.editing = true;
}

async function loadReports() {
  if (!S.filters) { const d = shiftDate(); S.filters = {from: d, to: d, group: '', person: '', issues: false}; }
  [S.people, S.groups, S.reports] = await Promise.all([api.listPeople(), api.listGroups(), api.listReports(S.filters)]);
}
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
      if (el.type === 'password' || el.type === 'radio') continue;
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
        <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('signIn'))}</button>
      </form>
      <p><button class="link" data-act="auth-mode" data-v="forgot">${esc(t('forgotPassword'))}</button></p>
      <p>${esc(t('noAccount'))} <button class="link" data-act="auth-mode" data-v="signup">${esc(t('signUp'))}</button></p>`;
  } else if (m === 'signup') {
    body = `<form data-form="signup" class="stack" novalidate>
        <label>${esc(t('name'))}<input id="su-name" name="name" required maxlength="80" autocomplete="name"></label>
        <label>${esc(t('email'))}<input id="su-email" name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label>${esc(t('password'))}<input id="su-pass" name="password" type="password" required minlength="8" autocomplete="new-password" aria-describedby="pw-hint"></label>
        <p id="pw-hint" class="hint">${esc(t('passwordHint'))}</p>
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
  return `<main class="auth"><header class="auth-head"><h1>${esc(t('appName'))}</h1>${langSwitch()}</header>
    ${flashBox()}<section class="card">${m === 'signup' || api.mode === 'demo' ? '' : `<h2>${esc(m === 'forgot' ? t('forgotPassword') : t('signIn'))}</h2>`}${body}</section></main>`;
}

function supervisorField() {
  return `<label class="check"><input type="checkbox" id="su-is-rod" data-act="toggle-supervisor" ${S.showSupervisor ? 'checked' : ''}> ${esc(t('supervisorQ'))}</label>
    ${S.showSupervisor ? `<label>${esc(t('inviteCode'))}<input id="su-code" name="code" autocomplete="off" autocapitalize="characters" aria-describedby="code-hint"></label>
    <p id="code-hint" class="hint">${esc(t('inviteHelp'))}</p>` : ''}`;
}

function viewRecovery() {
  return `<main class="auth"><header class="auth-head"><h1>${esc(t('appName'))}</h1>${langSwitch()}</header>${flashBox()}
    <section class="card"><h2>${esc(t('setNewPassword'))}</h2>
    <form data-form="new-password" class="stack" novalidate>
      <label>${esc(t('newPassword'))}<input id="np-pass" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <p class="hint">${esc(t('passwordHint'))}</p>
      <button class="btn primary big" ${S.busy ? 'disabled' : ''}>${esc(t('save'))}</button>
    </form></section></main>`;
}

// ------------------------------------------------------------ views: app shell
function viewApp() {
  const rod = S.me.role === 'rod';
  const tabs = rod ? [['reports', t('tabReports')], ['checklists', t('tabChecklists')], ['team', t('tabTeam')], ['help', t('help')]]
                   : [['today', t('tabToday')], ['history', t('tabHistory')], ['help', t('help')]];
  let main = '';
  if (S.loading) main = `<p aria-busy="true">${esc(t('loading'))}</p>`;
  else if (S.tab === 'today') main = viewToday();
  else if (S.tab === 'history') main = viewHistory();
  else if (S.tab === 'reports') main = viewReports();
  else if (S.tab === 'checklists') main = viewBuilder();
  else if (S.tab === 'team') main = viewTeam();
  else main = viewHelp();
  return `<header class="top"><div><strong>${esc(t('appName'))}</strong><span class="who">${esc(S.me.display_name)} · ${esc(roleName(S.me.role))}</span></div>${langSwitch()}</header>
    <nav class="tabs" aria-label="Main">${tabs.map(([k, label]) => `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${esc(label)}</button>`).join('')}</nav>
    <main class="content">${flashBox()}${main}</main>`;
}

// ------------------------------------------------------------ Night Lead: today
function questionField(q, {answer, error, disabled = false, prefix = 'q'}) {
  const lab = labelFor(q, S.lang);
  const name = `${prefix}-${q.id}`;
  const opt = (value, text) => {
    const checked = answer === value;
    return `<label class="choice ${checked ? 'on' : ''}"><input type="radio" name="${esc(name)}" value="${esc(String(value))}" data-q="${esc(q.id)}" data-kind="${q.type}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${esc(text)}</span></label>`;
  };
  let input = '';
  if (q.type === 'checkbox') input = opt(true, t('completed')) + opt(false, t('notCompleted'));
  else if (q.type === 'yes_no') input = opt('yes', t('yes')) + opt('no', t('no')) + (q.allow_na ? opt('not_applicable', t('na')) : '');
  else if (q.type === 'status') input = opt('done', t('done')) + opt('needs_attention', t('needsAttention')) + (q.allow_na ? opt('not_applicable', t('na')) : '');
  else input = `<textarea id="${esc(name)}" data-q="${esc(q.id)}" data-kind="text" maxlength="3000" rows="2" placeholder="${esc(t('typeHere'))}" ${disabled ? 'disabled' : ''} aria-labelledby="${esc(name)}-l">${esc(answer ?? '')}</textarea>`;
  const errId = `${name}-err`;
  return `<fieldset class="q ${error ? 'has-error' : ''}" id="${esc(name)}-box" ${error ? `aria-describedby="${esc(errId)}"` : ''}>
    <legend id="${esc(name)}-l">${esc(lab.text)} ${lab.fallback ? `<span class="fallback">${esc(t('englishOnly'))}</span>` : ''}
      <span class="req">${esc(q.required ? t('required') : t('optional'))}</span></legend>
    <div class="choices ${q.type === 'text' ? 'text' : ''}">${input}</div>
    ${error ? `<p class="err" id="${esc(errId)}">${esc(error === 'required' ? t('errRequired') : t('errInvalid'))}</p>` : ''}
  </fieldset>`;
}

function viewToday() {
  const c = S.checklist;
  if (!c) return `<p>${esc(t('loading'))}</p>`;
  const hasDraft = Object.keys(S.answers).length > 0;
  const head = `<h1>${esc(t('shiftOf', {date: fmtDate(c.shift_date)}))}</h1>`;
  if (S.sent && !S.editing) {
    return `${head}<section class="card sent" role="status"><h2>${esc(t('sentTitle'))}</h2>
      <p>${esc(t('sentBody', {time: fmtClock(S.sent.submitted_at), date: fmtDate(S.sent.shift_date)}))}</p>
      ${S.sent.revision > 1 ? `<p class="chip">${esc(t('update', {n: S.sent.revision}))}</p>` : ''}
      <button class="btn big" data-act="edit-again">${esc(t('editResend'))}</button></section>`;
  }
  if (!c.questions.length) return `${head}<p class="card">${esc(t('noQuestions'))}</p>`;
  const status = hasDraft ? `<p class="status draft">${esc(t('statusDraft'))}</p>` : (S.sent ? `<p class="status">${esc(t('statusSent', {time: fmtClock(S.sent.submitted_at)}))}</p>` : `<p class="status">${esc(t('statusNotStarted'))}</p>`);
  const errCount = Object.keys(S.errors).length;
  return `${head}${status}
    <form data-form="report" novalidate>
      ${errCount ? `<p class="flash err" role="alert">${esc(t('fixErrors'))}</p>` : ''}
      ${c.questions.map(q => questionField(q, {answer: S.answers[q.id], error: S.errors[q.id]})).join('')}
      <div class="sticky-submit"><button class="btn primary big" id="send-report" ${S.busy ? 'disabled aria-busy="true"' : ''}>${esc(S.busy ? t('sending') : t('submit'))}</button></div>
    </form>`;
}

function viewSnapshot(r) {
  return `<ul class="answers">${r.questions.map(q => {
    const lab = labelFor(q, S.lang);
    const a = formatAnswer(q, t);
    const bad = q.answer === false || q.answer === 'needs_attention' || q.answer === 'no';
    return `<li><span>${esc(lab.text)}</span><strong class="${bad ? 'warn' : ''}">${esc(a || '—')}</strong></li>`;
  }).join('')}</ul>`;
}

function viewHistory() {
  if (!S.myReports) return `<p>${esc(t('loading'))}</p>`;
  if (!S.myReports.length) return `<h1>${esc(t('tabHistory'))}</h1><p class="card">${esc(t('noReports'))}</p>`;
  return `<h1>${esc(t('tabHistory'))}</h1>${S.myReports.map(r => `<details class="card report"><summary>
    <strong>${esc(fmtDate(r.shift_date))}</strong> · ${esc(t('statusSent', {time: fmtClock(r.submitted_at)}))}
    ${r.revision > 1 ? `<span class="chip">${esc(t('update', {n: r.revision}))}</span>` : ''}</summary>${viewSnapshot(r)}</details>`).join('')}`;
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
      return `<details class="card report"><summary><strong>${esc(p?.display_name || '?')}</strong> · ${esc(groupName(p?.group_id))} · ${esc(fmtDate(r.shift_date))}
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
    ${S.previewOpen ? `<section class="card preview"><h2>${esc(t('previewTitle'))}</h2>${list.filter(q => q.enabled).map(q => questionField(q, {disabled: true, prefix: 'pv'})).join('') || esc(t('noQuestionsHere'))}
      <button class="btn" data-act="preview">${esc(t('close'))}</button></section>` : ''}
    ${list.length ? `<ol class="qlist">${list.map((q, i) => {
      const owned = ownedHere(q, tg);
      const changed = overrideIdHere(q, tg);
      const lab = labelFor(q, S.lang);
      return `<li class="card qitem ${q.enabled ? '' : 'hidden-q'}">
        <div class="qtext"><strong>${esc(lab.text)}</strong>${lab.fallback ? ` <span class="fallback">${esc(t('englishOnly'))}</span>` : ''}
          <div class="meta">${esc(typeName[q.type])} · ${esc(q.required ? t('required') : t('optional'))}${q.allow_na ? ' · N/A' : ''}</div><div>${badge(q)}</div></div>
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
  return `<h1>${esc(t('tabTeam'))}</h1>
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
        <button class="btn sm" data-act="copy-code">${esc(t('copy'))}</button></div>` : ''}
      <ul class="people">${invites.length ? invites.map(i => `<li><div><span class="code">${esc(i.code)}</span>
        <div class="meta">${esc(i.note || '')} ${esc(t('usesLeft', {n: i.uses_left}))} · ${esc(t('expires', {date: fmtDate(i.expires_at.slice(0, 10))}))}</div></div>
        <button class="btn sm danger" data-act="revoke" data-id="${esc(i.code)}">${esc(t('revoke'))}</button></li>`).join('') : `<li>${esc(t('noInvites'))}</li>`}</ul>
      <form data-form="invite" class="stack">
        <label>${esc(t('inviteUses'))}<input type="number" name="uses" id="inv-uses" min="1" max="20" value="1"></label>
        <label>${esc(t('inviteDays'))}<input type="number" name="days" id="inv-days" min="1" max="60" value="14"></label>
        <label>${esc(t('inviteNote'))}<input name="note" id="inv-note" maxlength="120"></label>
        <button class="btn primary" ${S.busy ? 'disabled' : ''}>${esc(t('newInvite'))}</button></form></section>`;
}

// ------------------------------------------------------------ help and tour
function viewHelp() {
  return `<h1>${esc(t('helpTitle'))}</h1>
    <section class="card stack"><p>${esc(t('yourRole', {role: roleName(S.me.role)}))}</p>
      <button class="btn big" data-act="tour">${esc(t('replayTutorial'))}</button>
      <div><span>${esc(t('language'))}</span> ${langSwitch()}</div></section>
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

function viewTour() {
  const steps = t(S.me.role === 'rod' ? 'tourRod' : 'tourLead');
  const i = S.tour;
  const last = i === steps.length - 1;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="tour-text"><div class="card tour">
    <p class="dots" aria-hidden="true">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</p>
    <p id="tour-text" class="tour-text" tabindex="-1">${esc(steps[i])}</p>
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
  if (act === 'tab') { S.tab = v; S.flash = null; S.editQ = null; S.previewOpen = false; S.newInvite = null; S.resetInputs = true; return loadTab(); }
  if (act === 'sign-out') return run(async () => { await api.signOut(); });
  if (act === 'reset-demo') { api.resetDemo(); location.reload(); return; }
  if (act === 'tour') { S.tour = 0; render(); return focusTour(); }
  if (act === 'tour-step') { S.tour += Number(v); render(); return focusTour(); }
  if (act === 'tour-done') { S.tour = null; S.me.tutorial_done = true; api.updateMe({tutorial_done: true}).catch(() => {}); return render(); }
  if (act === 'edit-again') { S.editing = true; S.token = null; return render(); }
  if (act === 'export') return run(() => exportReports(v, filteredReports(), {people: S.people, groups: S.groups, lang: S.lang, t, from: S.filters.from, to: S.filters.to}));
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
  if (act === 'copy-code') { navigator.clipboard?.writeText(S.newInvite).then(() => flash(t('copied'))).catch(() => {}); }
});

async function afterPeopleChange(id) {
  if (id === S.me.id) { await loadSession(); return; }
  await loadTeam();
}

function focusTour() { setTimeout(() => document.getElementById('tour-text')?.focus(), 0); }

root.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.q && el.type === 'radio') {
    const v = el.dataset.kind === 'checkbox' ? el.value === 'true' : el.value;
    S.answers[el.dataset.q] = v; delete S.errors[el.dataset.q];
    store.set(draftKey(), S.answers);
    return render();
  }
  if (el.dataset.act === 'target') { S.target = el.value; S.editQ = null; S.previewOpen = false; S.resetInputs = true; return render(); }
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
  if (!check.ok) { S.errors = check.errors; render(); return focusFirstError(); }
  S.token = S.token || crypto.randomUUID();
  await run(async () => {
    try {
      const res = await api.submitReport(check.answers, S.token);
      store.del(draftKey());
      S.sent = res; S.editing = false; S.answers = {}; S.errors = {}; S.token = null;
      S.checklist.latest = res;
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
