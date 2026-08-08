# SlipStream — setup guide

A mobile web app for your team's petrol expenses. Everyone installs it
like an app on their phone, signs in with their own account, snaps a
photo of the till slip when they fill up, and it's saved to a shared
database. Each person only sees their own slips; admins see everyone's
and can export it all to Excel.

---

# Quick start — the whole thing, in order

Do this bit **on a laptop** — it's much easier than on a phone. You
only need the phone right at the end. About 15 minutes, all free.

Nothing here needs any Git or coding knowledge. You are only clicking
around two websites: GitHub (to put the app online) and Supabase (the
shared database).

## Part 1 · Put the app online — GitHub, ~3 min

1. Go to **github.com/Brad-H-tech/poll** and sign in.
2. Click the **Settings** tab along the top of the page (gear icon,
   far right of the row that starts with "Code").
3. In the left-hand menu, scroll down and click **Pages**.
4. Under **Build and deployment → Source**, choose
   **Deploy from a branch**.
5. Under **Branch**, open the first dropdown (it says *None* or
   *main*) and choose **`claude/petrol-expense-tracker-qzv6cv`**.
   Leave the second dropdown on **/ (root)**. Click **Save**.
6. Wait a minute or two, then refresh. A green box appears saying
   *"Your site is live at …"*.
7. Your app is now at:
   **`https://brad-h-tech.github.io/poll/petrol/`**

> No merging needed — that branch already contains everything on
> `main`, so nothing on your existing site is affected.

The app works now, but it's in **demo mode**: everyone's data stays on
their own phone. Part 2 fixes that.

## Part 2 · Create the database — Supabase, ~5 min

8. Go to **supabase.com** → **Start your project** → sign in
   **with GitHub** (one click, no new password).
9. Click **New project**.
   - **Name:** SlipStream
   - **Database Password:** click *Generate a password*. You won't
     need it day-to-day, but save it somewhere just in case.
   - **Region:** the closest — *West EU (London)* is good from SA.
10. Click **Create new project** and wait ~2 minutes while it builds.

## Part 3 · Run the setup script — ~2 min

11. In a new browser tab open the **setup checker**:
    `https://brad-h-tech.github.io/poll/petrol/check.html`
12. In **Your admin code**, type a code you'll remember (e.g.
    `CELLLOGIC2026`). This is what you and the accountant will use to
    see everyone's slips. Write it down.
13. Click **⧉ Copy setup SQL**.
14. Back in Supabase: left menu → **SQL Editor** → click in the big
    empty box → paste (**Ctrl+V**, or **Cmd+V** on a Mac) → click
    **Run** (bottom right).
15. You should see **"Success. No rows returned"** — that is what
    success looks like here.

## Part 4 · One setting — ~1 min

16. Supabase left menu → **Authentication** → **Sign In / Up** →
    find **Email** → switch **Confirm email** *off* → **Save**.
    (This lets your team sign in immediately instead of waiting for a
    confirmation email.)

## Part 5 · Connect the app to the database

17. In Supabase, left menu → **Project Settings** (gear, bottom) →
    **API**. Copy these two values:
    - **Project URL** — looks like `https://abcdefgh.supabase.co`
    - the **anon / public** key — a long string
18. Put them into `petrol/config.js` as `SUPABASE_URL` and
    `SUPABASE_ANON_KEY`. Easiest way: paste both to Claude in chat and
    ask it to do this step. (The anon key is *designed* to be public —
    the security rules from step 14 are what protect your data. Never
    share the **service_role** key or your database password.)
19. Open the setup checker again and click **▶ Run the checks**.
    Every line should go green. If one goes red, the fix is written
    next to it.

## Part 6 · Get your team on it — phones

20. WhatsApp everyone the link:
    `https://brad-h-tech.github.io/poll/petrol/`
21. Each person taps **"New here? Create your account"** and enters
    their name, email and a password.
22. Then they install it: **Android/Chrome** → ⋮ menu →
    *Add to Home screen*. **iPhone/Safari** → Share button →
    *Add to Home Screen*. They get the amber pump icon.
23. Give the **admin code** only to yourself and the accountant. In
    the app they tap the **🔒 Admin** chip and enter it once — from
    then on that account sees everything.
24. *(Optional, later)* Once everyone has registered, close the door:
    **Authentication** → **Sign In / Up** → switch **"Allow new users
    to sign up"** off.

> Supabase occasionally rearranges its dashboard. If a menu name
> doesn't match exactly, look for the nearest equivalent — *SQL
> Editor*, *Authentication*, and *API* have stayed put for years.

---

# Reference

## How admin access works

Normal users only ever see **their own** slips — enforced by the
database itself, not just hidden in the app. Entering the admin code
unlocks, for that account permanently:

- an **Everyone / Just me** toggle — the whole team's slips and photos
  for any month
- a **"Who used what"** panel — per person: number of slips, litres,
  and Rand total for the month
- Excel export of the whole team's data

**Changing the code later:** re-run just the `admin_config` insert in
the SQL Editor with a new value.
**Revoking someone's admin:** **Table Editor** → **admins** → delete
their row.
**In demo mode** the admin code is `ADMIN_CODE` in `config.js`
(default `2468`).

## Getting the data into Excel

- **In the app:** the **⬇ Excel** button downloads whatever you're
  currently looking at (a month or all time; everyone or just you) as
  a `.csv` that opens directly in Excel — with litres, price per
  litre, totals and a sum row.
- **From the database:** Supabase → **Table Editor** → **fillups** →
  *Export as CSV* gives you the raw table any time.

The database is the source of truth; Excel is just an export whenever
you need one, so there's nothing to keep in sync by hand.

## Where the slip photos live

Photos are compressed on the phone (to ~200–400 KB each) and uploaded
to the **private** `slips` bucket in Supabase storage — there's no
public link anyone could stumble across. Each person can only see and
upload their own; admins can see all. At that size, the free 1 GB
holds roughly 3,000+ slips.

## Automatic slip scanning

When a photo is attached, the app reads it **on the phone** (using
tesseract.js, loaded on demand — the photo isn't sent anywhere to be
scanned) and pre-fills the total, litres and date, showing what it
found so the person can double-check before saving. It's best-effort:
a crumpled or dim slip may not read, in which case the boxes stay
empty and can be typed in — or left blank, since the photo itself is
always saved.

## Costs

Everything here is on free tiers with no credit card: GitHub Pages for
hosting, Supabase free tier for the database (500 MB), logins and
photo storage (1 GB). A 10-person team won't come close to the limits.
Note that free Supabase projects **pause after ~a week of no use** —
if that happens, hit *Restore* in the dashboard and it comes straight
back.

## Files in this folder

| File | What it is |
|---|---|
| `index.html` | The whole app (login, camera, scanning, feed, admin, export) |
| `check.html` | Setup checker — copies the SQL, then verifies your project |
| `config.js` | Your settings — the two Supabase keys go here |
| `supabase-schema.sql` | One-paste database setup script |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | What makes it installable with its own icon |
