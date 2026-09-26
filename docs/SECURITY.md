# Chase — cybersecurity

What we protect, who we protect it from, what is in place, what was found in the live project,
and what is still yours to click. Written to be re-read after every change.

## 1. What we protect

| Asset | Where | Why it matters |
|---|---|---|
| Customer base rows: names, cell numbers, e-mails, contract values | `public.bases.rows` | Personal information of ~400 people per store per month (POPIA applies) |
| Outcomes, notes, history | `public.tracking` | Commercially sensitive; consultants' performance record |
| Logins | Supabase Auth + `public.profiles` | Taking one over means taking a store's book |
| The service-role key | Cloudflare secret only | Bypasses every row-level rule |
| API keys | `api.keys` (hashed) | A leaked key = a caller with that key's rights until revoked |

## 2. Who we protect it from

- **A stranger on the internet** with the public app address and its publishable key (which is
  in the page source by design).
- **A consultant overreaching**: reading another store, re-assigning customers to themselves,
  marking their own Wons as MTN-verified, changing their role.
- **A leaked or shared API key** used by someone it was not meant for.
- **Mistakes and floods**: a script in a loop, a 200 MB upload, a note the size of a novel.
- **Web attacks on the app page**: clickjacking, script injection, being loaded inside another site.

## 3. Defence in depth — four layers

```
 ┌ Edge (Cloudflare) ─────────────────────────────────────────────────────┐
 │  HTTPS only · security headers on the app (_headers) · rate-limit binding │
 ├ API worker (api/src) ─────────────────────────────────────────────────┤
 │  key hash check · scopes · store pinning · input clamping · body caps    │
 │  per-caller + per-IP limits · daily budgets · CORS allow-list · audit    │
 ├ Row-level security (supabase/schema.sql) ─────────────────────────────┤
 │  every table: read your store only; managers write; consultants log      │
 │  helpers in private schema `chase`; anon sees 3 columns of `stores`      │
 ├ Postgres rules ───────────────────────────────────────────────────────┤
 │  CHECK constraints (codes, lengths, sizes) · partial unique indexes      │
 │  tracking_guard trigger: only managers touch `agent` and `ver`           │
 └──────────────────────────────────────────────────────────────────────────┘
```

A bug in any one layer is caught by the next. The API worker uses the service role, so its own
scoping is critical — which is why it is the layer with the most tests (`api/test/api.test.js`).

## 4. What was found in the live project (26 Sep 2026)

