// Checklist import and download for supervisors.
// A checklist file is a simple table (Excel or CSV), one question per row:
//   Question (English) | Question (Spanish) | Answer type | Required | Allow "Doesn't apply"
// The same layout is used for the download, so a downloaded file can be edited and imported again.
import {loadScript, download, toCsv} from './export.js';

export const TYPES = ['checkbox', 'yes_no', 'status', 'text'];

const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Words a supervisor might type for each answer type, in English or Spanish.
const TYPE_WORDS = {
  checkbox: ['checkbox', 'checkmark', 'check', 'completed', 'completed not completed', 'done not done', 'casilla', 'marca', 'completado', 'completado no completado'],
  yes_no: ['yes no', 'yes_no', 'yesno', 'y n', 'si no', 'si o no', 'yes or no'],
  status: ['status', 'done needs attention', 'needs attention', 'estado', 'listo necesita atencion', 'necesita atencion'],
  text: ['text', 'short text', 'note', 'notes', 'comment', 'texto', 'texto corto', 'nota', 'notas', 'comentario'],
};
const YES = ['yes', 'y', 'true', '1', 'x', 'si', 's', 'required', 'obligatoria', 'obligatorio'];
const NO = ['no', 'n', 'false', '0', '', 'optional', 'opcional'];

// Which column a header belongs to. Checked in this order, so "Question (Spanish)" is not taken for the English column.
const HEADER_RULES = [
  ['label_es', h => /\b(spanish|espanol|es)\b/.test(h)],
  ['type', h => /\b(type|tipo|answer|respuesta)\b/.test(h)],
  ['required', h => /\b(required|obligatori[ao]|must)\b/.test(h)],
  ['allow_na', h => /\b(apply|aplica|n a|na)\b/.test(h)],
  ['label', h => /\b(question|pregunta|english|ingles|item|task|tarea|label)\b/.test(h)],
];

export function parseType(v) {
  const w = norm(v);
  if (!w) return 'checkbox';
  for (const [type, words] of Object.entries(TYPE_WORDS)) if (words.includes(w)) return type;
  // Friendly names from the download look like "Yes / No" or "Status (Done / Needs attention)".
  if (w.startsWith('yes') || w.startsWith('si ')) return 'yes_no';
  if (w.startsWith('status') || w.startsWith('estado')) return 'status';
  if (w.startsWith('check') || w.startsWith('marca') || w.startsWith('casilla')) return 'checkbox';
  if (w.includes('text') || w.includes('texto')) return 'text';
  return null;
}

function parseBool(v, fallback) {
  const w = norm(v);
  if (v === true) return true;
  if (v === false) return false;
  if (YES.includes(w)) return true;
  if (NO.includes(w)) return w === '' ? fallback : false;
  return fallback;
}

/**
 * Turns a table (array of rows, first row may be headers) into questions.
 * @returns {{items: Array, skipped: Array<{row:number, reason:string, text:string}>}}
 *   reason is one of: 'no_question', 'too_long', 'bad_type', 'duplicate'.
 */
