# Chase CRM

This repo holds only Chase CRM. Everything deploys from `main` to Cloudflare:

| Part | What | Lives in | Deploys as |
|---|---|---|---|
| **Chase CRM** | The customer-tracking app for the six MTN dealer stores | `shelly-app/public/` (source) → `site/` (built) | `chase-crm` worker (`wrangler.jsonc`) |
| **Chase API** | A safe, metered API on the same data for spreadsheets, bots and scripts | `api/` | `chase-api` worker (`api/wrangler.jsonc`) |
| **Database** | Supabase: five tables + row-level security + rules | `supabase/` | run in Supabase → SQL Editor |

## One repo per app

This repo is **only** Chase CRM and the Chase API. Every push to `main` here redeploys
the `chase-crm` worker, so nothing else should live here.

- **CL Academy**, the Live Poll and the `/refs` page moved (with their history) to their own repo,
  [Brad-H-tech/-cl-academy](https://github.com/Brad-H-tech/-cl-academy), which deploys the `cl-academy` worker.
- **Old experiments** (petrol tracker, phone finder, portfolio, VECTRFL page, the early Chase demos) were
  taken off `main` on 2026-10-08. Nothing is lost: every branch as it stood on 2026-10-02 is kept under
  `backup/<branch>-2026-10-02`.
- **New project?** Create a new, empty GitHub repo for it first and start the Claude session on *that* repo,
  so it never lands here as another branch.

## Start here

- `docs/API-GUIDE.md` — what an API is and how to use this one (for newcomers).
- `docs/API-REQUIREMENTS.md` — every requirement, where it is met, which test proves it.
- `docs/SECURITY.md` — threat model, the live-project audit, controls, and the dashboard settings still to click.
- `docs/COST-CONTROLS.md` — where the free tiers get spent and every budget knob.

## The database, simplified

```
stores    the six shops + Admin — and each shop's WhatsApp template, quotes, report number, last MTN check
profiles  one row per person who can sign in (manager | consultant, their store, their name in the base)
bases     each monthly upload (the customer list)
tracking  each customer's outcome, callback, note, activities, history — and who owns them
claims    "can I have this customer?" requests
```

Fresh project: run `supabase/schema.sql`. Existing 7-table project: run
`supabase/migrations/2026-09-26_simplify.sql` (keeps every row). Then `api/sql/001_api.sql` for the API.

## Build and test

```bash
python3 supabase/build_site.py                 # rebuild site/index.html from the app + adapter (commit the result)
(cd api && node --test)                        # API behaviour tests
python3 supabase/build_site.py --mock \
  && node supabase/test_sb.js                  # the app end-to-end in a real browser (needs playwright + chromium)
node supabase/test_login.js                    # the sign-in flow + Start-here card
node supabase/test_admin.js                    # column check on upload, store allocation, messages by store
```

CI (`.github/workflows/ci.yml`) runs the API tests and refuses a push whose `site/` build is stale.
