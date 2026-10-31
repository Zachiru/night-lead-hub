# Night Lead Hub

A small, phone-friendly website for daily night-shift checklists.

- **Night Leads** sign up, fill in a short checklist each night (big buttons, a little typing), and see their own past reports.
- **Supervisors (ROD)** see everyone's reports, who hasn't sent one yet, and any problems; edit the checklist for
  everyone, a group, or one person; manage the team; and download reports as **Excel, CSV or PDF**.
- English and Spanish, with a short tour for each role.
- Nobody needs a ChatGPT or Claude account: just an email and a password.

Everyone who signs up is a Night Lead. Supervisor access needs an invite code from an existing supervisor
(the first one is made during setup for Nora), so nobody can make themselves a boss.

**Try it:** open `index.html` through any web server with `js/config.js` left empty to get **demo mode**
(sample data in your browser only). **Put it online:** follow [SETUP.md](SETUP.md).

## How it's built
| Part | What it does |
|---|---|
| `index.html`, `css/`, `js/` | The website. Plain HTML/JS, no build step. Works on GitHub Pages, Netlify, etc. |
| `supabase/schema.sql` | Database, permission rules, and server-side checklist checks. Run once in Supabase. |
| `src/checklist_rules.mjs` | Mira's checklist rules (unchanged), reused for answer checking. |
| `js/rules.js` | Builds each person's checklist: shared → group change → personal change. |
| `vendor/` | Bundled libraries: Supabase client, SheetJS (Excel), jsPDF (PDF). |

Permissions are enforced by the database (row-level security and server functions), not by hiding buttons:
a Night Lead can't read other people's reports, edit checklists, or make themselves a supervisor even by
calling the API directly. Old reports keep the exact questions and wording the lead saw.

## Tests
```sh
npm test            # checklist logic (incl. Mira's 25 tests) + database security tests (needs PostgreSQL 16)
npm run test:e2e    # real pages in Chromium at phone size, demo mode (needs Playwright)
```
