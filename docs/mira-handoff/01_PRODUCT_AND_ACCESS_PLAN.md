# Product and access plan | Night Lead Hub

## Purpose
A tiny, reliable, private daily operations form for custodial Night Leads and a customizable supervisor dashboard. Supervisors check progress without having to chase handwritten paperwork; Night Leads complete daily reports with minimal typing. The website is not meant to give its originator control over coworkers.

## Actual roles (only two user-facing roles)
| Capability | Night Lead | ROD / Supervisor |
|---|---|---|
| Sign in, select language, replay relevant tutorial | Yes | Yes |
| Complete assigned daily checklist | Yes | Not required; may preview forms |
| View/edit own draft and see own prior reports | Yes | All permitted reports |
| View another lead's forms/submissions | No | Yes |
| Create/edit/reorder global questions | No | Yes |
| Assign a question to one lead | No | Yes |
| Override global question for one lead | No | Yes |
| Toggle mandatory/optional for global/personal question | No | Yes |
| Restore one lead's question to shared defaults | No | Yes |
| Manage access and staff invitation/revocation | No | Authorized ROD administrators only |
| View audit trail and export staff reports | No | Yes, within legitimate work scope |

**ROD and Supervisor mean the same role.** Multiple supervisors supported; Nora is the intended first operations owner. The site creator John is a Night Lead, not a permanent superuser. A hidden technical administrator for infrastructure setup must not mean Night Lead UI privileges.

## Data rules
Suggested logical entities:
- `users`: id, display_name, role (`night_lead` or `rod`), enabled, locale, assigned_school(s). No plaintext passwords.
- `checklist_templates`: id, version, school/area scope, title, status, updated_by, timestamp.
- `questions`: stable id, template_id, order, type (`checkbox`, `yes_no`, `text`, `status`), localized labels/help, required, enabled, allow_not_applicable.
- `question_overrides`: user_id + question_id unique, overridden display/required/enabled/order flags (NULL = inherit). Restore means DELETE override, not duplicate question.
- `personal_questions`: question id, assigned lead id, editable definition, optional school/area scope.
- `submissions`: id, lead_id, **shift_date**, template_version, submitted_at, status, immutable resolved questions & answers snapshot. Save later edits as revisions with audit trail, not silent mutation.
- `audit_events`: actor, action, target, time and least-necessary diffs. ROD sees authorized work events.

Global template updates affect FUTURE unsubmitted drafts, except fields with individual overrides. Submitted reports never silently change because a template changed. Handle a draft open while a ROD edits the template by showing a refresh/updated-template notice, or submit against a pinned version with backend validation. Keep rules deterministic. Never use a user's display name as the stable ID.

## Crucial form UX semantics
- A required field means **answer required**, not **must be good news**. “No,” “Needs attention,” and “Not completed” can be valid honest responses. They must never be forced to “Yes” to allow submission.
- A required checkbox cannot silently map untouched to `false`. Use explicit `Completed` and `Not completed` states, or another explicit answer UI, preserving an unanswered state.
- Yes/No answers must be explicit; status options may include `Done`, `Needs attention`, and an optional authorized `Not applicable`.
- Inline field error text, focus first error, no data lost on failed validation, disable duplicate submission, and show server-confirmed success with date/time.
- Optimistic offline draft saving is allowed, but **never tell the user it was submitted until the server acknowledges persistence**. Label unsent drafts as unsent.
- ROD builder controls: scope selector [Everyone / Specific Night Lead], choose person, question type, localized label(s), required toggle, enabled toggle, reorder, preview, publish, restore to shared. A person-specific change must not accidentally modify every employee.
- Night Lead default home: `Today's Shift` / `Start or Continue` / `Previous Reports` / `Help`. ROD default home: `Today’s Reports` / `Manage Checklists` / `Team` / `Help`.
- When staff work across midnight, use an explicit **shift date** in the school’s Dallas/Central timezone or configured site timezone. Do not derive work day blindly from midnight UTC.

## English / Spanish accessibility
- Visible language selector at sign-in and within settings; remember setting by user.
- Two short guided tours with large Next/Back/Finish buttons, selected by actual role, with replay available.
- Translate static UI, error messages, defaults and tutorials. ROD-written custom questions should support English and Spanish labels; if untranslated, show a clear fallback, not invented machine translations silently.
- Accessible controls: keyboard focus indicators, semantic labels, WCAG-sized touch targets (~44px), contrast, screen reader states, no color-only statuses, iPhone Safari portrait checks. Avoid tiny table editing on mobile.

## Identity and privacy
- This is private workplace operations data. Do not put real staff/student data or passwords into shared public demo fixtures.
- If using a custom account/password solution, require a server-managed identity provider or securely implemented account backend: slow salted hash (Argon2id or vetted equivalent), rate limiting, expiring single-use reset/invite tokens, secure session cookies, CSRF protection where applicable, and server-checked scopes. Never store passwords, reset tokens, or authorization logic in browser localStorage.
- A role toggle in the demo is **not** authorization. Authorize every data read/write server-side, including direct API calls and exports.
- ROD approval and operational control must be transferred through verified provider access, not only a UI display name. Verify Nora's role assignment outside this file.
- Log authorization and configuration changes, avoid retaining secrets and sensitive free-text unnecessarily. Confirm Uplift's information handling policy before use with actual employees.

## Not in scope for launch
Payroll/disciplinary actions, location tracking, student information, unrestricted employer surveillance, or giving Night Leads supervisor abilities. These require separate authorization and are not needed for a daily operations checklist.
