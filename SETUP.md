# Putting Night Lead Hub online (about 20 minutes, free)

You need two free accounts: **Supabase** (logins, password-reset emails, database) and
**GitHub** (hosts the website). No ChatGPT or Claude account is needed by anyone who uses the site.

## 1. Create the Supabase project
1. Go to <https://supabase.com>, sign up, and click **New project**.
   - Name: `night-lead-hub`. Pick a strong database password and save it somewhere safe.
   - Region: the one closest to Texas (for example *East US* or *Central US*).
2. Wait for the project to finish setting up (about 2 minutes).

## 2. Create the database
1. In Supabase, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repository, copy **all** of it, paste it, and click **Run**.
   It should end with "Success. No rows returned". (Running it again later is safe.)

## 3. Make the first supervisor invite code (for Nora)
In the SQL Editor, run:
```sql
select public.create_rod_invite(1, 14, 'Nora');
```
It prints a 12-character code. Send it to Nora privately (text or in person, not in a group chat).
She enters it in **"I'm a supervisor (ROD)"** when she creates her account. After that, Nora can
make codes for other supervisors from the **Team** tab. John and other Night Leads just sign up
without a code.

## 4. Login and email settings
In Supabase, **Authentication**:
- **Sign In / Providers → Email**: keep *Email* on and *Confirm email* on.
- **URL Configuration**: set **Site URL** to the website address from step 5
  (for example `https://YOUR-GITHUB-NAME.github.io/night-lead-hub/`) and add the same address under
  **Redirect URLs**. Without this, the confirm and password-reset links won't come back to the site.
- **Emails**: Supabase's built-in email sender is limited to a few emails per hour and is meant for
  testing. For a team, add a free SMTP sender (for example Resend or Brevo) under **SMTP Settings**,
  otherwise sign-up and reset emails may be delayed.
- Optional: **Policies → Password strength** to require longer passwords.

## 5. Connect the website to Supabase
1. In Supabase, open **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
   (The anon key is meant to be public. Never copy the `service_role` key anywhere.)
2. In this repository, edit `js/config.js` and paste them:
   ```js
   window.NLH_CONFIG = {
     supabaseUrl: 'https://xxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',
   };
   ```
3. Commit the change.

## 6. Publish with GitHub Pages
1. In the GitHub repository: **Settings → Pages**.
2. Source: **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute the site address appears at the top of that page. Put it in step 4's URL settings.

GitHub Pages sites from a **private** repository need a paid GitHub plan. If you're on the free plan,
either make the repository public (the code has no passwords or secrets in it; all data stays in
Supabase behind the login), or use Netlify or Cloudflare Pages (free; connect the repo, no build command,
publish directory `/`).

## 7. Try it before inviting the team
1. Create a test Night Lead account with your own email. Fill in and send a checklist.
2. Have Nora create her supervisor account with her code. She should see your report under **Reports**.
3. Nora: **Checklists** → replace the sample questions with the real list, set up groups in **Team**.
4. Then share the website link with the Night Leads.

## Who controls what
- **Supervisors (Nora and anyone she promotes)** control everything: checklists, groups, people,
  supervisor codes, reports and downloads.
- **Night Leads (including John)** only fill in their own checklist and see their own reports.
- The **Supabase project owner** (whoever created the account in step 1) can still change anything in the
  database. Once Nora is set up, consider adding her as a member of the Supabase project
  (Organization → Team) so the team doesn't depend on one person's account.

## Backups
The free Supabase plan doesn't include automatic backups you can restore yourself. Supervisors can download
Excel copies of reports at any time from **Reports**. For a full copy, Supabase → **Database → Backups**
(paid) or run a `pg_dump` from **Project Settings → Database**.
