// Checklist logic shared by the browser and the demo backend.
// The live database has the same logic in supabase/schema.sql (resolve_questions and
// submit_report); tests/parity.test.mjs checks that both give identical results.
import {validateSubmission, reportSummary} from '../src/checklist_rules.mjs';

const pickOverride = (fields, ...layers) => {
  for (const layer of layers) if (layer && layer[fields] !== null && layer[fields] !== undefined) return layer[fields];
  return undefined;
};

/**
 * Builds a checklist for a group and/or person.
 * Precedence: shared question < group change < personal change.
 * @param {{questions:Array, overrides:Array, groupId?:string|null, personId?:string|null, includeHidden?:boolean}} input
 */
export function resolveQuestions({questions, overrides = [], groupId = null, personId = null, includeHidden = false}) {
  const out = [];
  for (const q of questions) {
    const applies = q.scope === 'everyone'
      || (q.scope === 'group' && groupId && q.group_id === groupId)
      || (q.scope === 'person' && personId && q.person_id === personId);
    if (!applies) continue;
    const go = groupId ? overrides.find(o => o.question_id === q.id && o.group_id === groupId) : null;
    const po = personId ? overrides.find(o => o.question_id === q.id && o.person_id === personId) : null;
    const field = f => pickOverride(f, po, go, q) ?? null;
    out.push({
      id: q.id, type: q.type, scope: q.scope,
      label: field('label'), label_es: field('label_es'),
      required: field('required'), enabled: field('enabled'), allow_na: field('allow_na'),
      sort_order: Number(field('sort_order')),
      group_override_id: go ? go.id : null, person_override_id: po ? po.id : null,
    });
  }
  out.sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return includeHidden ? out : out.filter(q => q.enabled);
}

const toRules = questions => ({
  questions: questions.map(q => ({id: q.id, type: q.type, label: q.label, required: !!q.required, allowNotApplicable: !!q.allow_na})),
});

/** Browser-side check before sending. The server repeats it; this only gives faster feedback. */
export function checkAnswers(questions, answers) {
  const clean = {};
  for (const [k, v] of Object.entries(answers || {})) if (questions.some(q => q.id === k)) clean[k] = v;
  const result = validateSubmission(toRules(questions), clean);
  const errors = {};
  for (const [id, msg] of Object.entries(result.errors)) errors[id] = msg === 'Response required' ? 'required' : 'invalid';
  return {ok: result.ok, errors, normalized: result.normalized, answers: clean};
}

export function summarize(snapshotQuestions) {
  return reportSummary({questions: snapshotQuestions.map(q => ({...q, answer: q.answer ?? null}))});
}

/** Night shift date in a time zone: work before `cutoffHour` belongs to the previous date. */
export function shiftDate(now = new Date(), timeZone = 'America/Chicago', cutoffHour = 6) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const local = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour));
  local.setUTCHours(local.getUTCHours() - cutoffHour);
  return local.toISOString().slice(0, 10);
}

/** Label in the chosen language, with a visible marker when the Spanish text is missing. */
export function labelFor(q, lang) {
  if (lang === 'es') return q.label_es ? {text: q.label_es, fallback: false} : {text: q.label, fallback: true};
  return {text: q.label, fallback: false};
}
