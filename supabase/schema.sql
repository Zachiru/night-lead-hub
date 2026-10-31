-- Night Lead Hub database setup.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- It creates the tables, the permission rules, and the server-side checklist logic.
--
-- Two roles only:
--   night_lead : fills in the daily checklist, sees only their own reports.
--   rod        : supervisor (ROD and supervisor are the same role). Sees all reports,
--                edits checklists for everyone / a group / one person, manages the team.
-- Everyone who signs up is a night_lead. A person becomes a rod only with a valid
-- supervisor invite code, or when an existing rod promotes them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Chicago',
  -- Work done before this hour counts toward the previous night's shift.
  shift_cutoff_hour int not null default 6 check (shift_cutoff_hour between 0 and 12)
);
insert into public.app_settings default values on conflict do nothing;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  role text not null default 'night_lead' check (role in ('night_lead', 'rod')),
  group_id uuid references public.groups(id) on delete set null,
  enabled boolean not null default true,
  locale text not null default 'en' check (locale in ('en', 'es')),
  tutorial_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  -- Who the question belongs to: everyone, one group, or one person.
  scope text not null check (scope in ('everyone', 'group', 'person')),
  group_id uuid references public.groups(id) on delete cascade,
  person_id uuid references public.profiles(id) on delete cascade,
  type text not null check (type in ('checkbox', 'yes_no', 'text', 'status')),
  label text not null check (length(btrim(label)) between 1 and 300),
  label_es text check (label_es is null or length(label_es) <= 300),
  required boolean not null default true,
  enabled boolean not null default true,
  allow_na boolean not null default false,
  sort_order numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (
    (scope = 'everyone' and group_id is null and person_id is null) or
    (scope = 'group' and group_id is not null and person_id is null) or
    (scope = 'person' and person_id is not null and group_id is null)
  )
);

-- A change to a question for one group or one person. NULL fields inherit.
-- "Restore to shared" deletes the row.
create table if not exists public.question_overrides (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  person_id uuid references public.profiles(id) on delete cascade,
  label text check (label is null or length(btrim(label)) between 1 and 300),
  label_es text check (label_es is null or length(label_es) <= 300),
  required boolean,
  enabled boolean,
  allow_na boolean,
  sort_order numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((group_id is null) <> (person_id is null))
);
create unique index if not exists question_overrides_group_uq
  on public.question_overrides (question_id, group_id) where group_id is not null;
create unique index if not exists question_overrides_person_uq
  on public.question_overrides (question_id, person_id) where person_id is not null;

-- Submitted reports. Each one stores the questions exactly as the lead saw them,
-- so later checklist edits never change an old report. Resubmitting adds a revision.
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.profiles(id) on delete cascade,
  shift_date date not null,
  revision int not null default 1,
  submitted_at timestamptz not null default now(),
  client_token text check (client_token is null or length(client_token) <= 80),
  questions jsonb not null,
  total int not null,
  answered int not null,
  needs_attention int not null,
  not_completed int not null,
  unique (lead_id, shift_date, revision),
  unique (lead_id, client_token)
);
create index if not exists submissions_shift_idx on public.submissions (shift_date);

create table if not exists public.rod_invites (
  code text primary key,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  uses_left int not null default 1 check (uses_left >= 0),
  note text check (note is null or length(note) <= 120)
);

create table if not exists public.audit_events (
  id bigserial primary key,
  actor uuid,
  action text not null,
  target text,
  detail jsonb,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

create or replace function public.is_rod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'rod' and enabled);
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and enabled);
$$;

create or replace function public.current_shift_date() returns date
language sql stable security definer set search_path = public as $$
  select ((now() at time zone s.timezone) - make_interval(hours => s.shift_cutoff_hour))::date
  from app_settings s;
$$;

