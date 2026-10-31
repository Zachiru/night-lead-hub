-- Security and behaviour tests for supabase/schema.sql. Every check raises on failure.
\set QUIET on


create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;
-- Runs SQL and returns the error message plus detail ('' when it succeeds).
create or replace function t.err(q text) returns text language plpgsql as $$
declare m text; d text;
begin execute q; return '';
exception when others then get stacked diagnostics m = message_text, d = pg_exception_detail; return m || ' ' || coalesce(d, ''); end $$;
grant execute on all functions in schema t to anon, authenticated;

-- First supervisor invite, created from the SQL editor (no signed-in user).
select t.ok(length(public.create_rod_invite(2, 7, 'setup')) = 12, 'owner can create the first supervisor invite');
insert into rod_invites (code, expires_at, uses_left) values ('EXPIREDCODE1', now() - interval '1 day', 5);
insert into rod_invites (code, expires_at, uses_left) values ('VALIDCODE123', now() + interval '1 day', 1);
insert into rod_invites (code, expires_at, uses_left) values ('LATERCODE123', now() + interval '1 day', 1);

insert into groups (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Building A'),
  ('00000000-0000-0000-0000-0000000000a2', 'Building B');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'rod.a@test.invalid', '{"display_name":"ROD A","invite_code":"validcode123"}'),
  ('00000000-0000-0000-0000-000000000002', 'rod.b@test.invalid', '{"display_name":"ROD B","invite_code":"VALIDCODE123"}'),
  ('00000000-0000-0000-0000-000000000003', 'lead.a@test.invalid', '{"display_name":"Lead A","locale":"es"}'),
  ('00000000-0000-0000-0000-000000000004', 'lead.b@test.invalid', '{"display_name":"Lead B","invite_code":"EXPIREDCODE1"}'),
  ('00000000-0000-0000-0000-000000000005', 'lead.c@test.invalid', '{"display_name":"Lead C","role":"rod"}');

select t.ok((select role from profiles where id = '00000000-0000-0000-0000-000000000001') = 'rod', 'valid invite code (any case) makes a supervisor');
select t.ok((select role from profiles where id = '00000000-0000-0000-0000-000000000002') = 'night_lead', 'used-up invite code gives Night Lead');
select t.ok((select role from profiles where id = '00000000-0000-0000-0000-000000000004') = 'night_lead', 'expired invite code gives Night Lead');
select t.ok((select role from profiles where id = '00000000-0000-0000-0000-000000000005') = 'night_lead', 'asking for role=rod in sign-up data is ignored');
select t.ok((select locale from profiles where id = '00000000-0000-0000-0000-000000000003') = 'es', 'sign-up language is saved');
update profiles set group_id = '00000000-0000-0000-0000-0000000000a1' where id in ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005');
update profiles set group_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-000000000004';

-- ============================== anonymous visitors
set role anon;
select t.ok(t.err('select * from profiles') like '%permission denied%', 'anonymous: cannot read profiles');
select t.ok(t.err('select * from submissions') like '%permission denied%', 'anonymous: cannot read reports');
select t.ok(t.err('select public.my_checklist()') like '%permission denied%', 'anonymous: cannot load a checklist');
reset role;

-- ============================== supervisor builds checklists
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into questions (id, scope, type, label, label_es, required, allow_na, sort_order) values
  ('10000000-0000-0000-0000-000000000001', 'everyone', 'yes_no',  'Restrooms checked?', '¿Baños revisados?', true, false, 10),
  ('10000000-0000-0000-0000-000000000002', 'everyone', 'checkbox', 'Doors locked', null, true, false, 20),
  ('10000000-0000-0000-0000-000000000003', 'everyone', 'status',  'Floors', null, true, true, 30),
  ('10000000-0000-0000-0000-000000000004', 'everyone', 'text',    'Notes', null, false, false, 40);
insert into questions (id, scope, group_id, type, label, required, sort_order) values
  ('10000000-0000-0000-0000-000000000005', 'group', '00000000-0000-0000-0000-0000000000a1', 'checkbox', 'Gym mopped', true, 25);
insert into questions (id, scope, person_id, type, label, required, sort_order) values
  ('10000000-0000-0000-0000-000000000006', 'person', '00000000-0000-0000-0000-000000000004', 'text', 'Boiler reading', true, 5);
