-- Loads fixtures/parity.json and prints resolve_questions() output for comparison with js/rules.js.
\set fx `cat ../../fixtures/parity.json`
truncate questions, question_overrides, submissions cascade;
delete from profiles; delete from auth.users; delete from groups;
insert into groups (id, name) select (g->>'id')::uuid, g->>'name' from jsonb_array_elements((:'fx'::jsonb)->'groups') g;
insert into auth.users (id, email) select (p->>'id')::uuid, (p->>'id') || '@test.invalid' from jsonb_array_elements((:'fx'::jsonb)->'people') p;
update profiles pr set group_id = (p->>'group_id')::uuid from jsonb_array_elements((:'fx'::jsonb)->'people') p where pr.id = (p->>'id')::uuid;
insert into questions (id, scope, group_id, person_id, type, label, label_es, required, enabled, allow_na, sort_order)
  select (x->>'id')::uuid, x->>'scope', (x->>'group_id')::uuid, (x->>'person_id')::uuid, x->>'type', x->>'label', x->>'label_es',
         (x->>'required')::boolean, (x->>'enabled')::boolean, (x->>'allow_na')::boolean, (x->>'sort_order')::numeric
  from jsonb_array_elements((:'fx'::jsonb)->'questions') x;
insert into question_overrides (id, question_id, group_id, person_id, label, label_es, required, enabled, allow_na, sort_order)
  select (x->>'id')::uuid, (x->>'question_id')::uuid, (x->>'group_id')::uuid, (x->>'person_id')::uuid, x->>'label', x->>'label_es',
         (x->>'required')::boolean, (x->>'enabled')::boolean, (x->>'allow_na')::boolean, (x->>'sort_order')::numeric
  from jsonb_array_elements((:'fx'::jsonb)->'overrides') x;
select jsonb_build_object('case', 'everyone', 'hidden', h, 'out', resolve_questions(null, null, h)) from (values (true), (false)) v(h);
select jsonb_build_object('case', 'group:' || (g->>'id'), 'hidden', h, 'out', resolve_questions((g->>'id')::uuid, null, h))
  from jsonb_array_elements((:'fx'::jsonb)->'groups') g, (values (true), (false)) v(h);
select jsonb_build_object('case', 'person:' || (p->>'id'), 'hidden', h, 'out', resolve_questions((p->>'group_id')::uuid, (p->>'id')::uuid, h))
  from jsonb_array_elements((:'fx'::jsonb)->'people') p, (values (true), (false)) v(h);