create or replace function public.log_event(p_action text, p_target text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_events (actor, action, target, detail) values (auth.uid(), p_action, p_target, p_detail);
$$;

-- Builds the checklist for a group and/or person.
-- Order of precedence: shared question < group change < personal change.
-- Mirrors resolveQuestions() in js/rules.js; tests check that both agree.
create or replace function public.resolve_questions(p_group uuid, p_person uuid, p_include_hidden boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select q.* from questions q
    where q.scope = 'everyone'
       or (q.scope = 'group' and p_group is not null and q.group_id = p_group)
       or (q.scope = 'person' and p_person is not null and q.person_id = p_person)
  ), merged as (
    select b.id, b.type, b.scope, b.group_id, b.person_id,
      coalesce(po.label, go.label, b.label) as label,
      coalesce(po.label_es, go.label_es, b.label_es) as label_es,
      coalesce(po.required, go.required, b.required) as required,
      coalesce(po.enabled, go.enabled, b.enabled) as enabled,
      coalesce(po.allow_na, go.allow_na, b.allow_na) as allow_na,
      coalesce(po.sort_order, go.sort_order, b.sort_order) as sort_order,
      go.id as group_override_id,
      po.id as person_override_id
    from base b
    left join question_overrides go on go.question_id = b.id and p_group is not null and go.group_id = p_group
    left join question_overrides po on po.question_id = b.id and p_person is not null and po.person_id = p_person
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'type', type, 'scope', scope, 'label', label, 'label_es', label_es,
      'required', required, 'enabled', enabled, 'allow_na', allow_na, 'sort_order', sort_order,
      'group_override_id', group_override_id, 'person_override_id', person_override_id
    ) order by sort_order, id), '[]'::jsonb)
  from merged where p_include_hidden or enabled;
$$;

-- ---------------------------------------------------------------- API for the website

-- The signed-in Night Lead's checklist for the current shift.
create or replace function public.my_checklist() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me profiles; sd date; latest submissions;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not me.enabled then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  sd := current_shift_date();
  select * into latest from submissions where lead_id = me.id and shift_date = sd order by revision desc limit 1;
  return jsonb_build_object(
    'shift_date', sd,
    'questions', resolve_questions(me.group_id, me.id, false),
    'latest', case when latest.id is null then null else to_jsonb(latest) end
  );
end $$;

