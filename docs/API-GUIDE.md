# Understanding the Chase API

*For someone who has never used an API before. Ten minutes.*

## What an API is

Your app talks to Supabase every time a consultant taps "Won". An **API** (application
programming interface) is the same idea offered to *other* programs on purpose: a fixed set of
web addresses that answer in a fixed format. Instead of a screen, the answer is data; instead of
a person, the caller is a spreadsheet, a bot or a script.

Three words you will see everywhere:

| Word | Meaning | In Chase |
|---|---|---|
| **Endpoint** | One address that does one thing | `GET /v1/customers` lists customers |
| **Request** | What the caller sends: a verb, an address, sometimes a JSON body | `PUT /v1/customers/SB10251/outcome` with `{"outcome":"won"}` |
| **Response** | What comes back: a status number and JSON | `200` + the updated customer, or `403` + a reason |

Verbs: **GET** reads, **POST** creates, **PUT** replaces/updates, **DELETE** removes.
Status numbers: 2xx worked, 4xx you did something wrong (and the message says what), 5xx we did.

## How the Chase API is built

```
 caller ──HTTPS──► Cloudflare Worker (api/src)  ──HTTPS──► Supabase
                    1. is the key real?                   • api.* functions do the work
                    2. what may it do? which store?       • row-level security for app users
                    3. is it within its budget?           • CHECK rules refuse bad data
                    4. is the input sane?
                    5. call ONE database function
                    6. write an audit row
```

The Worker has **no npm dependencies** and runs on Cloudflare's free tier, right next to the
Chase app. The database side is one SQL file (`api/sql/001_api.sql`) that adds an `api`
schema; your five Chase tables are untouched.

## Keys and scopes

An API key looks like `chk_9f3a…​.Xy7…` — an id, a dot, a secret. Keep it like a password.

| A key has | Meaning |
|---|---|
| a **store** (or none) | `s1` keys can only ever see store 1. A head-office key (no store) may use any store but must say which: `?store=s3`. |
| **scopes** | `read` looks · `write` logs outcomes/activities/walk-ins/claims · `manage` does manager things (assign, decide claims, load bases, settings, keys, users) |
| a **daily budget** | e.g. 500 calls/day. Then `429` until tomorrow. |
| an **expiry** | default one year |

Keys are created by **head office only** (a key with no store). Store managers ask head office
for a key for their store. The API is keys-only with one exception: the Chase app's Team tab
creates logins through `POST /v1/users` using the manager's own login token, so no API key ever
sits inside the web page and public sign-ups can be switched off.

## Your first call

1. Mint a key (until the API is live, from the Supabase SQL editor):
   ```sql
   select * from api.mint_key('Excel report', 's1', '{read}', 500, 365, 'bradley');
   ```
   Copy the `key` column now — it is never shown again.

2. Ask who you are:
   ```bash
   export CHASE_KEY='chk_…'
   curl -s https://chase-api.<your-account>.workers.dev/v1/me -H "Authorization: Bearer $CHASE_KEY"
   ```
   ```json
   {"actor":{"type":"key","name":"Excel report","store_id":"s1","scopes":["read"]},"usage":{"calls_today":1,"daily_limit":500}}
   ```

3. List callbacks due:
   ```bash
   curl -s "https://…/v1/customers?status=cb&limit=20" -H "Authorization: Bearer $CHASE_KEY"
   ```

4. Log an outcome (needs a `write` key):
   ```bash
   curl -s -X PUT "https://…/v1/customers/SB10251/outcome" \
     -H "Authorization: Bearer $CHASE_KEY" -H "Content-Type: application/json" \
     -d '{"outcome":"cb","next_action":"2026-10-02","note":"Call back after payday"}'
   ```

Every endpoint, with a copy-paste curl, is on the live docs page: `https://…/v1/docs`.

## Recipes