-- Building A: notes required. Lead C (also Building A): notes optional again, restrooms hidden.
insert into question_overrides (question_id, group_id, required) values
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', true);
insert into question_overrides (question_id, person_id, required, enabled) values
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', false, null),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', null, false);
select t.ok((select updated_by from questions where id = '10000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-000000000001', 'edits record who made them');
select t.ok(jsonb_array_length(public.rod_preview(null, '00000000-0000-0000-0000-000000000005', true)) = 5, 'supervisor preview shows hidden questions too');
select t.ok(t.err('select public.submit_report(''{}''::jsonb)') like '%only_night_leads_submit%', 'supervisors do not submit Night Lead reports');
reset role;

-- ============================== Night Lead A (Building A)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select t.ok((select count(*) from profiles) = 1, 'Lead A sees only their own profile');
select t.ok((select count(*) from questions) = 0, 'Lead A cannot read the question bank directly');
select t.ok(t.err($q$insert into questions (scope, type, label) values ('everyone','text','hack')$q$) <> '', 'Lead A cannot add questions');
select t.ok(t.err($q$update profiles set role = 'rod' where id = auth.uid()$q$) like '%not_allowed%', 'Lead A cannot make themselves a supervisor');
select t.ok(t.err($q$update profiles set group_id = null where id = auth.uid()$q$) like '%not_allowed%', 'Lead A cannot change their own group');
update profiles set display_name = 'Lead A2', locale = 'en', tutorial_done = true where id = auth.uid();
select t.ok((select display_name from profiles) = 'Lead A2', 'Lead A can change name, language and tutorial flag');
select t.ok(t.err($q$update profiles set display_name = 'x' where id = '00000000-0000-0000-0000-000000000004'$q$) = '' and
  (select count(*) from profiles) = 1, 'Lead A cannot edit another person (no rows visible)');
select t.ok(t.err($q$insert into submissions (lead_id, shift_date, questions, total, answered, needs_attention, not_completed) values (auth.uid(), current_date, '[]', 0,0,0,0)$q$) like '%permission denied%', 'Lead A cannot write reports directly');
select t.ok(t.err('select public.resolve_questions(null, ''00000000-0000-0000-0000-000000000004'', true)') like '%permission denied%', 'Lead A cannot call the internal checklist builder');
select t.ok(t.err('select public.rod_preview(null, ''00000000-0000-0000-0000-000000000004'')') like '%not_allowed%', 'Lead A cannot preview other people''s lists');
select t.ok(t.err('select public.create_rod_invite()') like '%not_allowed%', 'Lead A cannot create supervisor invites');
select t.ok(t.err('select * from rod_invites') = '' and (select count(*) from rod_invites) = 0, 'Lead A cannot see invite codes');
select t.ok(t.err('truncate submissions') like '%permission denied%', 'Lead A cannot wipe reports');
select t.ok(t.err('delete from groups') = '' and (select count(*) from groups) = 2, 'Lead A cannot delete groups');

select t.ok((select string_agg(q->>'label', '|' order by ord) from jsonb_array_elements(public.my_checklist()->'questions') with ordinality as x(q, ord))
  = 'Restrooms checked?|Doors locked|Gym mopped|Floors|Notes', 'Lead A gets shared + Building A questions in order');
select t.ok((select (q->>'required')::boolean from jsonb_array_elements(public.my_checklist()->'questions') q where q->>'label' = 'Notes'), 'Building A change makes Notes required for Lead A');

-- validation
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000001":"no"}')$q$) like '%validation_failed%required%', 'missing required answers are rejected');
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":"false","10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"ok"}')$q$) like '%invalid_checkbox%', 'checkbox must be a real true/false');
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000006":"x","10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"ok"}')$q$) like '%not_available%', 'answering someone else''s personal question is rejected');
select t.ok(t.err($q$select public.submit_report('{"zzz":"x","10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"ok"}')$q$) like '%not_available%', 'unknown question ids are rejected');
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000001":"not_applicable","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"ok"}')$q$) like '%invalid_yes_no%', 'N/A rejected where not allowed');
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"   "}')$q$) like '%required%', 'whitespace-only required text is rejected');
select t.ok(t.err($q$select public.submit_report('[]')$q$) like '%invalid_payload%', 'non-object payload rejected');

-- honest negative answers are valid
select t.ok((public.submit_report('{"10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"needs_attention","10000000-0000-0000-0000-000000000004":"  Leak by gym  "}', 'tok-1')->>'revision')::int = 1,
  '"No", "Not completed" and "Needs attention" are accepted');
