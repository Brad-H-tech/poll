# SlipStream — setup guide

A mobile web app for your team's petrol expenses. Everyone installs it
like an app on their phone, signs in with their own account, snaps a
photo of the till slip when they fill up, and it's saved to a shared
database. Each person only sees their own slips; admins see everyone's
and can export it all to Excel.

---

# Quick start — the whole thing, in order

There are two separate jobs: **putting the app online** (free, GitHub)
and **switching on the shared database** (free, Supabase). Do them in
this order and it takes about 15 minutes.

## Part 1 · Put the app online (once)

1. **Merge the branch.** On GitHub, open the pull request for
   `claude/petrol-expense-tracker-qzv6cv` and merge it into `main`.
2. **Switch on GitHub Pages.** Repo → **Settings** → **Pages** →
   Source: *Deploy from a branch* → Branch: **main** / **/ (root)** →
   **Save**. Wait a minute.
3. Your app is now live at:
   **`https://brad-h-tech.github.io/poll/petrol/`**

At this point it works, but it's in **demo mode** — everyone's data
stays on their own phone. Part 2 fixes that.

## Part 2 · Switch on the shared database (once)

4. **Create the project.** Go to [supabase.com](https://supabase.com)
   → sign up (free, no credit card) → **New project**. Any name; pick
   a strong database password (you won't need it day-to-day); region:
   the closest one, e.g. *West EU (London)* or *Central EU*.
5. **Run the setup script.** Open the app's **setup checker** on your
   phone at `.../petrol/check.html`, type the admin code you want, and
   tap **⧉ Copy setup SQL**. Then in Supabase: **SQL Editor** → paste →
   **Run**. That creates the table, the photo storage, the admin
   unlock, and all the security rules in one go.
   *(Prefer doing it by hand? Copy `supabase-schema.sql` from this
   folder and change the line marked `CHANGE ME` to your admin code.)*
6. **Turn off email confirmation** so your team can sign in straight
   away: **Authentication** → **Sign In / Up** → **Email** → switch
   **Confirm email** off. (Leave it on if you'd rather everyone clicks
   a confirmation email first — your call.)
7. **Copy your two keys.** **Project Settings** → **API**:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public** key — a long string. This one is *meant* to be
     public; the security rules from step 5 are what protect the data.
8. **Paste them into the app.** Edit `petrol/config.js` (you can do
   this straight on GitHub: open the file → pencil icon → edit →
   *Commit changes*), fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`,
   and commit to `main`.
9. **Check it worked.** Open `.../petrol/check.html` again and tap
   **▶ Run the checks**. Every line should go green. If one goes red,
   the fix is written next to it.

## Part 3 · Get your team on it

10. Send everyone the link. Each person opens it, taps **"New here?
    Create your account"**, and enters their name, email and a
    password.
11. Tell them to install it: **Android/Chrome** → ⋮ menu → *Add to
    Home screen*. **iPhone/Safari** → Share button → *Add to Home
    Screen*. They get the amber pump icon and it opens full-screen.
12. Give the **admin code** only to yourself and the accountant. In
    the app they tap the **🔒 Admin** chip, enter it once, and from
    then on that account sees everything.
13. *(Optional)* Once everyone has registered, lock the door behind
    them: **Authentication** → **Sign In / Up** → switch **"Allow new
    users to sign up"** off.

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
