# Chase API

A zero-dependency Cloudflare Worker that puts a safe, documented, metered front door on the
Chase CRM data in Supabase. Start with `docs/API-GUIDE.md`; the contract is `docs/API-REQUIREMENTS.md`.

```
api/
  src/index.js      dispatcher: CORS → route → limits → auth → scope → store → handler → audit
  src/routes.js     every endpoint with its own docs (the OpenAPI spec is generated from this)
  src/auth.js       API keys (hashed) and Supabase user tokens → one "actor" shape
  src/db.js         PostgREST client + error mapping that never leaks internals
  src/security.js   headers, CORS allow-list, rate limiter, body caps, input clamps, crypto
  src/openapi.js    /v1/openapi.json and the server-rendered /v1/docs page
  sql/001_api.sql   the `api` schema: keys, usage, audit and every api.* function
  test/             node --test suite with an in-memory Supabase stand-in
  wrangler.jsonc    deploy config (secrets are set with `wrangler secret put`)
```

## Run the tests

```bash
cd api && node --test
```

## Deploy

1. Supabase → SQL Editor: run `sql/001_api.sql` (after the 5-table schema).
2. Supabase → Project Settings → Data API → Exposed schemas: add `api`.
3. `npx wrangler deploy --config api/wrangler.jsonc` from the repo root (or connect the repo in
   Cloudflare with that deploy command).
4. Secrets, each with `--config api/wrangler.jsonc`:
   `npx wrangler secret put SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`.
5. Put the app's real address in `CHASE_ALLOWED_ORIGINS` in `wrangler.jsonc`.
6. Mint a key: `select * from api.mint_key('Head office', null, '{read,write,manage}', 2000, 365, 'you');`
7. `curl https://<worker>/v1/me -H "Authorization: Bearer chk_…"`.

Local: `npx wrangler dev --config api/wrangler.jsonc` with a `api/.dev.vars` file holding the three secrets (git-ignored).

## Endpoints

See `/v1/docs` on the deployed worker, or read the summaries in `src/routes.js`.
