# NIGHT LEAD HUB | CLAUDE HANDOFF
**Prepared:** 2026-10-30 (America/Chicago)  
**Owner:** John Edward Balderas (Night Lead)  
**Intended primary ROD:** Nora. Other ROD/supervisors are allowed.  
**Status:** Reference code and handoff READY; **published website NOT changed or fully verified**.

## Existing live site (DO NOT overwrite blindly)
- URL: https://night-lead-hub-jeb.magicyak4096.chatgpt.site
- Library-backed published site metadata: project `appgprj_6ae4ec6304c48191aacde7ac7eeabdfb`, slug `night-lead-hub-jeb`, `status=active`, `source_version_number=2` at time inspected.
- Available saved UI text: “Night Lead Operations Hub,” “Overview,” “Checklist,” “Reports,” “Uplift Education · Night Operations,” and “Please sign in with ChatGPT.”
- An external page fetch did not retrieve its live contents; source code, backend, account database, and live behavior were not accessible for inspection here.
- A Work-chat summary from 2026-10-30 says a custom account/password-recovery flow was developed to replace ChatGPT/Google/Microsoft sign-in, and form-builder features (four response types, shared/individual changes, English/Spanish switch, two tutorials) were underway or reportedly in place. **These claims are not independently verified against the deployed page.** The saved page copy still showed ChatGPT sign-in.
- No matching Night Lead Hub GitHub repository was found among the owner's installed repositories. This package is not a patch to a known repository.

## Owner's locked product decisions
1. Night Leads fill in a short, button-first daily checklist, mixing checkmarks, yes/no, status buttons, and short typed fields.
2. ROD and supervisor are ONE ROLE, not two. ROD/supervisors can see submitted reports and design/edit forms, globally or for one specific lead.
3. A Night Lead (including John) must NOT have ROD powers. John does not want to be the lasting site administrator merely because he initiated the project.
4. Nora is the primary intended ROD but not the only possible supervisor.
5. ROD can add/remove/reorder questions, change required/optional, and target a change to one lead or everyone. An individual override can be restored to the shared template.
6. A separate, simple, short onboarding tutorial appears for Night Leads vs RODs; English and Spanish are priority languages, more can follow.
7. Ease of use matters more than fancy design. Mobile/iPhone-first, no redundant steps, clear confirmation after real saves.
8. Preserve the original Work-chat checklist tasks where present. This package contains **synthetic demonstration tasks only** because original item wording was not available here.

## What I completed in this handoff sprint
- `src/checklist_rules.mjs`: dependency-free reference logic for effective shared + per-lead checklist, targeted personal questions, restore-to-shared, answer validation, immutable submission snapshot, and report summary.
- `tests/checklist_rules.test.mjs`: **25 automated tests, 25 passed** using Node 22. None uses real employee data.
- `fixtures/synthetic_config.json`: clearly labeled fake lead/question configuration.
- `01_PRODUCT_AND_ACCESS_PLAN.md`: detailed roles, data model, flows and important UX/security rules.
- `02_RELEASE_QA.md`: acceptance/penetration/manual iPhone testing checklist.
- `03_INTEGRATION.md`: suggested integration steps and limitations.
- `CLAUDE_COPY_PASTE.md`: immediate next action for Claude without re-explaining the project.
- `Night_Lead_Hub_OFFLINE_DEMO.html` (if present): reference browser demo, local-only, not the Work production app.

## What is not done or not proven
- No edit to the actual ChatGPT-hosted Work project or its backend. This tool session cannot access its editable source.
- No proof that real sign-in, password-reset emails, server-side RBAC, invitations, approvals, persistent storage, migrations, or submission isolation are working.
- No physical device testing and no Nora approval/ownership transfer.
- No real staff roster or original checklist imported. Do NOT fabricate those.

## Mandatory Claude next steps, in order
1. Open the original WORK project and inspect the actual source, deployed URL, auth backend, DB schema and current revisions. Export/backup original first, with a reversible rollback.
2. Resolve the mismatch: the captured public site says “Sign in with ChatGPT,” but the Work thread claims custom accounts were built. Determine what version is actually deployed.
3. Reconcile and integrate the reference checklist logic with the existing form-builder. Never replace good working source just because this handoff has a reference module.
4. Implement **server-side** ROD vs Night Lead access checks and per-lead report scoping; enforce in API and database policies, not just hidden buttons.
5. Make per-person required/optional overrides effective on submission, and persist the resolved checklist version/snapshot with each report.
6. Finish password reset/invite/approval flows, accessibility, iPhone screen test, and two tutorials + EN/ES fallback. Fix actual bugs, not hypothetical ones.
7. Smoke test with synthetic Lead A, Lead B, ROD A and ROD B accounts. Create an actual Night Lead and ROD pilot only with authorized staff participation.
8. Obtain Nora's acceptance and transfer operational ROD ownership/admin control to authorized supervisors. John retains only his Night Lead access unless formally authorized otherwise.
9. Deliver final working URL, deployment/version ID, tested login credentials through a **secure out-of-band** channel (not in docs), changelog and known issues.

**Do not claim production is complete based on passing reference tests.**
