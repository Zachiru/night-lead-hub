# Integration instructions for Claude or a developer

## Inventory
- `src/checklist_rules.mjs`: pure reference functions, not a full website.
- `fixtures/synthetic_config.json`: fake test data, never use as Uplift's checklist.
- `tests/checklist_rules.test.mjs`: Node built-in test runner, no package installation.
- `Night_Lead_Hub_OFFLINE_DEMO.html`: separate offline demo of the intended interaction (if supplied), with local-only storage and role toggles. **Never deploy it as the live workplace site.**

## Run tests
```sh
node --test tests/checklist_rules.test.mjs
```

## Proposed integration contract
```js
const effective = effectiveChecklist({template, leadId: authenticatedUser.id, overrides, personalQuestions});
const checked = validateSubmission(effective, request.answers);
// SERVER: verify session, role, leadId, assigned schools, version, open shift,
// duplicate rules, and database transactions. Reject unauthorized requests.
if (!checked.ok) return {status: 422, errors: checked.errors};
const snapshot = createSubmissionSnapshot({checklist: effective, answers: checked.normalized,
  shiftDate: request.shiftDate, submittedAt: new Date().toISOString()});
// SERVER: persist snapshot transactionally. Only then respond with success.
```

### Reference implementation details
- The reference engine intentionally does NOT read files, connect to a database, implement user identity, or modify the website.
- `template.questions` are shared; `overrides[leadId][questionId]` may set `label`, `label_es`, `required`, `enabled`, `order`, `helpText`, or `allowNotApplicable`. Unsupported override fields reject.
- `personalQuestions[leadId]` adds lead-only tasks. Shared question IDs must be unique in the effective form.
- `restoreSharedQuestion(overrides, leadId, questionId)` deletes only that person's override.
- Allowed answers: `checkbox` explicit boolean true/false; `yes_no` 'yes'/'no'; `text` string <= 3000 chars; `status` 'done'/'needs_attention'. `not_applicable` only where `allowNotApplicable` true.
- `validateSubmission` rejects fields that are hidden/unassigned/unknown, and does **not** confuse a false/negative report with omission. Backend must also block forged lead ID and unauthorized template state.
- `createSubmissionSnapshot` captures the resolved fields and values; backend should attach audit actor, immutable ID, hash/version and transaction result.
- `reportSummary` counts explicit negative checkbox answers and needs-attention statuses without deciding that every 'no' is a fault.

### Behavior to adapt to actual codebase
- Do not assume the current Work site's frontend/backend stack is Node. Port these semantics into its existing server if appropriate. Do not use this reference module as a client-side security boundary.
- A real account system needs server-side role authorization, invitation/reset/approval and persistent storage. A fake role dropdown must never become an authentication solution.
- Bind checklist submissions to server-resolved authenticated user IDs, never trusted user-supplied person IDs.
- Template roll-forward should be versioned. Handle ROD edits while a lead has an open draft explicitly.
- For large deployments, use per-school scoping and report query indexes.
- Preserve existing checklist wording and all beneficial implemented work; merge missing behavior only.

## Difference between known, reported, and verified
Known: active site record + published URL + saved sign-in copy. Reported in Work chat: custom account flow, question builder, English/Spanish switch, tutorials. Verified here: pure-module unit tests only (25/25). Integration/deployment remain separate steps.
