# Chase API — requirements and how each one is met

This is the contract for the Chase API: what it must do, and the proof that it does.
Every requirement has an ID, the place in the code that satisfies it, and the automated test
that would fail if it stopped being true. Run the proof yourself:

```bash
cd api && node --test          # API behaviour (worker + fake Supabase)
python3 supabase/build_site.py --mock && node supabase/test_sb.js   # the app end-to-end in a real browser
```

Status key: **Met** = implemented and covered by a test · **Met (manual)** = implemented, verified by hand ·
**Open** = not built yet, with the recommended next step.

---

## 1. Purpose

Chase is a customer-tracking app for six MTN dealer stores. Until now the only way in was the
app itself. The API lets *other things* reach the same data safely: a spreadsheet that pulls
the daily numbers, a WhatsApp bot that logs "no answer", a head-office report, or a future
mobile app. It sits between callers and Supabase and adds what Supabase alone cannot give a
third party: named keys, per-store limits, budgets, an audit trail and a stable, documented shape.

```
   Excel / bot / script ──► Chase API (Cloudflare Worker) ──► Supabase (Postgres + RLS)
   Chase app (user token) ─┘        auth · scope · limit             api.* functions
```

## 2. Functional requirements

| ID | Requirement | How it is met | Evidence | Status |
|---|---|---|---|---|
| F1 | Expose the Chase book (customers of the active base, joined with outcomes and owners) with search and paging | `api.book()` + `api.customers()` in `api/sql/001_api.sql`; route `GET /v1/customers` in `api/src/routes.js` | `search customers with filters`, `customer pages are capped at 200` | Met |
| F2 | Read one customer with full activity and outcome history | `api.customer()`; `GET /v1/customers/:acct` | `account numbers are sanitised and unknown customers are 404` | Met |
| F3 | Record outcomes with callback date and note; keep a history of outcome changes automatically | `api.set_outcome()` writes `hist` (cap 25); `PUT /v1/customers/:acct/outcome` | `record an outcome: history is written…` | Met |
| F4 | Log activities (WhatsApp, call, no answer, SMS, email) | `api.log_activity()` (cap 30); `POST /v1/customers/:acct/activities` | `log an activity → 201` | Met |
| F5 | Add walk-in customers to the active base | `api.add_walkin()`; `POST /v1/customers` | `walk-in needs a name; success returns the new account` | Met |
| F6 | Claims: raise, list, decide; approving makes the claimant the owner | `api.raise_claim()`, `api.decide_claim()`; `/v1/claims…` | `claims: raise, duplicate → 409, decide…` | Met |
| F7 | Ownership: list overrides, assign to a consultant, un-assign, hand back to the base | `api.assign()`; `/v1/assignments` | `assignments: list overrides; "" = nobody; null = base decides` | Met |
| F8 | Bases: list metadata cheaply, page rows, upload a new active base | `api.bases()`, `api.base_rows()`, `api.load_base()`; `/v1/bases…` | `bases: metadata only, then paged rows, then a new upload becomes active` | Met |
| F9 | Store settings (WhatsApp template, quotes, report number) read and write | `/v1/settings` on the `stores` row | `settings: read for read scope, write for manage only…` | Met |
| F10 | KPI summary per store computed server-side | `api.summary()`; `GET /v1/reports/summary` | `summary report comes from the database` | Met |
| F11 | Create logins for consultants/managers *without* public sign-ups | `POST /v1/users` uses the Auth admin endpoint and inserts the profile, rolling back on failure | `create a login without public sign-ups…` | Met |
| F12 | Both kinds of caller: API keys for systems, Supabase user tokens for the app | `api/src/auth.js` | `a Supabase user token is accepted…` | Met |
| F13 | Machine-readable spec and human docs that cannot drift from the code | `api/src/openapi.js` generates both from `ROUTES` | `openapi.json lists every route…`, `docs page is HTML…` | Met |
| F14 | Work with the simplified 5-table database (settings on `stores`, owner on `tracking`) | `supabase/schema.sql`, `supabase/migrations/2026-09-26_simplify.sql`, adapter `supabase/chase-supabase.js` | browser suite: 30/30 pass on the new layout | Met |

