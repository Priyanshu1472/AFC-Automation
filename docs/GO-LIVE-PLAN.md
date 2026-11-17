# Go-Live Plan — Staging → Production

> **Status: NOT STARTED. On hold until the pending staging fixes are done.** Nothing in this document has been done yet.
> When you're ready, send this file's content to Claude and it will carry out the steps in order.

---

## 1. Target setup (what we end up with)

| | **Staging (testing)** | **Production (live)** |
|---|---|---|
| URL | `staging--pmis-afc.netlify.app` | `pmis-afc.netlify.app` |
| Netlify | Same site **pmis-afc** — branch deploy of `staging` | Same site **pmis-afc** — production deploy of `main` |
| Supabase project | `afc-automation-dev` (current one, unchanged) | `afc-automation-prod` (currently empty) |
| Users / passwords | All real staff users stay here, same as now | Same real staff users, **same IDs and passwords** (copied over) |
| Modules | **All modules ON, always**, so staff can test everything | Only modules the admin has switched ON; the rest show a **"Coming Soon"** page |
| Demo / sample data | Stays here | **Not copied** |

No new Netlify site and no new user IDs are needed.

---

## 2. Decisions (confirmed 2026-11-01)

- [x] **Modules live first:** **BP Empanelment** and **Lead Approval** (the Leads module).
      Everything else (Proposals, Monitoring, Financials, Knowledge Repo) shows **"Coming Soon"** on production.
- [x] **Data copied to production:** **only the real staff users** (logins with the same IDs and passwords, plus their profile/role/team rows and signatures).
      **No** business records (applications, leads, proposals, invoices, KR entries) and **no** demo or sample data. Production starts empty apart from the users.
- [x] **Who controls the module ON/OFF switch:** **only the new Super Admin** (see section 3A). Admin, MD and everyone else can't.
- [x] **Super Admin login email:** `priyanshu.arora.afc+superadmin@gmail.com`

---

## 3A. Super Admin account (new role: `super_admin`)

One account for the owner. What it can do depends on the environment:

| | **Staging** | **Production** |
|---|---|---|
| Rights | **Everything.** Can override any workflow step, approve or decide in place of any role (DGM, MD, CFO, CS, PO, etc.), skip PIN/OTP gates, and edit or delete any record | **Module ON/OFF only.** No override powers, no workflow actions |
| Module Settings page | Visible, but for show only, since staging always has all modules on | **Visible. This is the only place modules get switched on** |

Implementation notes:
- Add `super_admin` as a new role. It's **not** pickable in Create User / Edit User. It gets created directly in the database, on **both** projects.
- The override powers are checked **on the server** (edge functions + RLS), not only hidden in the UI. Every check also requires the environment to be staging (a server-side secret `APP_ENV=staging`), so the overrides **can't work on production** even if the role exists there.
- Every override the Super Admin does is written to the **audit log** as "Super Admin override", including the role it acted as.
- This is the one account that exists on production without being a copied staff user. It's created fresh on prod (step 4B.6).

---

## 3. Module ON/OFF switch (with "Coming Soon")

**How it works**
- A new table in the database, `app_modules`, with columns `module_key`, `enabled`, `updated_by`, `updated_at`.
  It holds one row per module: `empanelment`, `leads`, `proposals`, `monitoring`, `financials`, `knowledge`.
- A new **Module Settings** page lets the **Super Admin only** turn modules ON/OFF. The change takes effect **right away, with no redeploy**.
- The app knows which environment it's in from a new env var, `VITE_APP_ENV` (`staging` / `production`):
  - **Staging:** every module is always ON, whatever the table says.
  - **Production:** a module that's OFF disappears from the navbar and home tiles. Opening any of its URLs directly (e.g. `/leads/123`) shows a **"Coming Soon"** page instead.
- **Backend guard:** the module's edge functions also refuse requests while it's OFF in production, so a hidden module can't be used through the API either.
- Public pages tied to a module (e.g. the Business Partner form `/ba-form`, `/empanelment/status`, `/empanelment/correction`) follow their module's switch.

**Route → module mapping**

