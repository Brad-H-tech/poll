# Going live — Sales Intelligence

The app is a single, zero-dependency Node server. Any host that runs Node 18+
(or Docker) will run it. Below are three ways, easiest first. Pick one.

Whatever you choose, two things matter:
- **Persistence** — the app keeps everything (users, monthly bases, tracking) in
  one file, `store.json`, inside its data folder. On a real host you must give it
  a **persistent disk/volume** so a redeploy doesn't wipe the book.
- **HTTPS** — always put it behind HTTPS (all three options below do this for you).

---

## Settings (environment variables)

| Variable | What it does | Example |
|---|---|---|
| `SHELLY_ADMIN_PASSWORD` | The first manager password (set once, on first run) | `a-strong-secret` |
| `SHELLY_STORES` | Your store names, comma-separated — the login list is built from this | `Sandton, Rosebank, Menlyn, Gateway, Canal Walk, Bara` |
| `SHELLY_DATA_DIR` | Where `store.json` is written (point at your mounted disk) | `/var/data` |
| `PORT` | Port to listen on (most hosts set this for you) | `4173` |

Change your store names any time by editing `SHELLY_STORES` and restarting — no code edit.

---

## Option A — Railway (recommended, ~$5/mo, has a volume)

1. Push this repo to GitHub (already done on your branch).
2. Go to **railway.app** → **New Project** → **Deploy from GitHub repo** → pick this repo.
3. Railway reads `shelly-app/railway.json` and builds the Dockerfile automatically.
4. Under the service → **Variables**, add `SHELLY_ADMIN_PASSWORD` and `SHELLY_STORES`.
5. Under **Settings → Volumes**, add a volume mounted at `/data` (the Dockerfile already
   points `SHELLY_DATA_DIR` there).
6. Deploy. Open the generated URL — sign in as `admin` with your password, then add
   the team under **Manager → Team**.

## Option B — Render (has a free trial; paid plan for a persistent disk)

1. Go to **render.com** → **New** → **Blueprint** → connect this repo.
2. Render reads `render.yaml` and sets everything up. Edit `SHELLY_STORES` there (or in
   the dashboard) to your real store names.
3. The blueprint attaches a 1 GB disk at `/var/data` (needs a paid plan; on the free
   plan drop the `disk:` block, but note the book resets on each redeploy).
4. Deploy, open the URL, sign in as `admin` (password is shown in the dashboard).

## Option C — Your own server / VPS (full control, ~R60–100/mo)

```bash
# on any box with Docker:
git clone <your-repo> && cd <repo>/shelly-app
docker build -t sales-intel .
docker run -d --name sales-intel -p 4173:4173 \
  -v /srv/sales-intel-data:/data \
  -e SHELLY_ADMIN_PASSWORD='choose-a-strong-one' \
  -e SHELLY_STORES='Sandton, Rosebank, Menlyn, Gateway, Canal Walk, Bara' \
  sales-intel
```

Then put it behind HTTPS with Caddy (two lines):

```
your-domain.co.za {
    reverse_proxy 127.0.0.1:4173
}
```

Without Docker: `cd shelly-app && SHELLY_STORES='...' node server.js` (Node 18+).

---

## First-run checklist

1. Open the URL → you land on the login screen with your store list.
2. Sign in: username `admin`, password = your `SHELLY_ADMIN_PASSWORD`.
3. **Manager → Team**: add each consultant (name, username, password, and their
   **CSR name exactly as it appears in the base**, e.g. `SIMONE`).
4. **Manager → Load this month's base**: drop the month's `.xlsx`/`.csv`.
5. Consultants sign in on their own devices, pick their store, and work the book —
   outcomes, callbacks, My Day and Hot List all sync live.

## Backup / reset

- **Back up** = copy `store.json` from your data volume. That one file is everything.
- **Reset** = delete `store.json` and restart; a fresh admin password is printed to
  the logs on the next start.

## Health

`GET /api/health` returns `{"ok":true}` — used by the hosts above for health checks.
