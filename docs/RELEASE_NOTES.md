# Night Lead Hub v0.2 (2026-10-31): notes, comments, easier to use

**Status: built and tested locally. NOT online yet.** It needs a Supabase project and hosting (see SETUP.md).
If you already ran `supabase/schema.sql` for v0.1, run it again. It's safe to re-run and adds the new tables.

## New in v0.2
- **Comments on reports:** supervisors add a note on a whole report or on one answer. The Night Lead who sent it
  sees it (with a "New note" badge) and can reply. Nobody else can see it.
- **Pinned notes:** supervisors post a note for everyone, a group, or one person ("starting tonight…"). It shows at
  the top of the Night Lead's Today screen with a big "Got it ✓" button, and supervisors see who has read it.
- **Easier for everyone:** bigger text, ✓/✗/⚠ on answer buttons, an "x of y answered" counter, badges on tabs,
  the phone's back button moves between tabs, and quick Today / 7 days / 30 days buttons for supervisors.
- **Better tutorial:** 8 short illustrated steps per role, including iPhone or Android steps to put the site on
  the home screen. The Help tab has common questions and home-screen instructions.
- **Home-screen app:** app icon and manifest, so it opens full screen like an app on iPhone and Android.
- **Fixed:** switching Spanish → English didn't save, so the next sign-in came up in Spanish.

## History and privacy
Every report is kept, including each "change and send again" version. Night Leads see only their own reports
and comments. Supervisors see all of them. The database enforces this, not just the screens (see tests).

## Tested (automated, all passing)
| Area | Result |
|---|---|
| Mira's checklist rules | 25/25 |
| New logic + export + translations | 19/19 |
| Browser vs database give identical checklists | 1/1 (14 cases) |
| Database security (PostgreSQL 16 + Supabase stand-in) | 83/83 checks (v0.1 notes said 62; the real count was 56) |
| Real pages in Chromium at 390px and 320px, demo mode | 7/7 |

## Not tested yet
- **Real Supabase**: logins, confirm and reset emails, and the site talking to a real project.
- **Real iPhone (Safari) and Android phones**: tested in Chromium at phone sizes only. Safari's engine wasn't available here.
- **Spanish wording**: written by Claude; a native speaker should check it.
- **Real checklist**: only sample questions are included.

---

# v0.1 (2026-10-31): standalone version

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
| Database security (PostgreSQL 16 + Supabase stand-in) | 56/56 checks |
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
