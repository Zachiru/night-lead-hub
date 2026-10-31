// DEMO backend: used only when no Supabase project is configured (js/config.js).
// Everything is stored in this browser only, there are no passwords, and the
// permission checks here are a simulation. Never use demo mode for real staff.
import {ApiError} from './api-supabase.js';
import {resolveQuestions, checkAnswers, summarize, shiftDate} from './rules.js';

const KEY = 'nlh-demo-v1';
const uuid = () => crypto.randomUUID();
const G_A = 'demo-group-a', G_B = 'demo-group-b';

function seed() {
  const users = [
    {id: 'demo-rod', email: 'supervisor@demo.invalid', display_name: 'Demo Supervisor', role: 'rod', group_id: null},
    {id: 'demo-lead-a', email: 'lead.a@demo.invalid', display_name: 'Demo Lead A', role: 'night_lead', group_id: G_A},
    {id: 'demo-lead-b', email: 'lead.b@demo.invalid', display_name: 'Demo Lead B', role: 'night_lead', group_id: G_B},
  ].map(u => ({enabled: true, locale: 'en', tutorial_done: false, created_at: new Date().toISOString(), ...u}));
  const q = (id, type, label, label_es, required, sort_order, extra = {}) =>
    ({id, scope: 'everyone', group_id: null, person_id: null, type, label, label_es, required, enabled: true, allow_na: false, sort_order, ...extra});
  return {
    users,
    groups: [{id: G_A, name: 'Building A (sample)'}, {id: G_B, name: 'Building B (sample)'}],
    // Sample questions only: replace with the team's real checklist.
    questions: [
      q('sample-restrooms', 'yes_no', 'Restrooms checked? (sample)', '¿Baños revisados? (ejemplo)', true, 10),
      q('sample-doors', 'checkbox', 'Doors locked (sample)', 'Puertas cerradas con llave (ejemplo)', true, 20),
      q('sample-floors', 'status', 'Floors (sample)', 'Pisos (ejemplo)', true, 30, {allow_na: true}),
      q('sample-notes', 'text', 'Shift notes (sample)', 'Notas del turno (ejemplo)', false, 40),
    ],
    overrides: [],
    submissions: [],
    invites: [{code: 'DEMOSUPER', expires_at: '2099-01-01T00:00:00Z', uses_left: 99, note: 'Demo invite', created_at: new Date().toISOString()}],
    session: null,
  };
}

const noteVisible = (n, u) => (!n.expires_at || new Date(n.expires_at) > new Date())
  && (n.scope === 'everyone' || (n.scope === 'group' && n.group_id && n.group_id === u.group_id) || (n.scope === 'person' && n.person_id === u.id));

