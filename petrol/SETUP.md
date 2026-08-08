# SlipStream — setup guide

A mobile web app for your team's petrol expenses. Everyone installs it
like an app on their phone, signs in with their own account, snaps a
photo of the till slip when they fill up, and it's saved to a shared
database. Anyone can download the data as an Excel file at any time.

---

## 1. Try it right now (demo mode — zero setup)

The app already works the moment this repo is on GitHub Pages:

**`https://<your-github-username>.github.io/poll/petrol/`**

In demo mode, accounts and slips are stored **on each phone only** —
great for testing the flow, but people can't see each other's entries.
For the real shared database, do step 3 below (about 5 minutes, free).

## 2. Install it as an app on a phone

- **Android (Chrome):** open the link → tap the ⋮ menu → **"Add to Home
  screen"** (or "Install app"). It gets the amber pump icon and opens
  full-screen like a real app.
- **iPhone (Safari):** open the link → tap the **Share** button →
  **"Add to Home Screen"**.

Send the link to the team on WhatsApp and everyone does this once.

## 3. Turn on team mode (shared database + real logins)

SlipStream uses [Supabase](https://supabase.com) — a free hosted
database with logins and file storage built in. The free tier
(500 MB database + 1 GB file storage) is far more than 10 people's
petrol slips will ever use.

1. Go to **supabase.com** → sign up (GitHub login works) → **New
   project**. Pick any name and a strong database password (you won't
   need it day-to-day). Region: choose the closest (e.g. *West EU* or
   *Central EU* work fine from South Africa).
2. In the left sidebar open **SQL Editor**, paste the entire contents
   of `supabase-schema.sql` (in this folder), **change the admin code
   on the line marked `CHANGE ME`**, and click **Run**. That creates
   the fill-ups table, the photo storage bucket, and the security
   rules: each person can only see their *own* entries; admins (see
   below) can see everyone's.
3. In **Authentication → Sign In / Up → Email**, turn **off** "Confirm
   email" so the team can sign in immediately after registering
   (otherwise each person must click a confirmation email first —
   also fine, your choice).
4. In **Project Settings → API**, copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public key** (a long string — this one is *meant* to be
     public; the security rules from step 2 are what protect the data)
5. Open `config.js` in this folder, paste both values in, commit and
   push. Done — the login screen now creates real accounts.

Each of your 8–10 people then opens the app, taps **"Create your
account"**, and enters their name, email and a password. If you want to
lock it down after everyone has registered, flip **Authentication →
Sign In / Up → "Allow new users to sign up"** off in Supabase.

## 4. How admin access works

Normal users only ever see **their own** slips — that's enforced by
the database itself, not just hidden in the app.

To become an admin, tap the **🔒 Admin** chip in the app and enter the
admin code (the one you set in `supabase-schema.sql`). That unlocks:

- **Everyone / Just me** toggle — browse the whole team's slips and
  photos for any month
- a **"Who used what"** panel — per person: number of slips, litres,
  and Rand total for the selected month
- Excel export of the whole team's data

Give the code only to the one or two people who should have it. To
change the code later, re-run the `admin_config` insert in Supabase
with a new value. To revoke someone's admin access: **Table Editor →
admins** → delete their row.

In **demo mode** the admin code is the `ADMIN_CODE` value in
`config.js` (default `2468`).

## 5. Getting the data into Excel

- **In the app:** the **⬇ Excel** button downloads whatever you're
  currently looking at (a month, or all time; everyone or just you) as
  a `.csv` that opens directly in Excel — with litres, price per litre,
  totals and a sum row.
- **Straight from the database:** in Supabase, **Table Editor →
  fillups → Export as CSV** gives you the raw table any time.

The database is the "source of truth"; Excel is just an export
whenever you need one — so nothing to keep in sync manually.

## 6. Where the slip photos live

Photos are compressed on the phone (to ~200–400 KB each) and uploaded
to the private `slips` bucket in Supabase storage. Only signed-in team
members can view them; each person can only upload/delete their own.
At that size, 1 GB of free storage holds roughly 3,000+ slips.

## Files in this folder

| File | What it is |
|---|---|
| `index.html` | The whole app (login, camera, feed, stats, export) |
| `config.js` | Your settings — paste Supabase keys here for team mode |
| `supabase-schema.sql` | One-paste database setup script |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | What makes it installable as an app with its own icon |