select t.ok((public.submit_report('{"10000000-0000-0000-0000-000000000001":"no","10000000-0000-0000-0000-000000000002":false,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"needs_attention","10000000-0000-0000-0000-000000000004":"x"}', 'tok-1')->>'duplicate')::boolean, 'double tap with same token does not create a duplicate');
select t.ok((select count(*) from submissions) = 1, 'exactly one report saved');
select t.ok((select questions->4->>'answer' from submissions) = 'Leak by gym', 'text answers are trimmed');
select t.ok((select needs_attention = 1 and not_completed = 1 and answered = 5 and total = 5 from submissions), 'report counts issues without treating them as missing');
select t.ok((public.submit_report('{"10000000-0000-0000-0000-000000000001":"yes","10000000-0000-0000-0000-000000000002":true,"10000000-0000-0000-0000-000000000005":true,"10000000-0000-0000-0000-000000000003":"done","10000000-0000-0000-0000-000000000004":"fixed"}', 'tok-2')->>'revision')::int = 2, 'resubmitting creates revision 2');
select t.ok((public.my_checklist()->'latest'->>'revision')::int = 2, 'checklist shows the latest saved report');
reset role;

-- ============================== Night Lead B (Building B, personal question)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
set role authenticated;
select t.ok((select count(*) from submissions) = 0, 'Lead B cannot see Lead A''s reports');
select t.ok((select string_agg(q->>'label', '|' order by ord) from jsonb_array_elements(public.my_checklist()->'questions') with ordinality as x(q, ord))
  = 'Boiler reading|Restrooms checked?|Doors locked|Floors|Notes', 'Lead B gets their personal question but not Building A''s');
select t.ok(not (select (q->>'required')::boolean from jsonb_array_elements(public.my_checklist()->'questions') q where q->>'label' = 'Notes'), 'Building A change does not affect Lead B');
select t.ok(t.err($q$select public.submit_report('{"10000000-0000-0000-0000-000000000001":"yes","10000000-0000-0000-0000-000000000002":true,"10000000-0000-0000-0000-000000000003":"not_applicable"}')$q$) like '%required%', 'Lead B''s personal required question blocks only Lead B');
reset role;

-- ============================== Night Lead C (Building A, personal changes)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
set role authenticated;
select t.ok((select string_agg(q->>'label', '|' order by ord) from jsonb_array_elements(public.my_checklist()->'questions') with ordinality as x(q, ord))
  = 'Doors locked|Gym mopped|Floors|Notes', 'hidden question removed for Lead C only');
select t.ok(not (select (q->>'required')::boolean from jsonb_array_elements(public.my_checklist()->'questions') q where q->>'label' = 'Notes'), 'personal change beats group change');
reset role;

-- ============================== supervisor edits after a report was submitted
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
update questions set label = 'Restrooms cleaned?' where id = '10000000-0000-0000-0000-000000000001';
select t.ok((select count(*) from submissions where questions->0->>'label' = 'Restrooms checked?') = 2, 'old reports keep the wording the lead saw');
select t.ok((select count(*) from submissions) = 2, 'supervisor sees all reports');
delete from question_overrides where question_id = '10000000-0000-0000-0000-000000000004' and person_id = '00000000-0000-0000-0000-000000000005';
update profiles set role = 'rod' where id = '00000000-0000-0000-0000-000000000002';
select t.ok((select role from profiles where id = '00000000-0000-0000-0000-000000000002') = 'rod', 'supervisor can promote someone to supervisor');
update profiles set role = 'night_lead' where id = '00000000-0000-0000-0000-000000000002';
select t.ok(t.err($q$update profiles set role = 'night_lead' where id = auth.uid()$q$) like '%last_supervisor%', 'last supervisor cannot remove their own access');
update profiles set enabled = false where id = '00000000-0000-0000-0000-000000000005';
select t.ok((select count(*) from audit_events where action = 'profile_changed') >= 3, 'role and access changes are logged');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
set role authenticated;
select t.ok(t.err('select public.my_checklist()') like '%not_allowed%', 'disabled account cannot load a checklist');
select t.ok((select count(*) from groups) = 0, 'disabled account cannot read groups');
reset role;

-- Restore to shared: Lead C's notes follow Building A again (after re-enabling).
select set_config('request.jwt.claim.sub', '', false);
update profiles set enabled = true where id = '00000000-0000-0000-0000-000000000005';
select t.ok((select (q->>'required')::boolean from jsonb_array_elements(public.resolve_questions('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000005')) q where q->>'label' = 'Notes'), 'restoring a personal change lets the group setting apply again');

-- Existing Night Lead redeems an invite later.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
set role authenticated;
select t.ok(not public.redeem_rod_invite('WRONGCODE'), 'wrong invite code does nothing');
select t.ok(public.redeem_rod_invite('latercode123'), 'valid invite upgrades an existing account');
select t.ok(public.is_rod(), 'upgraded account is now a supervisor');
reset role;
select t.ok(public.current_shift_date() is not null, 'shift date is computed on the server');