## 3. Security requirements

| ID | Requirement | How it is met | Evidence | Status |
|---|---|---|---|---|
| S1 | Every data endpoint requires authentication | dispatcher in `api/src/index.js` calls `authenticate()` for every route with `auth !== false` | `no key → 401 and it is audited`, `garbage token → 401` | Met |
| S2 | Secrets are never stored or transmitted to the database; only a SHA-256 hash | worker hashes the secret, `api.authenticate()` compares hashes; `api.mint_key()` stores only the hash | `wrong secret → 401 (hash compared, secret never sent…)`, `create a key: secret shown once…` | Met |
| S3 | Keys can be revoked instantly and can expire | `active` / `expires_at` checked on every call | `revoked and expired keys → 401 with a reason`, `revoke a key: takes effect at once…` | Met |
| S4 | Least privilege: read / write / manage scopes; a key can never grant more than its creator has | `route.scope` check; `POST /v1/keys` intersects scopes with the caller's | `a read key cannot write`, `a write key cannot manage`, `create a key: … scopes cannot exceed` | Met |
| S5 | Store isolation: a store key can only ever touch its own store; head office must name a store | store resolution in the dispatcher | `a store key cannot look at another store`, `a store key is pinned…`, `a head-office key must name the store` | Met |
| S6 | App users keep row-level security: their profile is read under *their* token, never the service key | `db.profileFromJwt()` | `a Supabase user token is accepted…` (asserts the token used) | Met |
| S7 | All input validated and clamped before the database is touched (codes, dates, lengths, ids) | helpers in `api/src/security.js` used by every route | `outcome codes, dates and activity types are checked…`, `ids must be UUIDs`, `over-long text is trimmed…` | Met |
| S8 | The database itself refuses bad data even if the worker or app is bypassed | CHECK constraints, partial unique indexes and the `tracking_guard` trigger in `supabase/schema.sql` | migration dry-run on the live project; `a database rule violation → 422…` | Met |
| S9 | Only managers can change who owns a customer or mark a Won as MTN-verified, even via direct REST calls | `chase.guard_tracking()` trigger (previously any consultant could) | migration dry-run; adapter omits those columns from consultant saves | Met (manual) |
| S10 | Helper functions are not callable from the public REST API (Supabase advisor finding) | moved to schema `chase`, `EXECUTE` revoked from `anon`; the `api` schema grants nothing to anon/authenticated | Supabase security advisor: 0028/0029 resolved after migration | Met (manual) |
| S11 | Anonymous callers see only store names, never templates or the report phone number | column-level `GRANT SELECT (id,name,sort)` to `anon` on `stores` | migration | Met (manual) |
| S12 | Errors never leak internals (table names, SQL, stack traces) | `publicError()` mapping in `api/src/db.js` | `a database rule violation → 422 without leaking…`, `database timeout → 504, unexpected error → 500, neither leaks` | Met |
| S13 | Hardened HTTP: no-store, nosniff, no framing, HSTS, CSP, noindex on every response; strict CSP on the docs page | `securityHeaders()`; docs route | `every response carries the security headers…`, `docs page … strict CSP and no scripts` | Met |
| S14 | Browser access only from named origins; never `*` | `corsHeaders()` reads `CHASE_ALLOWED_ORIGINS` | `allowed origin gets CORS headers; others get none` | Met |
| S15 | Brute-force resistance: per-IP floor before authentication | `RATE_IP_PER_MINUTE` | `per-IP floor applies before authentication` | Met |
| S16 | Audit trail of every write and every refusal (who, what, where from, how long) | `api.audit` table; dispatcher writes via `ctx.waitUntil` | `audit lists writes and refusals…`, `no key → 401 and it is audited` | Met |
| S17 | The static app sends security headers (CSP restricted to our Supabase project, no framing, HSTS) | `shelly-app/public/_headers` → `site/_headers` | build output | Met (manual) |
| S18 | Leaked-password protection on Supabase Auth | Dashboard setting (cannot be set from SQL) | — | Open: Supabase → Authentication → Providers → Email → enable |
| S19 | Public sign-ups disabled once the API creates logins | Dashboard setting; the adapter's Team tab still uses sign-up until pointed at the API | — | Open: after deploying the API, turn off "Allow new users to sign up" |

