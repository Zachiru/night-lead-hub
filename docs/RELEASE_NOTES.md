# Night Lead Hub v0.1 (2026-10-31): standalone version

**Status: built and tested locally. NOT online yet.** It needs a Supabase project and hosting (see SETUP.md).

## What changed from Mira's handoff
- Rebuilt as a standalone website, so nobody needs ChatGPT or any AI account. The original ChatGPT-hosted
  site (night-lead-hub-jeb…chatgpt.site) was not changed. Its source couldn't be accessed from here.
- Mira's checklist rules (`src/checklist_rules.mjs`) are used unchanged for answer checking. Her 25 tests still pass.
- Added: email/password accounts, password reset, supervisor invite codes, groups (everyone / group / one person
  changes), server-side permissions, saved reports with revisions, Excel/CSV/PDF downloads, EN/ES, role tours.

## Tested (all automated, all passing)
| Area | Result |
|---|---|
| Mira's checklist rules | 25/25 |
| New logic + export + translations | 19/19 |
| Browser vs database give identical checklists | 1/1 (14 cases) |
| Database security (PostgreSQL 16 + Supabase stand-in) | 62/62 checks |
| Real pages in Chromium at 390px and 320px, demo mode | 6/6 |

Database security checks include: Night Leads can't see others' reports, read or edit checklists, change their own
role or group, write reports directly, call internal functions, see invite codes, or wipe tables. Sign-up can't
request supervisor. Expired or used codes give a Night Lead. The last supervisor can't be removed. Disabled accounts
are refused. Old reports keep their original wording. Double-taps don't duplicate.

## Not tested yet
- **Real Supabase**: logins, confirm and reset emails, and the site talking to a real project. The database rules were
  tested on plain PostgreSQL with a stand-in for Supabase's login system, not on Supabase itself.
- **iPhone Safari**: tested in Chromium at phone size only. WebKit wasn't available here.
- **Spanish wording**: written by Claude; a native speaker should check it.
- **Real checklist**: only sample questions are included. The team's real list must be entered by a supervisor.

## Known limits
- Free Supabase email sending is slow and limited. Use an SMTP sender for a whole team (SETUP.md step 4).
- Drafts are kept on the phone until sent. Clearing browser data loses an unsent draft.
- The shift date uses America/Chicago with a 6 AM cutoff (changeable in the `app_settings` table).
