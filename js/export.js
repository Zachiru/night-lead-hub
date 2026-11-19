// Report downloads for supervisors: Excel (.xlsx), CSV and PDF.
// The Excel and PDF libraries are bundled in /vendor and loaded only when needed.

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export function formatAnswer(q, t) {
  const a = q.answer;
  if (a === null || a === undefined || a === '') return '';
  if (q.type === 'checkbox') return a === true ? t('completed') : t('notCompleted');
  if (a === 'yes') return t('yes');
  if (a === 'no') return t('no');
  if (a === 'done') return t('done');
  if (a === 'needs_attention') return t('needsAttention');
  if (a === 'not_applicable') return t('naChoice'); // same words as the button the Night Lead tapped
  return String(a);
}

export function formatTime(iso, lang, timeZone = 'America/Chicago') {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', {timeZone, dateStyle: 'short', timeStyle: 'short'}).format(new Date(iso));
}

const qLabel = (q, lang) => (lang === 'es' && q.label_es) ? q.label_es : q.label;

/** Turns reports into one row per report (questions as columns) and one row per answer. */
export function buildTables(reports, {people, groups, lang, t, comments = []}) {
  const person = id => people.find(p => p.id === id);
  const groupName = id => groups.find(g => g.id === id)?.name || '';
  const columns = [];
  for (const r of reports) for (const q of r.questions) {
    if (!columns.some(c => c.id === q.id)) columns.push({id: q.id, label: qLabel(q, lang)});
  }
  // Notes written on a report (by supervisors, and replies), as one cell: "Name: text" per line.
  const notesFor = r => comments.filter(c => c.submission_id === r.id).map(c => {
    const about = c.question_id ? r.questions.find(q => q.id === c.question_id) : null;
    return `${c.author_name || '?'}${about ? ` (${qLabel(about, lang)})` : ''}: ${c.body}`;
  }).join('\n');
  const baseHeaders = [t('shiftDate'), t('nameCol'), t('group'), t('sentAt'), '#', t('answeredCol'), t('needsAttention'), t('notCompleted')];
  const wideHeaders = [...baseHeaders, ...columns.map(c => c.label), t('notesCol')];
  const wide = reports.map(r => {
    const p = person(r.lead_id);
    const byId = Object.fromEntries(r.questions.map(q => [q.id, formatAnswer(q, t)]));
    return [r.shift_date, p?.display_name || '?', groupName(p?.group_id), formatTime(r.submitted_at, lang), r.revision,
      `${r.answered}/${r.total}`, r.needs_attention, r.not_completed, ...columns.map(c => byId[c.id] ?? ''), notesFor(r)];
  });
  const longHeaders = [t('shiftDate'), t('nameCol'), t('group'), t('sentAt'), '#', t('question'), t('answer')];
  const long = [];
  for (const r of reports) {
    const p = person(r.lead_id);
    for (const q of r.questions) long.push([r.shift_date, p?.display_name || '?', groupName(p?.group_id), formatTime(r.submitted_at, lang), r.revision, qLabel(q, lang), formatAnswer(q, t)]);
  }
  return {wideHeaders, wide, longHeaders, long, notesFor};
}

/** CSV cell. Cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers, rows) {
  return '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportReports(format, reports, ctx) {
  const {wideHeaders, wide, longHeaders, long, notesFor} = buildTables(reports, ctx);
  const name = `night-lead-reports_${ctx.from}_${ctx.to}`;
  if (format === 'csv') {
    download(new Blob([toCsv(wideHeaders, wide)], {type: 'text/csv;charset=utf-8'}), name + '.csv');
  } else if (format === 'xlsx') {
    await loadScript('vendor/xlsx.full.min.js');
    const X = window.XLSX;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([wideHeaders, ...wide]), 'Reports');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([longHeaders, ...long]), 'Answers');
    const out = X.write(wb, {bookType: 'xlsx', type: 'array'});
    download(new Blob([out], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), name + '.xlsx');
  } else if (format === 'pdf') {
    await loadScript('vendor/jspdf.umd.min.js');
    await loadScript('vendor/jspdf.plugin.autotable.min.js');
    const doc = new window.jspdf.jsPDF({orientation: 'portrait', unit: 'pt', format: 'letter'});
    doc.setFontSize(14);
    doc.text(`${ctx.t('reportsTitle')}: ${ctx.from} – ${ctx.to}`, 40, 40);
    let y = 60;
    for (const r of reports) {
      const p = ctx.people.find(x => x.id === r.lead_id);
      const title = `${r.shift_date} · ${p?.display_name || '?'} · ${ctx.t('sentAt')} ${formatTime(r.submitted_at, ctx.lang)}${r.revision > 1 ? ' · #' + r.revision : ''}`;
      doc.autoTable({
        startY: y, head: [[{content: title, colSpan: 2}], [ctx.t('question'), ctx.t('answer')]],
        body: [...r.questions.map(q => [qLabel(q, ctx.lang), formatAnswer(q, ctx.t)]), ...(notesFor(r) ? [[ctx.t('notesCol'), notesFor(r)]] : [])],
        styles: {fontSize: 9, cellPadding: 4}, headStyles: {fillColor: [31, 58, 96]}, margin: {left: 40, right: 40},
      });
      y = doc.lastAutoTable.finalY + 16;
    }
    if (!reports.length) doc.text(ctx.t('noReportsFound'), 40, 70);
    download(doc.output('blob'), name + '.pdf');
  }
}
