// Live backend: Supabase handles accounts, password reset e-mails and the database.
// All permission checks happen in the database (supabase/schema.sql), not here.

export class ApiError extends Error {
  constructor(code, message, fields) { super(message || code); this.code = code; this.fields = fields || null; }
}

function fail(error) {
  if (!error) return;
  const msg = error.message || '';
  if (msg.includes('validation_failed')) {
    let fields = {};
    try { fields = JSON.parse(error.details || '{}'); } catch { /* keep empty */ }
    throw new ApiError('validation', msg, fields);
  }
  for (const code of ['not_allowed', 'last_supervisor', 'only_night_leads_submit', 'invalid_invite']) {
    if (msg.includes(code)) throw new ApiError(code, msg);
  }
  if (/invalid login credentials/i.test(msg)) throw new ApiError('bad_login', msg);
  if (/email not confirmed/i.test(msg)) throw new ApiError('email_not_confirmed', msg);
  if (/already registered/i.test(msg)) throw new ApiError('already_registered', msg);
  if (/password should be|weak password/i.test(msg)) throw new ApiError('weak_password', msg);
  if (/rate limit|too many/i.test(msg)) throw new ApiError('rate_limited', msg);
  if (/failed to fetch|network/i.test(msg)) throw new ApiError('network', msg);
  if (error.code === '42501' || /permission denied|row-level security/i.test(msg)) throw new ApiError('not_allowed', msg);
  throw new ApiError('unknown', msg);
}

const data = ({data, error}) => { fail(error); return data; };

export function createSupabaseApi({supabaseUrl, supabaseAnonKey}) {
  const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    // 'implicit' lets confirm/reset links work even when opened on a different device than the one that asked.
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit'},
  });
  const siteUrl = () => location.origin + location.pathname;
  let uid = null;

  return {
    mode: 'live',
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event, session) => { uid = session?.user?.id || null; setTimeout(() => cb(event, !!session, uid), 0); });
    },
    async hasSession() {
      const {data: {session}} = await sb.auth.getSession();
      uid = session?.user?.id || null;
      return !!session;
    },
    async signUp({email, password, displayName, inviteCode, locale}) {
      const res = data(await sb.auth.signUp({
        email, password,
        options: {data: {display_name: displayName, invite_code: inviteCode || null, locale}, emailRedirectTo: siteUrl()},
      }));
      return {needsConfirm: !res.session};
    },
    async signIn(email, password) { data(await sb.auth.signInWithPassword({email, password})); },
    async signOut() { await sb.auth.signOut(); uid = null; },
    async sendReset(email) { data(await sb.auth.resetPasswordForEmail(email, {redirectTo: siteUrl()})); },
    async setNewPassword(password) { data(await sb.auth.updateUser({password})); },

    async getMe() { return data(await sb.from('profiles').select('*').eq('id', uid).single()); },
    async updateMe(patch) { data(await sb.from('profiles').update(patch).eq('id', uid)); },
    async redeemInvite(code) { return data(await sb.rpc('redeem_rod_invite', {p_code: code})); },

    async myChecklist() { return data(await sb.rpc('my_checklist')); },
    async submitReport(answers, token) { return data(await sb.rpc('submit_report', {p_answers: answers, p_client_token: token})); },
    async myReports() {
      return data(await sb.from('submissions').select('*').eq('lead_id', uid)
        .order('shift_date', {ascending: false}).order('revision', {ascending: false}).limit(60));
    },

    // Supervisor-only calls (the database refuses them for Night Leads).
    async listReports({from, to}) {
      // Supabase returns at most 1000 rows per request, so read in pages.
      const all = [];
      for (let start = 0; start < 20000; start += 1000) {
        const page = data(await sb.from('submissions').select('*').gte('shift_date', from).lte('shift_date', to)
          .order('shift_date', {ascending: false}).order('submitted_at', {ascending: false}).order('id').range(start, start + 999));
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    },
    async listPeople() { return data(await sb.from('profiles').select('*').order('display_name')); },
    async updatePerson(id, patch) { data(await sb.from('profiles').update(patch).eq('id', id)); },
    async listGroups() { return data(await sb.from('groups').select('*').order('name')); },
    async saveGroup({id, name}) {
      if (id) data(await sb.from('groups').update({name}).eq('id', id));
      else data(await sb.from('groups').insert({name}));
    },
    async deleteGroup(id) { data(await sb.from('groups').delete().eq('id', id)); },
    async listQuestions() { return data(await sb.from('questions').select('*')); },
    async listOverrides() { return data(await sb.from('question_overrides').select('*')); },
    async saveQuestion(q) {
      const {id, ...fields} = q;
      if (id) data(await sb.from('questions').update(fields).eq('id', id));
      else data(await sb.from('questions').insert(fields));
    },
    async deleteQuestion(id) { data(await sb.from('questions').delete().eq('id', id)); },
    async saveOverride(o) {
      const {id, ...fields} = o;
      if (id) data(await sb.from('question_overrides').update(fields).eq('id', id));
      else data(await sb.from('question_overrides').insert(fields));
    },
    async deleteOverride(id) { data(await sb.from('question_overrides').delete().eq('id', id)); },
    async listInvites() { return data(await sb.from('rod_invites').select('*').order('created_at', {ascending: false})); },
    async createInvite({uses, days, note}) { return data(await sb.rpc('create_rod_invite', {p_uses: uses, p_days: days, p_note: note || null})); },
    async revokeInvite(code) { data(await sb.from('rod_invites').delete().eq('code', code)); },
  };
}
