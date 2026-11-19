import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChecklistTable, parseType, checklistTable, templateRows} from '../js/checklist-io.js';
import {translator} from '../js/i18n.js';

test('import: a file with headers in any order', () => {
  const {items, skipped} = parseChecklistTable([
    ['Answer type', 'Question (English)', 'Required', 'Question (Spanish)', 'Allow "Doesn\'t apply"'],
    ['Yes / No', 'Restrooms checked?', 'Yes', '¿Baños revisados?', 'no'],
    ['Status (Done / Needs attention)', 'Floors', 'yes', 'Pisos', 'YES'],
    ['Short text', 'Shift notes', 'No', '', ''],
    ['', 'Doors locked', '', '', ''],
  ]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(items, [
    {type: 'yes_no', label: 'Restrooms checked?', label_es: '¿Baños revisados?', required: true, allow_na: false},
    {type: 'status', label: 'Floors', label_es: 'Pisos', required: true, allow_na: true},
    {type: 'text', label: 'Shift notes', label_es: null, required: false, allow_na: false},
    {type: 'checkbox', label: 'Doors locked', label_es: null, required: true, allow_na: false},
  ]);
});

test('import: a plain list with no headers becomes checkmark questions', () => {
  const {items} = parseChecklistTable([['Lock the front doors'], ['Check the question box in the lobby'], [''], ['Turn off the lights']]);
  assert.deepEqual(items.map(q => [q.label, q.type, q.required]), [
    ['Lock the front doors', 'checkbox', true], ['Check the question box in the lobby', 'checkbox', true], ['Turn off the lights', 'checkbox', true]]);
});

test('import: Spanish headers and words work', () => {
  const {items, skipped} = parseChecklistTable([
    ['Pregunta (inglés)', 'Pregunta (español)', 'Tipo de respuesta', 'Obligatoria', 'Permitir "No aplica"'],
    ['Trash taken out', 'Basura sacada', 'Sí / No', 'Sí', 'Sí'],
    ['Notes', 'Notas', 'Texto corto', 'No', ''],
  ]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(items, [
    {type: 'yes_no', label: 'Trash taken out', label_es: 'Basura sacada', required: true, allow_na: true},
    {type: 'text', label: 'Notes', label_es: 'Notas', required: false, allow_na: false},
  ]);
});

test('import: bad rows are skipped with a reason, good rows still come in', () => {
  const {items, skipped} = parseChecklistTable([
    ['Question', 'Answer type'],
    ['Doors locked', 'Checkmark'],
    ['', 'Yes / No'],
    ['Alarm set', 'Dropdown'],
    ['doors LOCKED', 'Checkmark'],
    ['Already there', ''],
    ['x'.repeat(301), ''],
  ], {existingLabels: ['Already there']});
  assert.deepEqual(items.map(q => q.label), ['Doors locked']);
  assert.deepEqual(skipped.map(s => [s.row, s.reason]), [[3, 'no_question'], [4, 'bad_type'], [5, 'duplicate'], [6, 'duplicate'], [7, 'too_long']]);
});

test('import: "Doesn\'t apply" is only kept for Yes/No and Status questions', () => {
  const {items} = parseChecklistTable([['Question', 'Type', 'Required', 'Allow n/a'], ['A', 'checkmark', 'yes', 'yes'], ['B', 'text', '', 'yes']]);
  assert.deepEqual(items.map(q => q.allow_na), [false, false]);
  assert.equal(items[1].required, false, 'text questions are optional unless marked required');
});

test('import: empty or blank files give nothing', () => {
  assert.deepEqual(parseChecklistTable([]), {items: [], skipped: []});
  assert.deepEqual(parseChecklistTable([['', ''], []]), {items: [], skipped: []});
  assert.equal(parseType('whatever'), null);
});

test('download then import gives back the same checklist, in English and Spanish', () => {
  const list = [
    {type: 'checkbox', label: 'Doors locked', label_es: 'Puertas cerradas', required: true, allow_na: false},
    {type: 'yes_no', label: 'Restrooms checked?', label_es: null, required: true, allow_na: true},
    {type: 'status', label: 'Floors, "main" hall', label_es: 'Pisos', required: false, allow_na: false},
    {type: 'text', label: '=Notes', label_es: 'Notas', required: false, allow_na: false},
  ];
  for (const lang of ['en', 'es']) {
    const {headers, rows} = checklistTable(list, translator(lang));
    assert.deepEqual(parseChecklistTable([headers, ...rows]), {items: list, skipped: []}, lang);
    const tpl = templateRows(translator(lang));
    assert.equal(parseChecklistTable([tpl.headers, ...tpl.rows]).items.length, 4, lang + ' template');
  }
});
