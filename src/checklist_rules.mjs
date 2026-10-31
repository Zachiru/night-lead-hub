/**
 * Night Lead Hub: dependency-free reference for checklist resolution and validation.
 * Synthetic data only. Integration support, NOT the deployed website or an auth layer.
 * All authorization must be enforced on a trusted server, independent of these UI rules.
 */
export const TYPES = Object.freeze(['checkbox', 'yes_no', 'text', 'status']);
const ALLOWED_OVERRIDE_FIELDS = new Set(['label', 'label_es', 'required', 'enabled', 'order', 'helpText', 'allowNotApplicable']);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function assertQuestion(question) {
  if (!isPlain(question) || typeof question.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(question.id)) throw new Error('Invalid question id');
  if (typeof question.label !== 'string' || !question.label.trim()) throw new Error(`Question ${question.id}: missing label`);
  if (!TYPES.includes(question.type)) throw new Error(`Question ${question.id}: invalid type`);
  if (question.label_es !== undefined && typeof question.label_es !== 'string') throw new Error(`Question ${question.id}: invalid Spanish label`);
  if (typeof question.required !== 'boolean') throw new Error(`Question ${question.id}: required must be boolean`);
  if (question.enabled !== undefined && typeof question.enabled !== 'boolean') throw new Error(`Question ${question.id}: enabled must be boolean`);
  if (question.order !== undefined && !Number.isFinite(question.order)) throw new Error(`Question ${question.id}: invalid order`);
  if (question.allowNotApplicable !== undefined && typeof question.allowNotApplicable !== 'boolean') throw new Error(`Question ${question.id}: invalid N/A flag`);
  return question;
}

/**
 * Precedence (lowest to highest): shared template -> per-lead override;
 * targeted personal questions are added only for their lead.
 * The result is an immutable snapshot, not an authorization decision.
 * @param {{template:{version:string|number,questions:Array},leadId:string,overrides?:Object,personalQuestions?:Object}} input
 */
export function effectiveChecklist({template, leadId, overrides = {}, personalQuestions = {}}) {
  if (!isPlain(template) || !Array.isArray(template.questions)) throw new Error('Invalid template');
  if (typeof leadId !== 'string' || !leadId) throw new Error('Missing leadId');
  const changes = overrides[leadId] || {};
  const extras = personalQuestions[leadId] || [];
  if (!isPlain(changes) || !Array.isArray(extras)) throw new Error('Invalid per-lead changes');
  const ids = new Set();
  const questions = [];
  for (const base of [...template.questions, ...extras]) {
    assertQuestion(base);
    if (ids.has(base.id)) throw new Error(`Duplicate question id: ${base.id}`);
    ids.add(base.id);
    // Per-lead overrides affect only shared questions; personal questions are themselves lead-scoped.
    const override = template.questions.includes(base) ? (changes[base.id] || {}) : {};
    if (!isPlain(override)) throw new Error(`Invalid override: ${base.id}`);
    for (const [field, val] of Object.entries(override)) {
      if (!ALLOWED_OVERRIDE_FIELDS.has(field)) throw new Error(`Unsupported override field: ${field}`);
      if ((field === 'required' || field === 'enabled' || field === 'allowNotApplicable') && typeof val !== 'boolean') throw new Error(`Invalid boolean override: ${field}`);
      if (field === 'order' && !Number.isFinite(val)) throw new Error('Invalid override order');
      if ((field === 'label' || field === 'label_es' || field === 'helpText') && typeof val !== 'string') throw new Error(`Invalid override text: ${field}`);
    }
    const result = {...base, ...override};
    assertQuestion(result);
    if (result.enabled === false) continue;
    questions.push(Object.freeze({...result, source: template.questions.includes(base) ? 'shared' : 'personal'}));
  }
  questions.sort((a,b) => (a.order ?? 0)-(b.order ?? 0) || a.id.localeCompare(b.id));
  return Object.freeze({templateVersion: template.version ?? null, leadId, questions: Object.freeze(questions)});
}

/** A true restore removes only the selected override, allowing future shared changes to flow through. */
export function restoreSharedQuestion(overrides, leadId, questionId) {
  const next = structuredClone(overrides || {});
  if (next[leadId] && hasOwn(next[leadId], questionId)) delete next[leadId][questionId];
  if (next[leadId] && Object.keys(next[leadId]).length === 0) delete next[leadId];
  return next;
}

function missing(value) { return value === undefined || value === null || value === ''; }
export function validateSubmission(checklist, answers) {
  if (!checklist || !Array.isArray(checklist.questions) || !isPlain(answers)) throw new Error('Invalid submission payload');
  const errors = {};
  const normalized = {};
  const allowed = new Set(checklist.questions.map(q => q.id));
  for (const answerId of Object.keys(answers)) if (!allowed.has(answerId)) errors[answerId] = 'Question not available in this checklist';
  for (const q of checklist.questions) {
    const original = answers[q.id];
    if (missing(original) || (q.type === 'text' && typeof original === 'string' && !original.trim())) {
      if (q.required) errors[q.id] = 'Response required';
      continue;
    }
    if (q.type === 'text') {
      if (typeof original !== 'string' || original.length > 3000) errors[q.id] = 'Enter text (maximum 3000 characters)';
      else normalized[q.id] = original.trim();
    } else if (q.type === 'checkbox') {
      // Explicit true AND explicit false are answers. Absence is not false.
      if (typeof original !== 'boolean') errors[q.id] = 'Choose completed or not completed';
      else normalized[q.id] = original;
    } else if (q.type === 'yes_no') {
      if (original === 'yes' || original === 'no' || (q.allowNotApplicable === true && original === 'not_applicable')) normalized[q.id] = original;
      else errors[q.id] = 'Choose yes or no';
    } else if (q.type === 'status') {
      if (original === 'done' || original === 'needs_attention' || (q.allowNotApplicable === true && original === 'not_applicable')) normalized[q.id] = original;
      else errors[q.id] = 'Choose a status';
    }
  }
  return {ok: Object.keys(errors).length === 0, errors, normalized};
}

/** Returns a stable record for the backend to store, not a claim of successful database persistence. */
export function createSubmissionSnapshot({checklist, answers, shiftDate, submittedAt}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) throw new Error('shiftDate must be YYYY-MM-DD');
  const validation = validateSubmission(checklist, answers);
  if (!validation.ok) return {ok:false, errors:validation.errors};
  return {ok:true, record:{leadId:checklist.leadId, shiftDate, templateVersion:checklist.templateVersion, submittedAt,
    questions:checklist.questions.map(q=>({...q, answer:hasOwn(validation.normalized,q.id) ? validation.normalized[q.id] : null}))}};
}

export function reportSummary(record) {
  if (!record || !Array.isArray(record.questions)) throw new Error('Invalid report');
  return {
    total:record.questions.length,
    answered:record.questions.filter(q=>q.answer !== null && q.answer !== undefined).length,
    needsAttention:record.questions.filter(q=>q.type === 'status' && q.answer === 'needs_attention').length,
    notCompleted:record.questions.filter(q=>q.type === 'checkbox' && q.answer === false).length,
  };
}
