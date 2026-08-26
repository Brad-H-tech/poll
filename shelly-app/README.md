# Shelly — team edition

Multi-user version of the Shelly console: one shared customer book,
consultant logins, live sync, and manager-only analytics + base uploads.
Zero dependencies — plain Node 18+.

## Run

```bash
cd shelly-app
npm start          # or: node server.js
```

Open http://localhost:4173 (set `PORT` to change).

**First run** creates the manager account and prints the password to the
console:

```
username: admin
password: shelly-xxxxxx   ← printed once; or preset with SHELLY_ADMIN_PASSWORD
```

Add consultants in **Manager view → Team**. Consultants sign in and see
only the Book; managers additionally get the command centre (KPIs,
leaderboard, mix/demand charts, base management, team management).

## How it works

- **Storage** — everything lives in `data/store.json` (created on first
  run, seeded from `seed-rows.json`). Back that file up; delete it to
  reset (a fresh admin password is printed on the next start).
- **Live sync** — outcome/callback/note changes are pushed to every
  signed-in browser instantly over server-sent events. Two consultants
  and the manager can work the same book at once.
- **Base uploads** — the manager drops the month's `.xlsx`/`.csv` in the
  browser; parsing happens client-side and the normalised rows are
  stored server-side for the whole team. Files carrying
  Outcome/Next action/Notes columns update customer outcomes on import.
- **Auth** — scrypt-hashed passwords, httpOnly session cookies,
  light login rate-limiting. Passwords: manager can reset anyone's in
  Team; sessions last 30 days.

## Deploying

Any box that runs Node 18+ (a R60/month VPS is plenty). Run it behind a
reverse proxy that terminates HTTPS (Caddy makes this a two-line
config). The app itself listens on plain HTTP.