| Module | Routes |
|---|---|
| Empanelment (**LIVE at launch**) | `/empanelment*`, `/dashboard/empanelment`, `/reports/empanelment`, `/ba-form` |
| Leads / Lead Approval (**LIVE at launch**) | `/leads*`, `/dashboard/leads`, `/reports/leads` |
| Proposals (Coming Soon) | `/proposals*` (incl. fee note) |
| Monitoring (Coming Soon) | `/monitoring*` |
| Financials (Coming Soon) | `/financials` |
| Knowledge Repo (Coming Soon) | `/knowledge*` |
| Always on | `/login`, password pages, `/home`, `/profile`, users/admin pages, `/audit-logs` |

This is built and tested on **staging first** (by switching `VITE_APP_ENV` to `production` locally), then shipped.

---

## 4. Execution steps (in order)

### A. Prepare production Supabase (`afc-automation-prod`)
1. Copy the **full schema** from the live dev database (tables, functions, triggers, RLS policies, enums, extensions) using a schema dump of the actual database. **Don't** rely on the migration history; it has drifted before.
2. Bring prod's migration history in line, so future migrations apply cleanly to both projects.
3. Create the **storage buckets** with the same policies.
4. Deploy **all edge functions** (`supabase/functions/*`) to prod.
5. Set the **edge function secrets** in prod (email/SMTP keys, `SUPPORT_EMAIL`, Turnstile secret, site URL, etc.). The site URL should be `https://pmis-afc.netlify.app`, so email links point to production, not staging.
6. **Auth settings:** Site URL = `https://pmis-afc.netlify.app`, plus redirect URLs, email templates, SMTP, password policy, the same as dev.
7. Recreate any **cron jobs / scheduled tasks** that exist in dev.

### B. Copy real users (same IDs and passwords)
1. Copy the real staff accounts from dev `auth.users` and `auth.identities` to prod, with the **same UUIDs and password hashes**. Logins stay exactly the same.
2. Copy their rows in `afc_users` (roles, teams, status), plus related tables they need (teams, committees, PINs, etc.).
3. Copy each user's **signature files** from storage (used on letters/notes).
4. **Exclude** the demo staff accounts. Copy **no** business records at all (no applications, leads, proposals, monitoring, invoices, KR entries, chats, audit logs).
5. Seed `app_modules` on prod: `empanelment` = ON, `leads` = ON, everything else = OFF.
6. Create the **Super Admin** account on prod and on staging (section 3A).
7. Reset the reference-number counters on prod (e.g. AFC/BA/…, lead numbers), so live numbering starts fresh.

### C. Netlify (same site `pmis-afc`)
1. Check that the **production branch = `main`** and that branch deploys are on for `staging`.
2. Set the env vars **per deploy context**:

   | Variable | Production context | Branch deploy (`staging`) |
   |---|---|---|
   | `VITE_SUPABASE_URL` | prod project URL | dev project URL |
   | `VITE_SUPABASE_ANON_KEY` | prod anon key | dev anon key |
   | `VITE_TURNSTILE_SITE_KEY` | same, or a prod key | current |
   | `VITE_APP_ENV` | `production` | `staging` |

3. Add `pmis-afc.netlify.app` to the Turnstile allowed domains, if it isn't there already.

### D. Ship code
1. Build the module switch on `staging` and get staff to test it there.
2. Merge `staging` → `main`. Netlify then deploys production.

### E. Verify on production
- [ ] A real staff member logs in with their **existing** password.
- [ ] Only Empanelment and Leads show; Proposals, Monitoring, Financials and Knowledge Repo show "Coming Soon", even when opened by direct URL.
- [ ] One full workflow in each launched module works end to end (incl. emails, PDFs, file uploads).
- [ ] Email links point to `pmis-afc.netlify.app`.
- [ ] Only the Super Admin sees Module Settings, and turning a module ON there makes it appear immediately.
- [ ] The Super Admin **can't** override workflow steps on production; it **can** on staging.
- [ ] Staging still works exactly as before, with all modules on.

---

## 5. After go-live (ongoing workflow)
- New work → `staging` branch → staff test on `staging--pmis-afc.netlify.app`.
- Ready → merge to `main` → production. Any **database migration** must be applied to **both** Supabase projects, and edge functions deployed to **both**.
- To launch the next module, the Super Admin switches it ON in Module Settings on production. No code change needed.
- New staff users must be created on **production** (and on staging too, if they need to test). The two projects don't sync automatically after the initial copy.
