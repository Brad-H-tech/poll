# Chase — keeping the credits down

Chase runs on two free tiers. This page says where the meter is, what would run it, what is
now in place to stop that, and where to look.

## 1. Where the money is

| Platform | Free allowance (Sep 2026, check the pricing pages) | What Chase spends it on |
|---|---|---|
| **Supabase** | 500 MB database · 5 GB egress/month · 50 000 monthly active users · 2 M Realtime messages · 500 K Edge function calls · pauses after a week idle | rows in `bases` (the big one), every phone's `/api/state` load, live-sync messages |
| **Cloudflare Workers** | 100 000 requests/day · 10 ms CPU per request · static assets free | the app page, the CL Academy page, the API |

The number that actually matters is **Supabase egress**: a base is a JSON blob of up to
50 000 rows; every time the app loads state it downloads *every* base of the store, active or
not. 6 stores × 10 consultants × 20 opens a day × 400 rows is fine. 6 stores × 5 old bases ×
5 000 rows each is a gigabyte a week.

## 2. What the API does about it

| Control | Where | Effect |
|---|---|---|
| **Per-key daily budget** | `api.keys.daily_limit`, checked inside `api.authenticate()` | A runaway script stops at its budget with `429`; nothing else is affected |
| **Global daily cap** | `CHASE_DAILY_CAP` in `api/wrangler.jsonc` (default 20 000) | Whatever happens, the API refuses with `503` after the cap. Change and redeploy to lift |
| **Per-minute limits** | `RATE_PER_MINUTE` (120) per caller, `RATE_IP_PER_MINUTE` (300) per address, plus the Cloudflare rate-limit binding | Bursts are cut before they reach the database |
| **Pages, never blobs** | `p_limit` ≤ 200 customers, ≤ 500 base rows; `GET /v1/bases` returns counts not rows | The biggest object in the system is never sent whole |
| **Work in the database** | every business route = one `api.*` function | One round trip per call; the worker stays under its CPU budget |
| **Input caps** | 256 KB bodies (8 MB for a base), 50 000 rows, text lengths | Nobody can grow the database by accident |
| **Database growth caps** | CHECK constraints: notes ≤ 5 000 chars, activities ≤ 30, history ≤ 25, base ≤ 25 MB | Even a bypass of the worker cannot inflate rows |
| **Audit is cheap** | one small insert per write or refusal of an identified caller, fire-and-forget; reads and credential-less requests are not audited; rows older than 18 months are pruned nightly | Audit does not double the write load and cannot be inflated by strangers |
| **Throttle before the database** | per-key and per-IP limits are decided from the token itself, before `api.authenticate` runs | A flood of 429s costs Supabase nothing and burns no budget |
| **Metering is free** | usage counter rides on the authentication query | No extra round trip |
| **No dependencies** | `api/package.json` has none | Nothing to pay for, nothing to update |

Watch it: `GET /v1/usage` (your key) · `GET /v1/usage?all=1` (every key, manage scope) ·
Supabase → Reports → API / Database for egress and size.

## 3. What the app does about it (after this change)

- **Only two bases are ever downloaded**: the active one and the one before it (for the KPI
  deltas). Older bases arrive as a label and a row count; tapping one loads it. This was the
  single largest egress item.
- **Old bases are deleted after 12 months** by a nightly database job (`chase-prune-old-bases`),
  which also keeps personal information from piling up.
- **Fewer queries per state load** for everything else (settings ride on the store row, owners on
  the tracking row — two tables gone).
- **Smaller live-sync surface**: 4 subscriptions per phone instead of 5, and the `stores`
  subscription only fires on `UPDATE`.
- **Consultant saves send fewer columns**: `agent`/`ver` are no longer sent, so a save is a
  smaller row and can never clobber a manager's change (which used to cause a second write to fix).

## 4. Recommended next (not done, in order of payoff)

1. **Set Supabase spend cap** (Organization → Billing → Spend cap) so the project pauses rather
   than bills if a free limit is crossed.
2. **Realtime**: if the team grows past ~30 phones, move the `bases` subscription to a manual
   refresh — a base upload is rare and every phone re-downloading it at once is the spike.
3. **Shorten retention** to 3 or 6 months if a year of history is never looked at: one number in
   the `chase-prune-old-bases` job.

## 5. Development credits (AI/tooling)

Working in sessions like this one costs tokens rather than rands. The habits that kept this one
efficient, and are worth keeping:

- Tests before production: the migration was run inside a rolled-back transaction on the live
  project and the app driven through 30 checks in a real browser *before* anything was pushed —
  cheaper than a broken morning for the team.
- Generated docs (`/v1/docs`, `openapi.json`) instead of hand-written ones that need re-doing.
- No new frameworks or packages to learn, update or pay for.

## 6. Budget knobs, in one place

| Knob | Default | Where |
|---|---|---|
| Per-key daily calls | 2 000 (`mint_key`) / 500 for a spreadsheet | `api.keys.daily_limit` |
| All keys per day | 20 000 | `CHASE_DAILY_CAP` |
| Per caller per minute | 120 | `RATE_PER_MINUTE` + `ratelimits` binding |
| Per IP per minute | 300 | `RATE_IP_PER_MINUTE` |
| Customer page | 50, max 200 | `?limit=` |
| Base rows page | 200, max 500 | `?limit=` |
| Body size | 256 KB / 8 MB (bases) | `route.maxBody` |
| Base size | 50 000 rows / 25 MB | `bases_shape_chk` |