Run against project `dzmqogwggompkwasiglq` with Supabase's own advisors plus a read of the schema.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Any consultant could change `tracking.ver` (MTN-verified) via direct REST: the `tracking_update` policy allowed the whole row | High | **Fixed** by the `tracking_guard` trigger (migration) |
| 2 | With owners moving onto `tracking`, the same policy would have let consultants re-assign customers | High | **Fixed** by the same trigger before it could happen |
| 3 | Four `SECURITY DEFINER` helpers callable by `anon` and `authenticated` at `/rest/v1/rpc/…` (advisor 0028, 0029) | Medium | **Fixed**: two unused helpers dropped, two moved to private schema `chase` with `EXECUTE` revoked from `anon`/public |
| 4 | No length or code limits in the database: a signed-in user could write a 100 MB note or a made-up outcome code | Medium (cost + integrity) | **Fixed**: CHECK constraints on every table |
| 5 | Nothing stopped two pending claims or two active bases per store except app code | Low | **Fixed**: partial unique indexes |
| 6 | `profiles.store_id` foreign key unindexed; RLS policies re-evaluated `auth.uid()` per row (advisors) | Low (performance) | **Fixed**: index added; `(select auth.uid())` form |
| 7 | Leaked-password protection off (advisor) | Medium | **Open** — dashboard toggle, see §6 |
| 8 | Public sign-ups must stay on because the Team tab creates users by signing up; a stranger can create a (profile-less) login | Medium | **Mitigated** (no profile = no data); **fix path built**: `POST /v1/users` creates logins without sign-ups, see §6 |
| 9 | One auth user (`simone@chase.local`) has no profile — a half-created person | Info | Open — decide: finish in Team tab or delete in Authentication → Users |
| 10 | App page served without security headers (framing, CSP) | Medium | **Fixed**: `site/_headers` |
| 11 | `report_to` (a manager's phone number) and templates would be readable by `anon` once folded into `stores` | Medium | **Fixed before it shipped**: column-level grant, `anon` sees only `id,name,sort` |
| 12 | `drill_scores` (CL Academy) allows unauthenticated inserts with no rate limit | Low (spam/cost) | Open — fine for a training toy; add a per-IP limit if it ever matters |

## 5. Controls in the API, by attack

| Attack | Control | Test |
|---|---|---|
| Guess a key | 32 random bytes; hash compared; per-IP floor; every failure audited | `wrong secret → 401…`, `per-IP floor…` |
| Reuse a leaked key | scopes + store pinning limit blast radius; instant revoke; expiry | `a store key cannot look at another store`, `revoke a key…` |
| Escalate scope | a key can never grant more than its creator; route scopes | `create a key: … scopes cannot exceed` |
| Cross-store read/write | store resolved once in the dispatcher, every RPC gets `p_store` | `a store key is pinned…` |
| Injection | no SQL in the worker; parameters only; ids must be UUIDs; account numbers stripped to `[A-Za-z0-9._-]` | `account numbers are sanitised…`, `ids must be UUIDs` |
| Oversized input | 256 KB body (8 MB for bases), 50 000 rows, text clamps, DB CHECKs | `body size caps…` |
| Flood / cost attack | per-caller and per-IP minute limits, per-key daily budget, global cap | `limits and budgets` suite |
| Information leakage | error mapping hides SQL/tables; no stack traces; `no-store`; `noindex` | `…without leaking…`, security headers test |
| Browser abuse (CSRF-style) | CORS only for named origins; bearer tokens, no cookies | `CORS` suite |
| Clickjacking / injection on the app | `frame-ancestors 'none'`, CSP `connect-src` limited to our Supabase project | `site/_headers` |

## 6. Still yours to click (dashboard settings SQL cannot change)

1. **Supabase → Authentication → Providers → Email → "Prevent use of leaked passwords"**: on.
2. **After the API is deployed**: Supabase → Authentication → Sign In / Providers → "Allow new
   users to sign up": **off**, and create people through `POST /v1/users` (or point the Team tab at it).
3. **Supabase → Project Settings → Data API → Exposed schemas**: add `api` (needed by the worker).
4. **Supabase → Authentication → Users**: decide what to do with `simone@chase.local` (no profile).
5. **Supabase dashboard account**: turn on two-factor authentication. It is the master key.
6. **Cloudflare**: the three worker secrets; never paste the service key anywhere else.
7. **Rotate** the service key if it was ever in a chat, a screenshot or a file.

## 7. If something goes wrong

| Symptom | First move |
|---|---|
| A key is leaked | `DELETE /v1/keys/{id}` with a manage key (or `update api.keys set active=false where id='…'`). Check `GET /v1/audit` for what it did. |
| Suspicious writes in the book | `select * from public.tracking where updated_at > now() - interval '1 day' order by updated_at desc;` — `hist` on each row says who changed what and when. |
| The service key is exposed | Supabase → Settings → API Keys → rotate; `wrangler secret put SUPABASE_SERVICE_KEY`. Everything else keeps working. |
| API bill/usage spike | Lower `CHASE_DAILY_CAP` in `api/wrangler.jsonc` and redeploy; `GET /v1/usage?all=1` shows which key. |
| A consultant's login is compromised | Supabase → Authentication → Users → the user → "Send password recovery" or delete; their profile row keeps the book intact. |

## 8. Checklist before every release

- [ ] `cd api && node --test` green
- [ ] `python3 supabase/build_site.py --mock && node supabase/test_sb.js` green
- [ ] Supabase → Advisors → Security shows no new warnings
- [ ] No secrets in the diff (`git diff | grep -i -E "sb_secret|service_role|eyJ"` is empty)
- [ ] `site/_headers` still present in the build