-- Supervisor preview of any group's or person's checklist (including hidden questions).
create or replace function public.rod_preview(p_group uuid, p_person uuid, p_include_hidden boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g uuid := p_group;
begin
  if not is_rod() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_person is not null then
    select group_id into g from profiles where id = p_person;
  end if;
  return resolve_questions(g, p_person, p_include_hidden);
end $$;

-- Validates and saves a report. The server rebuilds the checklist itself, so a
-- tampered request cannot answer hidden questions, skip required ones, or report
-- for somebody else. Same rules as validateSubmission() in src/checklist_rules.mjs.
create or replace function public.submit_report(p_answers jsonb, p_client_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles; qs jsonb; q jsonb; v jsonb; k text; s text;
  errors jsonb := '{}'; normalized jsonb := '{}'; snap jsonb := '[]';
  sd date; rev int; existing submissions; saved submissions;
  n_total int := 0; n_answered int := 0; n_attention int := 0; n_not_completed int := 0;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or not me.enabled then raise exception 'not_allowed' using errcode = '42501'; end if;
  if me.role <> 'night_lead' then raise exception 'only_night_leads_submit' using errcode = '42501'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'invalid_payload' using errcode = '22023'; end if;

  -- Double tap / retry: the same token returns the report that was already saved.
  if p_client_token is not null then
    select * into existing from submissions where lead_id = me.id and client_token = p_client_token;
    if existing.id is not null then
      return jsonb_build_object('id', existing.id, 'shift_date', existing.shift_date,
        'revision', existing.revision, 'submitted_at', existing.submitted_at, 'duplicate', true);
    end if;
  end if;

  qs := resolve_questions(me.group_id, me.id, false);

  for k in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from jsonb_array_elements(qs) e where e->>'id' = k) then
      errors := errors || jsonb_build_object(k, 'not_available');
    end if;
  end loop;

  for q in select * from jsonb_array_elements(qs) loop
    v := p_answers -> (q->>'id');
    s := case when v is not null and jsonb_typeof(v) = 'string' then v #>> '{}' end;
    if v is null or jsonb_typeof(v) = 'null' or s = ''
       or (q->>'type' = 'text' and s is not null and regexp_replace(s, '^\s+|\s+$', '', 'g') = '') then
      if (q->>'required')::boolean then errors := errors || jsonb_build_object(q->>'id', 'required'); end if;
      continue;
    end if;
    if q->>'type' = 'text' then
      if s is null or length(s) > 3000 then errors := errors || jsonb_build_object(q->>'id', 'invalid_text');
      else normalized := normalized || jsonb_build_object(q->>'id', regexp_replace(s, '^\s+|\s+$', '', 'g')); end if;
    elsif q->>'type' = 'checkbox' then
      if jsonb_typeof(v) <> 'boolean' then errors := errors || jsonb_build_object(q->>'id', 'invalid_checkbox');
      else normalized := normalized || jsonb_build_object(q->>'id', v); end if;
    elsif q->>'type' = 'yes_no' then
      if s in ('yes', 'no') or (s = 'not_applicable' and (q->>'allow_na')::boolean) then
        normalized := normalized || jsonb_build_object(q->>'id', s);
      else errors := errors || jsonb_build_object(q->>'id', 'invalid_yes_no'); end if;
    elsif q->>'type' = 'status' then
      if s in ('done', 'needs_attention') or (s = 'not_applicable' and (q->>'allow_na')::boolean) then
        normalized := normalized || jsonb_build_object(q->>'id', s);
      else errors := errors || jsonb_build_object(q->>'id', 'invalid_status'); end if;
    end if;
  end loop;

  if errors <> '{}'::jsonb then
    raise exception 'validation_failed' using errcode = 'P0001', detail = errors::text;
  end if;

  for q in select * from jsonb_array_elements(qs) loop
    v := coalesce(normalized -> (q->>'id'), 'null'::jsonb);
    snap := snap || jsonb_build_array(jsonb_build_object(
      'id', q->'id', 'type', q->'type', 'label', q->'label', 'label_es', q->'label_es',
      'required', q->'required', 'allow_na', q->'allow_na', 'answer', v));
    n_total := n_total + 1;
    if v <> 'null'::jsonb then n_answered := n_answered + 1; end if;
    if q->>'type' = 'status' and v = '"needs_attention"'::jsonb then n_attention := n_attention + 1; end if;
    if q->>'type' = 'checkbox' and v = 'false'::jsonb then n_not_completed := n_not_completed + 1; end if;
  end loop;

  sd := current_shift_date();
  perform pg_advisory_xact_lock(hashtext(me.id::text || sd::text));
  select coalesce(max(revision), 0) + 1 into rev from submissions where lead_id = me.id and shift_date = sd;

  insert into submissions (lead_id, shift_date, revision, client_token, questions, total, answered, needs_attention, not_completed)
  values (me.id, sd, rev, p_client_token, snap, n_total, n_answered, n_attention, n_not_completed)
  returning * into saved;

  perform log_event('report_submitted', saved.id::text, jsonb_build_object('shift_date', sd, 'revision', rev));
  return jsonb_build_object('id', saved.id, 'shift_date', saved.shift_date,
    'revision', saved.revision, 'submitted_at', saved.submitted_at, 'duplicate', false);
end $$;

-- Supervisor creates an invite code for a new supervisor.
create or replace function public.create_rod_invite(p_uses int default 1, p_days int default 14, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  -- auth.uid() is null only in the SQL editor, which is how the very first invite is made.
  if auth.uid() is not null and not is_rod() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_uses not between 1 and 20 or p_days not between 1 and 60 then raise exception 'invalid_invite' using errcode = '22023'; end if;
  c := upper(substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=0O1Il', ''), 1, 12));
  insert into rod_invites (code, created_by, expires_at, uses_left, note)
  values (c, auth.uid(), now() + make_interval(days => p_days), p_uses, left(p_note, 120));
  perform log_event('invite_created', null, jsonb_build_object('uses', p_uses, 'days', p_days));
  return c;
end $$;

-- An existing Night Lead account uses a supervisor invite code.
create or replace function public.redeem_rod_invite(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare inv rod_invites;
begin
  if not is_active() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update rod_invites set uses_left = uses_left - 1
   where code = upper(btrim(p_code)) and uses_left > 0 and expires_at > now()
  returning * into inv;
  if inv.code is null then return false; end if;
  perform set_config('nlh.trusted_role_change', 'on', true);
  update profiles set role = 'rod' where id = auth.uid();
  perform set_config('nlh.trusted_role_change', 'off', true);
  perform log_event('invite_redeemed', auth.uid()::text, null);
  return true;
end $$;

-- ---------------------------------------------------------------- triggers

-- New sign-ups become Night Leads, unless they entered a valid supervisor invite code.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(nullif(btrim(new.raw_user_meta_data->>'invite_code'), ''));
        r text := 'night_lead'; inv rod_invites;
begin
  if v_code is not null then
    update rod_invites set uses_left = uses_left - 1
     where rod_invites.code = v_code and uses_left > 0 and expires_at > now()
    returning * into inv;
    if inv.code is not null then r := 'rod'; end if;
  end if;
  insert into profiles (id, email, display_name, role, locale)
  values (new.id, new.email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'New user'), 80),
    r,
    case when new.raw_user_meta_data->>'locale' = 'es' then 'es' else 'en' end);
  insert into audit_events (actor, action, target, detail)
  values (new.id, 'account_created', new.id::text, jsonb_build_object('role', r));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only supervisors can change role, group or enabled. Nobody can change id/email here.
-- The last active supervisor cannot be removed (prevents lock-out).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id or new.email is distinct from old.email or new.created_at <> old.created_at then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- auth.uid() is null only for the database owner (SQL editor / setup scripts).
  if auth.uid() is not null and not is_rod()
     and coalesce(current_setting('nlh.trusted_role_change', true), 'off') <> 'on'
     and (new.role <> old.role or new.group_id is distinct from old.group_id or new.enabled <> old.enabled) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if old.role = 'rod' and old.enabled and (new.role <> 'rod' or not new.enabled)
     and not exists (select 1 from profiles where role = 'rod' and enabled and id <> old.id) then
    raise exception 'last_supervisor' using errcode = 'P0001';
  end if;
  if new.role <> old.role or new.group_id is distinct from old.group_id or new.enabled <> old.enabled then
    insert into audit_events (actor, action, target, detail) values (auth.uid(), 'profile_changed', new.id::text,
      jsonb_build_object('role', new.role, 'group_id', new.group_id, 'enabled', new.enabled));
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.stamp_and_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  insert into audit_events (actor, action, target, detail)
  values (auth.uid(), lower(tg_table_name || '_' || tg_op),
          case when tg_op = 'DELETE' then old.id::text else new.id::text end,
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists questions_audit on public.questions;
create trigger questions_audit before insert or update or delete on public.questions
  for each row execute function public.stamp_and_audit();
drop trigger if exists overrides_audit on public.question_overrides;
create trigger overrides_audit before insert or update or delete on public.question_overrides
  for each row execute function public.stamp_and_audit();

-- ---------------------------------------------------------------- row level security

alter table public.app_settings enable row level security;
alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.question_overrides enable row level security;
alter table public.submissions enable row level security;
alter table public.rod_invites enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (is_active());
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for update to authenticated using (is_rod()) with check (is_rod());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (is_active());
drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups for all to authenticated using (is_rod()) with check (is_rod());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or is_rod());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or is_rod()) with check (id = auth.uid() or is_rod());

drop policy if exists questions_rod on public.questions;
create policy questions_rod on public.questions for all to authenticated using (is_rod()) with check (is_rod());
drop policy if exists overrides_rod on public.question_overrides;
create policy overrides_rod on public.question_overrides for all to authenticated using (is_rod()) with check (is_rod());

-- Reports: Night Leads read only their own; supervisors read all. Writes only through submit_report().
drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions for select to authenticated
  using ((lead_id = auth.uid() and is_active()) or is_rod());

drop policy if exists invites_rod on public.rod_invites;
create policy invites_rod on public.rod_invites for all to authenticated using (is_rod()) with check (is_rod());

drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events for select to authenticated using (is_rod());

-- ---------------------------------------------------------------- grants

-- Supabase grants broad default privileges; start from nothing, then allow only what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select, update on public.app_settings to authenticated;
grant select, insert, update, delete on public.groups, public.questions, public.question_overrides, public.rod_invites to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.submissions, public.audit_events to authenticated;
grant execute on function public.is_rod(), public.is_active(), public.current_shift_date(),
  public.my_checklist(), public.rod_preview(uuid, uuid, boolean),
  public.submit_report(jsonb, text), public.create_rod_invite(int, int, text),
  public.redeem_rod_invite(text) to authenticated;
-- resolve_questions and log_event stay internal (no direct client access).