## 4. Cost ("credits") requirements

| ID | Requirement | How it is met | Evidence | Status |
|---|---|---|---|---|
| C1 | Every key has a daily call budget; exceeding it is refused, not billed | `daily_limit` + `api.usage`, checked in the same round trip as authentication | `per-key daily limit → 429 with Retry-After` | Met |
| C2 | A hard ceiling for *all* keys per day — the kill switch | `CHASE_DAILY_CAP` compared to `total_today` | `global daily cap across all keys → 503` | Met |
| C3 | Burst protection per caller | in-memory limiter + Cloudflare rate-limit binding | `burst rate limit per caller → 429`, `Cloudflare rate-limit binding is honoured` | Met |
| C4 | Never move more data than asked: pages are capped, base rows are paged in the database, base lists carry counts not rows | `p_limit` clamps; `api.base_rows()`; `api.bases()` | `customer pages are capped at 200`, `the database is asked for the page, not the whole base`, `bases: metadata only…` | Met |
| C5 | Heavy work happens in Postgres, one round trip per call, not in the worker | every business route is a single RPC | code review: `api/src/routes.js` | Met |
| C6 | Request bodies capped (256 KB; 8 MB for base uploads) and rows capped at 50 000 | `readJson()`; route `maxBody`; `bases_shape_chk` | `body size caps…` | Met |
| C7 | Database growth bounded: notes ≤ 5 000 chars, activities ≤ 30, history ≤ 25, bases ≤ 25 MB | CHECK constraints in `supabase/schema.sql` | migration dry-run | Met (manual) |
| C8 | Usage is visible to the people who pay for it | `GET /v1/usage`, `GET /v1/me` | `usage: a key sees its own days…` | Met |
| C9 | Zero paid dependencies: no npm packages, runs on Cloudflare's and Supabase's free tiers | `api/package.json` has no dependencies | — | Met |

## 5. Operational / quality requirements

| ID | Requirement | How it is met | Status |
|---|---|---|---|
| O1 | Automated tests run on every push | `.github/workflows/ci.yml` runs the API suite and checks the committed `site/` build matches its sources | Met |
| O2 | One-command deploy, secrets outside the repo | `api/wrangler.jsonc`; `wrangler secret put` for the three secrets | Met |
| O3 | Health endpoint for monitoring | `GET /v1/health` | Met |
| O4 | Every response carries a request id that also appears in logs and the audit table | `X-Request-Id`; `[rid]` in console logs | Met |
| O5 | Clear, actionable errors when the environment is incomplete | `not_configured` (503) names the exact dashboard setting | Met |

## 6. What this makes better

- **One front door instead of many.** Every integration goes through the same checks, so a
  leaked spreadsheet key can be revoked without touching the app or the database.
- **The database got smaller and stricter at the same time.** Seven tables became five, four
  public helper functions became two private ones, and the rules that used to live only in
  JavaScript (outcome codes, length limits, "one pending claim", "one active base",
  "managers only assign") now live in Postgres where nothing can skip them.
- **Two real security holes closed.** Before: any consultant could re-assign customers to
  themselves or mark their own Wons as MTN-verified by calling Supabase directly; and the
  helper functions were callable anonymously (flagged by Supabase's own advisor).
- **Predictable cost.** Keys have budgets, the whole API has a cap, and the expensive shape
  (a 50 000-row base as one JSON blob) is never sent whole. See `docs/COST-CONTROLS.md`.
- **Auditable.** Every write and refusal is a row with actor, store, IP and duration.
- **Documented by construction.** `/v1/docs` and `/v1/openapi.json` are generated from the
  route table, so they are always true.

## 7. Not in scope (yet)

- Webhooks / push notifications to callers (the app already gets live sync from Supabase Realtime).
- Per-key IP allow-lists and mutual TLS.
- Moving the app's Team tab onto `POST /v1/users` so sign-ups can be switched off (S19).
