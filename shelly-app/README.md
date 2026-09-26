# Chase — the app source

`public/index.html` is the whole app: one file, no build tools. It talks to a small
`/api/…` contract; `supabase/chase-supabase.js` intercepts those calls in the browser and
serves them from Supabase, so the app never needs a server of its own.

```
public/index.html        the app (edit this)
public/_headers          security headers Cloudflare sends with the built site
public/sw.js, icons…     PWA companions
seed-stores.json         sample bases used by the browser test
```

Build the deployable site (writes `site/`, commit the result):

```bash
python3 supabase/build_site.py
```

Test the app end-to-end in a real browser against a stand-in Supabase:

```bash
python3 supabase/build_site.py --mock && node supabase/test_sb.js
```

The old single-server edition (`server.js` with a JSON file store, Railway/Render/Docker
configs) was removed on 2026-09-26; Supabase is the only backend. Its history is in git.