**Excel / Google Sheets daily numbers** — Power Query → From Web →
`https://…/v1/reports/summary` with header `Authorization: Bearer chk_…` (read key, budget 100).

**WhatsApp bot that logs "no answer"** — when the bot's call times out:
`POST /v1/customers/{acct}/activities` `{"type":"na"}` (write key for that store).

**Head-office morning report** — a script loops stores `s1`…`s6` and calls
`/v1/reports/summary?store=sN` with a head-office read key, then emails one table.

**Onboarding a consultant without sign-ups enabled** — the Team tab does this for you once the
app is built with `CHASE_API_URL` set (see `supabase/build_site.py`). From a script:
`POST /v1/users?store=s1` `{"username":"thandi","name":"Thandi N","password":"…","agent":"THANDI"}`
with a manage key. Then turn *off* "Allow new users to sign up" in Supabase.

## When something goes wrong

The body always says why:

```json
{"error":{"code":"forbidden","message":"Your key is limited to store s1","request_id":"a1b2c3d4e5f60718"}}
```

| Status | Usually means | Do |
|---|---|---|
| 400 | a field is missing or malformed | read the message; check `/v1/docs` |
| 401 | no key, wrong key, revoked or expired | mint a new key |
| 403 | right key, wrong scope or store | use a key with the scope/store you need |
| 404 | no such customer / claim / base | check the id |
| 409 | already exists / already assigned / already claimed | nothing to do |
| 413 | body too big | page it, or trim |
| 422 | the database refused (too long, bad code) | fix the data |
| 429 | too fast, or today's budget is used | wait `Retry-After` seconds |
| 503 | API not configured, or the global daily cap is hit | see `docs/COST-CONTROLS.md` |

Quote the `request_id` when asking for help; it appears in the audit table and the logs.

## Going live (one-time, ~15 minutes)

1. **Database** — in Supabase → SQL Editor run, in order:
   `supabase/migrations/2026-09-26_simplify.sql` (if you still have the 7-table layout) then
   `api/sql/001_api.sql`.
2. **Expose the schema** — Supabase → Project Settings → Data API → *Exposed schemas* → add `api`.
3. **Deploy the app** — merge this branch; Cloudflare redeploys `chase-crm` from `./site`
   (the rebuilt app talks to the 5-table layout). Do step 1 and this step together: the old app
   expects the old tables.
4. **Deploy the API** — in Cloudflare connect the repo once more with the deploy command
   `npx wrangler deploy --config api/wrangler.jsonc` (exactly how `cl-academy` is set up), or run it locally.
5. **Secrets** — `npx wrangler secret put SUPABASE_URL`, `…SUPABASE_SERVICE_KEY` (the *secret* key from
   Supabase → Settings → API Keys), `…SUPABASE_ANON_KEY` (the publishable key), each with `--config api/wrangler.jsonc`.
6. **Allowed origin** — in `api/wrangler.jsonc` set `CHASE_ALLOWED_ORIGINS` to the app's real address.
7. **First key** — `select * from api.mint_key('Head office', null, '{read,write,manage}', 2000, 365, 'bradley');`
   then `curl …/v1/me`. Green.
8. **Point the app at the API** — `CHASE_API_URL=https://chase-api.<sub>.workers.dev python3 supabase/build_site.py`,
   commit `site/`, merge. The Team tab now creates logins through the API; turn public sign-ups **off**.

## FAQ

**Can someone with the app's publishable key read other stores' data?** No. That key only
unlocks row-level security, which limits every person to their own store. The API's service
key is a Cloudflare secret and never reaches a browser.

**Why not call Supabase directly from Excel?** You could, with a user login. But then Excel holds
a real login, you cannot cap what it does, and nothing records what it did. A key with `read`,
store `s1`, 100 calls/day, is a much smaller thing to lose.

**Does the API slow the app down?** The app does not use it (yet). It keeps talking to Supabase
directly with live sync. The API is for everything else.
