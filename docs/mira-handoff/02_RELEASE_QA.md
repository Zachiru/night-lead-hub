# Release QA and pilot gate

**Reference code automated check:** `node --test tests/checklist_rules.test.mjs` -> 25/25 PASS on Node 22, 2026-10-30.
**Production end-to-end, login, data sync, physical iPhone:** NOT TESTED HERE.

## Must-pass release scenarios
- [ ] Captured URL resolves to the expected newest deployment. If the live login still reads ChatGPT sign-in, reconcile with claimed custom account login before inviting anyone.
- [ ] ROD A invited safely; ROD B invited and independently sees authorized team reports.
- [ ] Night Lead A can sign in, start a draft, submit, reopen own history, sign out/in and recover persisted submission from another device.
- [ ] Night Lead A cannot see/modify ROD editor or another Lead B's reports by UI **or directly calling endpoints**. HTTP 403/404 as appropriate.
- [ ] Night Lead A cannot self-promote by tampering with role fields, route names, JWT contents, or request bodies.
- [ ] ROD can add shared checkbox, yes/no, text, and status questions, reorder them, mark mandatory/optional, preview and publish.
- [ ] Global edit reaches all eligible Night Leads' **future** forms.
- [ ] ROD can target Lead B only; Lead A remains unchanged.
- [ ] Lead B override of a global question stays independent as shared question evolves; restoring it makes new global changes apply.
- [ ] Required targeted text omitted blocks submission for Lead B **only**; form stays filled, focuses error, supplies helpful message.
- [ ] `No` on required yes/no passes; explicitly `Not completed` on required check passes; an **untouched** check does not pass.
- [ ] Status `Needs attention` remains valid and visible as an issue; `N/A` is allowed only where enabled.
- [ ] Hidden/disabled question submitted by forged request is rejected. Unexpected question IDs rejected. Foreign lead IDs rejected.
- [ ] Template changes after prior report do not rewrite previously submitted answers or their question wording.
- [ ] Concurrent updates and double-tap submit do not create duplicates or lose data. Report revisions show actor/timestamps.
- [ ] Work night that crosses midnight is associated with intended shift date in America/Chicago, including DST transitions.
- [ ] Required fields verified on the **server**, not only in the browser.
- [ ] ROD reports can filter by day, person and status; Night Lead report query is restricted to self.
- [ ] Password reset tokens are single-use and expire; login failures do not expose account enumeration; brute-force is limited.
- [ ] Revoked/disabled Night Lead and ROD sessions are refused on subsequent protected actions.
- [ ] Logout invalidates session appropriately; no cached sensitive report visible after re-login as a different staff account.
- [ ] English and Spanish switch applies to tutorials, field validation, buttons and statuses; missing custom translations fall back visibly.
- [ ] ROD tutorial differs from Night Lead tutorial; neither exposes unauthorized functions.
- [ ] iPhone Safari at 390px (and smaller) displays touch-friendly choices and does not require horizontal scrolling.
- [ ] Keyboard accessibility, labels, focus ring, contrast and screen reader accessible errors verified.
- [ ] Backup/rollback available; deployment tagged, owner/Nora have documented ops access.

## Pilot before giving to Nora
1. Use fictional Lead A, Lead B, ROD A, ROD B, not actual staff records.
2. Both roles each finish onboarding, one daily report and one per-lead customization round-trip.
3. Verify server data and isolation after refreshing and switching devices.
4. Request Nora's feedback on the actual list and daily flow, then move into a small authorized pilot.
5. Only after acceptance, transfer supervisor operations to appropriate ROD accounts and remove any accidental Night Lead admin power.