export function parseChecklistTable(rows, {existingLabels = []} = {}) {
  const table = (rows || []).map(r => (Array.isArray(r) ? r : []).map(c => (c === null || c === undefined ? '' : String(c).trim())));
  const firstData = table.findIndex(r => r.some(c => c !== ''));
  if (firstData < 0) return {items: [], skipped: []};
  // Header row: at least one cell is a known column name and none looks like a long sentence.
  const head = table[firstData].map(norm);
  const cols = {};
  head.forEach((h, i) => {
    if (!h) return;
    for (const [key, test] of HEADER_RULES) if (cols[key] === undefined && test(h)) { cols[key] = i; break; }
  });
  // It only counts as a header row when two columns are recognised, or the cell is just the word "Question".
  const plainHeader = ['question', 'questions', 'pregunta', 'preguntas', 'item', 'task', 'tarea'].includes(head[cols.label] ?? '');
  const hasHeader = Object.keys(cols).length >= 2 || (cols.label !== undefined && plainHeader);
  let start = firstData;
  if (hasHeader) {
    start = firstData + 1;
    if (cols.label === undefined) cols.label = head.findIndex((h, i) => !Object.values(cols).includes(i));
  } else {
    // No headers: use the standard column order.
    for (const k of Object.keys(cols)) delete cols[k];
    Object.assign(cols, {label: 0, label_es: 1, type: 2, required: 3, allow_na: 4});
  }
  const seen = new Set(existingLabels.map(norm));
  const items = [], skipped = [];
  for (let i = start; i < table.length; i++) {
    const r = table[i];
    if (!r.some(c => c !== '')) continue;
    const cell = k => (cols[k] === undefined || cols[k] < 0 ? '' : r[cols[k]] ?? '');
    const label = cell('label');
    const rowNo = i + 1;
    if (!label) { skipped.push({row: rowNo, reason: 'no_question', text: r.filter(Boolean).join(' · ').slice(0, 80)}); continue; }
    if (label.length > 300 || cell('label_es').length > 300) { skipped.push({row: rowNo, reason: 'too_long', text: label.slice(0, 80)}); continue; }
    const type = parseType(cell('type'));
    if (!type) { skipped.push({row: rowNo, reason: 'bad_type', text: `${label.slice(0, 60)} (${cell('type')})`}); continue; }
    if (seen.has(norm(label))) { skipped.push({row: rowNo, reason: 'duplicate', text: label.slice(0, 80)}); continue; }
    seen.add(norm(label));
    const canNa = type === 'yes_no' || type === 'status';
    items.push({type, label, label_es: cell('label_es') || null, required: parseBool(cell('required'), type !== 'text'), allow_na: canNa ? parseBool(cell('allow_na'), false) : false});
  }
  return {items, skipped};
}

/** The table that gets downloaded (and can be imported again). */
export function checklistTable(list, t) {
  const typeName = {checkbox: t('typeCheckbox'), yes_no: t('typeYesNo'), status: t('typeStatus'), text: t('typeText')};
  const yn = v => (v ? t('yes') : t('no'));
  const headers = [t('ioColQuestion'), t('ioColSpanish'), t('ioColType'), t('ioColRequired'), t('ioColNa')];
  const rows = list.map(q => [q.label, q.label_es || '', typeName[q.type], yn(q.required), q.type === 'yes_no' || q.type === 'status' ? yn(q.allow_na) : '']);
  return {headers, rows};
}

/** Four example rows, one per answer type, for the blank template. */
export function templateRows(t) {
  return checklistTable([
    {type: 'checkbox', label: t('ioExample1'), label_es: t('ioExample1Es'), required: true, allow_na: false},
    {type: 'yes_no', label: t('ioExample2'), label_es: t('ioExample2Es'), required: true, allow_na: false},
    {type: 'status', label: t('ioExample3'), label_es: t('ioExample3Es'), required: true, allow_na: true},
    {type: 'text', label: t('ioExample4'), label_es: t('ioExample4Es'), required: false, allow_na: false},
  ], t);
}

async function xlsx() {
  await loadScript('vendor/xlsx.full.min.js');
  return window.XLSX;
}

export async function downloadChecklist(format, {headers, rows}, filename) {
  if (format === 'csv') {
    download(new Blob([toCsv(headers, rows)], {type: 'text/csv;charset=utf-8'}), filename + '.csv');
    return;
  }
  const X = await xlsx();
  const ws = X.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{wch: 46}, {wch: 46}, {wch: 34}, {wch: 12}, {wch: 22}];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Checklist');
  download(new Blob([X.write(wb, {bookType: 'xlsx', type: 'array'})], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), filename + '.xlsx');
}

/** Reads an Excel or CSV file picked by the supervisor into rows of text. */
export async function readTableFile(file) {
  if (file.size > 2 * 1024 * 1024) throw Object.assign(new Error('too big'), {code: 'file_too_big'});
  const X = await xlsx();
  const buf = await file.arrayBuffer();
  let wb;
  try {
    wb = /\.(csv|txt)$/i.test(file.name) ? X.read(new TextDecoder('utf-8').decode(buf), {type: 'string', raw: true}) : X.read(buf, {type: 'array'});
  } catch { throw Object.assign(new Error('unreadable'), {code: 'file_unreadable'}); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error('unreadable'), {code: 'file_unreadable'});
  return X.utils.sheet_to_json(sheet, {header: 1, raw: false, defval: '', blankrows: false});
}
