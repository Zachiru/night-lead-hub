import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveQuestions, checkAnswers, shiftDate, labelFor} from '../js/rules.js';
import {csvCell, toCsv, buildTables, formatAnswer} from '../js/export.js';
import {translator} from '../js/i18n.js';

const fx = JSON.parse(readFileSync(new URL('../fixtures/parity.json', import.meta.url), 'utf8'));
const P = id => fx.people.find(p => p.id.endsWith(id));
const forPerson = (id, hidden = false) => resolveQuestions({questions: fx.questions, overrides: fx.overrides, groupId: P(id).group_id, personId: P(id).id, includeHidden: hidden});
const labels = qs => qs.map(q => q.label);

test('equal sort order falls back to id order', () => assert.deepEqual(labels(resolveQuestions({questions: fx.questions})), ['A', 'C', 'Notes']));
test('group change applies to the whole group', () => assert.deepEqual(labels(resolveQuestions({questions: fx.questions, overrides: fx.overrides, groupId: P('011').group_id})), ['Group notes', 'A', 'C', 'G1 only']));
test('personal change beats group change and keeps the rest of the group change', () => {
  const n = forPerson('012').find(q => q.label === 'Group notes');
  assert.equal(n.required, false); assert.equal(n.sort_order, 5); assert.equal(n.label_es, 'Notas grupo');
});
test('personal hide removes a question for that person only', () => {
  assert.ok(!labels(forPerson('011')).includes('A'));
  assert.ok(labels(forPerson('012')).includes('A'));
});
test('group can show a question hidden for everyone', () => assert.ok(labels(forPerson('013')).includes('B')));
test('personal question only for its person', () => {
  assert.equal(labels(forPerson('013'))[0], 'P13 only');
  assert.ok(!labels(forPerson('014')).includes('P13 only'));
});
test('person without a group gets only shared questions', () => assert.deepEqual(labels(forPerson('014')), ['A', 'C', 'Notes']));
test('hidden questions are listed for supervisors when asked', () => assert.ok(labels(forPerson('011', true)).includes('A')));
test('override marks are reported', () => {
  const n = forPerson('012').find(q => q.label === 'Group notes');
  assert.ok(n.group_override_id && n.person_override_id);
});

test('checkAnswers: honest negatives accepted, untouched required rejected', () => {
  const qs = forPerson('014');
  const ok = checkAnswers(qs, {[qs[0].id]: 'no', [qs[1].id]: 'needs_attention'});
  assert.equal(ok.ok, true);
  const bad = checkAnswers(qs, {[qs[0].id]: 'no'});
  assert.equal(bad.errors[qs[1].id], 'required');
});
test('checkAnswers drops answers for questions no longer on the list', () => {
  const qs = forPerson('014');
  const r = checkAnswers(qs, {[qs[0].id]: 'yes', [qs[1].id]: 'done', gone: 'x'});
  assert.equal(r.ok, true); assert.ok(!('gone' in r.answers));
});

test('shift date: 2am Chicago counts as the previous night', () => assert.equal(shiftDate(new Date('2026-11-03T08:00:00Z')), '2026-11-02'));
test('shift date: 10pm Chicago is that day', () => assert.equal(shiftDate(new Date('2026-11-03T04:00:00Z')), '2026-11-02'));
test('shift date: 7am Chicago is the new day', () => assert.equal(shiftDate(new Date('2026-11-03T13:00:00Z')), '2026-11-03'));
test('shift date across DST end (Nov 1 2026)', () => assert.equal(shiftDate(new Date('2026-11-01T07:30:00Z')), '2026-10-31'));

test('Spanish label falls back to English visibly', () => {
  assert.deepEqual(labelFor({label: 'A', label_es: null}, 'es'), {text: 'A', fallback: true});
  assert.deepEqual(labelFor({label: 'A', label_es: 'Á'}, 'es'), {text: 'Á', fallback: false});
});

test('CSV cells that look like formulas are neutralized', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.ok(toCsv(['h'], [['v']]).startsWith('﻿h\r\nv'));
});
test('export tables: one row per report, one row per answer, answers translated', () => {
  const t = translator('es');
  const report = {lead_id: 'p1', shift_date: '2026-11-02', submitted_at: '2026-11-03T04:00:00Z', revision: 1, total: 2, answered: 2, needs_attention: 1, not_completed: 1,
    questions: [{id: 'q1', type: 'checkbox', label: 'Doors', label_es: 'Puertas', answer: false}, {id: 'q2', type: 'status', label: 'Floors', label_es: null, answer: 'needs_attention'}]};
  const out = buildTables([report], {people: [{id: 'p1', display_name: 'Lead', group_id: 'g'}], groups: [{id: 'g', name: 'G'}], lang: 'es', t});
  assert.deepEqual(out.wideHeaders.slice(-3, -1), ['Puertas', 'Floors']);
  assert.deepEqual(out.wide[0].slice(-3, -1), ['No completado', 'Necesita atención']);
  assert.equal(out.wideHeaders.at(-1), 'Notas en el reporte');
  assert.equal(out.wide[0].at(-1), '');
  const noted = buildTables([{...report, id: 's1'}], {people: [], groups: [], lang: 'en', t: translator('en'),
    comments: [{submission_id: 's1', question_id: 'q2', author_name: 'Nora', body: 'Check again'}, {submission_id: 'other', author_name: 'X', body: 'no'}]});
  assert.equal(noted.wide[0].at(-1), 'Nora (Floors): Check again');
  assert.equal(out.long.length, 2);
  assert.equal(formatAnswer({type: 'yes_no', answer: 'not_applicable'}, t), 'N/A');
});
test('every Spanish string exists for every English key', async () => {
  const {STRINGS} = await import('../js/i18n.js');
  for (const k of Object.keys(STRINGS.en)) assert.ok(k in STRINGS.es, 'missing es: ' + k);
  assert.equal(STRINGS.es.tourLead.length, STRINGS.en.tourLead.length);
});