-- ============================== supervisor notes and report comments
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
create temp table if not exists ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids select 'subA', id from submissions where lead_id = '00000000-0000-0000-0000-000000000003' and revision = 2;
select t.ok((public.add_report_comment((select v from ids where k = 'subA'), 'Please also check the gym doors')->>'body') like 'Please%', 'supervisor can comment on a report');
select t.ok((public.add_report_comment((select v from ids where k = 'subA'), 'Floors look wet?', '10000000-0000-0000-0000-000000000003')->>'question_id') is not null, 'supervisor can comment on one answer');
select t.ok(t.err($q$select public.add_report_comment((select v from ids where k = 'subA'), 'x', 'not-a-question')$q$) like '%invalid_question%', 'comment on a question not in the report is rejected');
select t.ok(t.err($q$select public.add_report_comment((select v from ids where k = 'subA'), '   ')$q$) like '%invalid_comment%', 'empty comment rejected');
insert into shift_notes (scope, body) values ('everyone', 'Note for everyone');
insert into shift_notes (scope, group_id, body) values ('group', '00000000-0000-0000-0000-0000000000a1', 'Note for Building A');
insert into shift_notes (scope, person_id, body) values ('person', '00000000-0000-0000-0000-000000000005', 'Note for Lead C');
insert into shift_notes (scope, body, expires_at) values ('everyone', 'Old note', now() - interval '1 hour');
select t.ok((select count(*) from shift_notes where created_by = auth.uid() and created_by_name = 'ROD A') = 4, 'notes record which supervisor wrote them');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select t.ok((select count(*) from report_comments where author_name = 'ROD A') = 2, 'Lead A sees the comments (with supervisor name) on their own report');
select t.ok((select count(*) from report_comments where read_by_lead_at is null) = 2, 'new comments start unread');
select public.mark_comments_read((select v from ids where k = 'subA'));
select t.ok((select count(*) from report_comments where read_by_lead_at is null) = 0, 'Lead A can mark them read');
select t.ok((public.add_report_comment((select v from ids where k = 'subA'), 'Done, doors checked')->>'author_id')::uuid = auth.uid(), 'Lead A can reply on their own report');
select t.ok(t.err($q$insert into report_comments (submission_id, lead_id, author_id, body) values ((select v from ids where k = 'subA'), auth.uid(), auth.uid(), 'x')$q$) like '%permission denied%', 'Lead A cannot write comments directly');
select t.ok(t.err($q$update report_comments set body = 'changed'$q$) like '%permission denied%', 'Lead A cannot edit supervisor comments');
select t.ok(t.err($q$delete from report_comments$q$) = '' and (select count(*) from report_comments) = 3, 'Lead A cannot delete comments');
select t.ok((select string_agg(body, '|' order by body) from shift_notes) = 'Note for Building A|Note for everyone', 'Lead A sees everyone + own group notes only (no expired, no others)');
select public.ack_note((select id from shift_notes where body = 'Note for everyone'));
select t.ok(t.err($q$select public.ack_note((select id from shift_notes where body = 'Note for Building A' limit 1))$q$) = '', 'Lead A can tap Got it');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select t.ok(t.err($q$select public.ack_note('00000000-0000-0000-0000-00000000ffff')$q$) like '%not_allowed%', 'cannot acknowledge a note that does not exist or is not yours');
select t.ok(t.err($q$insert into shift_notes (scope, body) values ('everyone', 'fake boss note')$q$) <> '', 'Lead A cannot post notes');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
set role authenticated;
select t.ok((select count(*) from report_comments) = 0, 'Lead C cannot see Lead A''s comments');
select t.ok((select count(*) from shift_notes) = 3, 'Lead C sees everyone, group and personal notes');
select t.ok(t.err($q$select public.ack_note((select id from shift_notes where body = 'Note for Lead C'))$q$) = '', 'Lead C acknowledges their personal note');
select t.ok(t.err($q$select public.add_report_comment((select v from ids where k = 'subA'), 'butting in')$q$) like '%not_allowed%', 'Lead C cannot comment on Lead A''s report');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select t.ok((select count(*) from note_acks) = 3, 'supervisor sees who tapped Got it');
select t.ok((select count(*) from report_comments where read_by_rod_at is null) = 1, 'supervisor sees the reply as unread');
select public.mark_comments_read((select v from ids where k = 'subA'));
select t.ok((select count(*) from report_comments where read_by_rod_at is null) = 0, 'supervisor can mark replies read');
reset role;
\echo ALL SQL TESTS PASSED