export function createDemoApi() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  db.comments ||= []; db.notes ||= []; db.acks ||= [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode: memory only */ } };
  let listener = () => {};
  const me = () => db.users.find(u => u.id === db.session && u.enabled) || null;
  const active = () => { const u = me(); if (!u) throw new ApiError('not_allowed'); return u; };
  const rod = () => { const u = active(); if (u.role !== 'rod') throw new ApiError('not_allowed'); return u; };
  const clone = v => structuredClone(v);
  const tick = () => new Promise(r => setTimeout(r, 30));

  return {
    mode: 'demo',
    demoAccounts: () => db.users.map(u => ({id: u.id, name: u.display_name, role: u.role})),
    resetDemo() { db = seed(); save(); },
    onAuthChange(cb) { listener = cb; },
    async hasSession() { return !!me(); },
    async demoSignIn(id) { await tick(); db.session = id; save(); listener('SIGNED_IN', true, id); },
    async signUp({displayName, inviteCode, locale}) {
      await tick();
      const inv = db.invites.find(i => i.code === String(inviteCode || '').trim().toUpperCase() && i.uses_left > 0 && new Date(i.expires_at) > new Date());
      if (inv) inv.uses_left -= 1;
      const user = {id: uuid(), email: '', display_name: displayName.slice(0, 80) || 'New user', role: inv ? 'rod' : 'night_lead',
        group_id: null, enabled: true, locale: locale === 'es' ? 'es' : 'en', tutorial_done: false, created_at: new Date().toISOString()};
      db.users.push(user); db.session = user.id; save(); listener('SIGNED_IN', true, user.id);
      return {needsConfirm: false};
    },
    async signIn() { throw new ApiError('demo_only'); },
    async signOut() { db.session = null; save(); listener('SIGNED_OUT', false); },
    async sendReset() { throw new ApiError('demo_only'); },
    async setNewPassword() { throw new ApiError('demo_only'); },

    async getMe() { return clone(active()); },
    async updateMe(patch) {
      const u = active();
      for (const k of Object.keys(patch)) if (!['display_name', 'locale', 'tutorial_done'].includes(k)) throw new ApiError('not_allowed');
      Object.assign(u, patch); save();
    },
    async redeemInvite(code) {
      const u = active();
      const inv = db.invites.find(i => i.code === String(code).trim().toUpperCase() && i.uses_left > 0 && new Date(i.expires_at) > new Date());
      if (!inv) return false;
      inv.uses_left -= 1; u.role = 'rod'; save(); return true;
    },

    async myChecklist() {
      await tick();
      const u = active();
      const sd = shiftDate();
      const latest = db.submissions.filter(s => s.lead_id === u.id && s.shift_date === sd).sort((a, b) => b.revision - a.revision)[0] || null;
      return clone({shift_date: sd, questions: resolveQuestions({questions: db.questions, overrides: db.overrides, groupId: u.group_id, personId: u.id}), latest});
    },
    async submitReport(answers, token) {
      await tick();
      const u = active();
      if (u.role !== 'night_lead') throw new ApiError('only_night_leads_submit');
      const dup = token && db.submissions.find(s => s.lead_id === u.id && s.client_token === token);
      if (dup) return {id: dup.id, shift_date: dup.shift_date, revision: dup.revision, submitted_at: dup.submitted_at, duplicate: true};
      const qs = resolveQuestions({questions: db.questions, overrides: db.overrides, groupId: u.group_id, personId: u.id});
      const extra = Object.keys(answers).filter(k => !qs.some(q => q.id === k));
      const res = checkAnswers(qs, answers);
      if (!res.ok || extra.length) {
        const fields = {...res.errors}; for (const k of extra) fields[k] = 'not_available';
        throw new ApiError('validation', 'validation_failed', fields);
      }
      const snap = qs.map(q => ({id: q.id, type: q.type, label: q.label, label_es: q.label_es, required: q.required, allow_na: q.allow_na,
        answer: Object.prototype.hasOwnProperty.call(res.normalized, q.id) ? res.normalized[q.id] : null}));
      const s = summarize(snap);
      const sd = shiftDate();
      const rev = 1 + Math.max(0, ...db.submissions.filter(x => x.lead_id === u.id && x.shift_date === sd).map(x => x.revision));
      const row = {id: uuid(), lead_id: u.id, shift_date: sd, revision: rev, submitted_at: new Date().toISOString(), client_token: token,
        questions: snap, total: s.total, answered: s.answered, needs_attention: s.needsAttention, not_completed: s.notCompleted};
      db.submissions.push(row); save();
      return {id: row.id, shift_date: sd, revision: rev, submitted_at: row.submitted_at, duplicate: false};
    },
    async myReports() {
      const u = active();
      return clone(db.submissions.filter(s => s.lead_id === u.id).sort((a, b) => b.shift_date.localeCompare(a.shift_date) || b.revision - a.revision));
    },

    async listReports({from, to}) { rod(); return clone(db.submissions.filter(s => s.shift_date >= from && s.shift_date <= to)); },
    async listPeople() { rod(); return clone(db.users); },
    async updatePerson(id, patch) {
      const actor = rod();
      const u = db.users.find(x => x.id === id);
      if (!u) throw new ApiError('not_allowed');
      const next = {...u, ...patch};
      if (u.role === 'rod' && u.enabled && (next.role !== 'rod' || !next.enabled)
          && !db.users.some(x => x.id !== id && x.role === 'rod' && x.enabled)) throw new ApiError('last_supervisor');
      Object.assign(u, patch); save();
      if (u.id === actor.id && (!u.enabled || u.role !== 'rod')) listener('USER_UPDATED', true, actor.id);
    },
    async listGroups() { active(); return clone(db.groups).sort((a, b) => a.name.localeCompare(b.name)); },
    async saveGroup({id, name}) {
      rod();
      if (db.groups.some(g => g.name.toLowerCase() === name.toLowerCase() && g.id !== id)) throw new ApiError('duplicate_name');
      if (id) db.groups.find(g => g.id === id).name = name; else db.groups.push({id: uuid(), name});
      save();
    },
    async deleteGroup(id) {
      rod();
      db.groups = db.groups.filter(g => g.id !== id);
      const gone = new Set(db.questions.filter(q => q.group_id === id).map(q => q.id));
      db.questions = db.questions.filter(q => !gone.has(q.id));
      db.overrides = db.overrides.filter(o => o.group_id !== id && !gone.has(o.question_id));
      for (const u of db.users) if (u.group_id === id) u.group_id = null;
      save();
    },
    async listQuestions() { rod(); return clone(db.questions); },
    async listOverrides() { rod(); return clone(db.overrides); },
    async saveQuestion(q) {
      rod();
      if (q.id) Object.assign(db.questions.find(x => x.id === q.id), q);
      else db.questions.push({group_id: null, person_id: null, enabled: true, allow_na: false, ...q, id: uuid()});
      save();
    },
    async deleteQuestion(id) {
      rod();
      db.questions = db.questions.filter(q => q.id !== id);
      db.overrides = db.overrides.filter(o => o.question_id !== id);
      save();
    },
    async saveOverride(o) {
      rod();
      if (o.id) Object.assign(db.overrides.find(x => x.id === o.id), o);
      else db.overrides.push({label: null, label_es: null, required: null, enabled: null, allow_na: null, sort_order: null, group_id: null, person_id: null, ...o, id: uuid()});
      save();
    },
    async deleteOverride(id) { rod(); db.overrides = db.overrides.filter(o => o.id !== id); save(); },
    async listInvites() { rod(); return clone(db.invites); },
    async createInvite({uses, days, note}) {
      rod();
      const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      db.invites.unshift({code, uses_left: uses, note, expires_at: new Date(Date.now() + days * 864e5).toISOString(), created_at: new Date().toISOString()});
      save(); return code;
    },
    async revokeInvite(code) { rod(); db.invites = db.invites.filter(i => i.code !== code); save(); },

    async listComments(ids) { rod(); return clone(db.comments.filter(c => ids.includes(c.submission_id))); },
    async listMyComments() { const u = active(); return clone(db.comments.filter(c => c.lead_id === u.id)); },
    async addComment(submissionId, body, questionId) {
      const u = active();
      const s = db.submissions.find(x => x.id === submissionId);
      if (!s || !(u.role === 'rod' || s.lead_id === u.id)) throw new ApiError('not_allowed');
      if (questionId && !s.questions.some(q => q.id === questionId)) throw new ApiError('invalid_question');
      const text = String(body || '').trim();
      if (!text || text.length > 1000) throw new ApiError('invalid_comment');
      const now = new Date().toISOString();
      const c = {id: uuid(), submission_id: s.id, lead_id: s.lead_id, question_id: questionId || null, author_id: u.id, author_name: u.display_name,
        body: text, created_at: now, read_by_lead_at: u.id === s.lead_id ? now : null, read_by_rod_at: u.role === 'rod' ? now : null};
      db.comments.push(c); save(); return clone(c);
    },
    async deleteComment(id) { rod(); db.comments = db.comments.filter(c => c.id !== id); save(); },
    async markCommentsRead(submissionId) {
      const u = active(); const now = new Date().toISOString();
      for (const c of db.comments) {
        if (c.submission_id !== submissionId) continue;
        if (u.role === 'rod' && !c.read_by_rod_at) c.read_by_rod_at = now;
        if (u.role !== 'rod' && c.lead_id === u.id && !c.read_by_lead_at) c.read_by_lead_at = now;
      }
      save();
    },
    async listNotes() {
      const u = active();
      if (u.role === 'rod') return clone(db.notes);
      return clone(db.notes.filter(n => noteVisible(n, u)));
    },
    async saveNote(n) { const u = rod(); db.notes.unshift({id: uuid(), group_id: null, person_id: null, expires_at: null, ...n, created_by: u.id, created_by_name: u.display_name, created_at: new Date().toISOString()}); save(); },
    async deleteNote(id) { rod(); db.notes = db.notes.filter(n => n.id !== id); db.acks = db.acks.filter(a => a.note_id !== id); save(); },
    async listAcks() { const u = active(); return clone(u.role === 'rod' ? db.acks : db.acks.filter(a => a.user_id === u.id)); },
    async ackNote(id) {
      const u = active(); const n = db.notes.find(x => x.id === id);
      if (!n || !noteVisible(n, u)) throw new ApiError('not_allowed');
      if (!db.acks.some(a => a.note_id === id && a.user_id === u.id)) db.acks.push({note_id: id, user_id: u.id, acked_at: new Date().toISOString()});
      save();
    },
  };
}
