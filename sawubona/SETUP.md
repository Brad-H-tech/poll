# Sawubona — setup guide

**Sawubona** (Zulu for "hello — I see you") gives you one friendly brief a day:

- 📰 **MTN today** — live news about MTN, searched fresh every day
- 🗣️ **Zulu word of the day** — tap to reveal, with pronunciation
- 💡 **Did you know?** — one tech thing explained in plain English
- 🎮 **Dlala!** — a daily word game with a **shared leaderboard**
- 🔔 One daily notification with all of it

There are **three pieces**, and you only need the first one to have a working app:

| Piece | What it gives you | Time | Cost |
|---|---|---|---|
| **Netlify** | Puts the app online, gives it a web address | 5 min | Free |
| **Supabase** | The shared leaderboard — you vs your friends | 10 min | Free |
| **Anthropic key** *(optional)* | A real AI writes your MTN summary daily | 3 min | ~R2/day |

Do them in order. You can stop after Netlify and still have a fully working
app — it just keeps your scores on your own phone.

---

# Part 1 · Put it online with Netlify (~5 min)

1. Go to **netlify.com** and click **Sign up**. Choose **Sign up with GitHub** —
   it's the easiest, because your app already lives on GitHub.
2. Once you're in, click **Add new site** → **Import an existing project**.
3. Click **GitHub**, and allow Netlify to see your repositories if it asks.
4. In the list of repositories, choose **`poll`**.
5. Netlify shows a settings page. Almost everything is already filled in
   correctly from the `netlify.toml` file in your project — **you only need to
   change one thing**:
   - Find **Branch to deploy** and choose
     **`claude/daily-mtn-claude-notifier-h0m9i3`**
   - Leave *Base directory*, *Build command* and *Publish directory* exactly as
     they are.
6. Click **Deploy**.
7. Wait about a minute. When it says **Published**, Netlify gives you an address
   like `https://random-words-12345.netlify.app` — **that's your app**. Click it!

**Give it a nicer name (optional, 30 sec):** in Netlify go to
**Site configuration → Change site name** and type something like `sawubona-brad`.
Your address becomes `https://sawubona-brad.netlify.app`.

> **Good to know:** every time Claude pushes an update to that branch, Netlify
> rebuilds the site automatically. You never have to do this part again.

---

# Part 2 · The shared leaderboard with Supabase (~10 min)

This is what turns "you vs you" into "you vs your girlfriend and your mates".
Skip it and the app still works perfectly — just solo.

## 2a · Create the database

1. Go to **supabase.com** and click **Start your project**. Sign up (again,
   GitHub is easiest).
2. Click **New project**.
   - **Name:** `sawubona`
   - **Database Password:** click **Generate a password**, then copy it
     somewhere safe. *(You won't need it for this app, but don't lose it.)*
   - **Region:** choose the one closest to you.
3. Click **Create new project** and wait ~2 minutes while it builds.

## 2b · Create the scores table

1. In the left-hand menu click **SQL Editor** (the icon that looks like a database).
2. Click **New query**.
3. Open the file **`sawubona/supabase-schema.sql`** from your project, select
   **everything** in it, and copy it.
4. Paste it into the Supabase editor and click **Run** (or press Ctrl+Enter).
5. You should see **"Success. No rows returned"** — that's exactly right. ✅

## 2c · Copy your two keys

1. In the left-hand menu click **Project Settings** (the gear at the bottom).
2. Click **API keys** (older Supabase calls this **API**).
3. You need two things from this page:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a very long string of letters and numbers

> ⚠️ Only ever use the key labelled **anon / public**. If you see one called
> **service_role**, leave it alone — that one is a master key and must never go
> into an app.

## 2d · Paste them into the app

1. In GitHub, open your **`poll`** repository.
2. Make sure you're on the branch **`claude/daily-mtn-claude-notifier-h0m9i3`**
   (there's a branch dropdown near the top left — click it and pick that one).
3. Open the folder **`sawubona`**, then click the file **`config.js`**.
4. Click the **pencil icon** (Edit this file) on the right.
5. Paste your two values between the quote marks:

```js
self.SAWUBONA_CONFIG = {
  SUPABASE_URL: "https://abcdefghijkl.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6...",   // your long key

  APP_NAME: "Sawubona",
  TAGLINE: "Your daily MTN, Zulu & tech brief",
  BOARD_NAME: "The Y'ello Board",       // ← name your board whatever you like!
};
```

6. Scroll down, click **Commit changes**.
7. Netlify notices and rebuilds your site within about a minute. Refresh the app —
   the **Board** tab now has *Today / All time / Just me* tabs, and asks for your
   name the first time you finish a game.

**That's it — the leaderboard is live.** Send your Netlify address to anyone;
whoever installs it and enters a name shows up on the same board.

---

# Part 3 · Install it on your phone (~1 min)

Open your Netlify address on your phone.

**Android (Chrome):** tap the **⋮** menu → **Add to Home screen** → confirm.

**iPhone (Safari):** tap **Share** (the square with the arrow) → scroll down →
**Add to Home Screen** → **Add**. *Open it from that icon from now on — on
iPhone, notifications only work when the app was opened from the home screen.*

Then open the app, scroll to **Daily notification** and tap
**Turn on daily notifications**.

> **About timing, honestly:** phones don't let a web app promise an exact
> delivery time — the phone decides when to wake it, roughly once a day. Android
> does this in the background; iPhone is stricter, so opening the app now and
> then keeps the notifications flowing. What's *inside* the app is always
> up-to-date the moment you open it.

---

# Part 4 · AI mode (optional, ~3 min)

By default the MTN tab shows real headlines — free, no setup. If you want a
real **Claude AI agent** to search the web each day and *write* your summary in
friendly bullet points:

1. Go to **console.anthropic.com**, create an account, and add a little credit
   (a few dollars lasts months — each daily summary costs a few cents).
2. Go to **API Keys** → **Create Key**. Copy it (it starts with `sk-ant-`).
3. In **Netlify**, open your site → **Site configuration** → **Environment
   variables** → **Add a variable**:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** paste your key
   - Click **Create variable**
4. Go to **Deploys** → **Trigger deploy** → **Deploy site** so it picks up the
   new setting.

Now the MTN tab says **✦ WRITTEN BY CLAUDE** and shows a daily summary written
for you.

> **Why do it this way?** Your key sits safely in Netlify's settings, not on
> anybody's phone. Everyone using your app gets the AI summary, and nobody can
> ever see or steal the key. (The app *also* has an "AI mode" box where a single
> person can paste their own key just for their own device — handy for testing,
> but the Netlify way is better.)

---

# If something goes wrong

**The Board tab says "Couldn't reach the shared board"**
Your URL or key in `config.js` probably has a typo, or the SQL wasn't run.
Re-check Part 2b and 2c. The URL must start with `https://` and have **no**
slash at the end.

**My score doesn't appear on the board**
Have you entered a name? Tap **add name** on the Board tab. Any games you
played before that are saved and get sent up automatically once you do.

**Netlify says "Page not found"**
Check that **Branch to deploy** is `claude/daily-mtn-claude-notifier-h0m9i3`
(Netlify → Site configuration → Build & deploy → Branch to deploy).

**The app looks old after an update**
Close it completely and open it twice. The app caches itself so it works
offline, and the new version swaps in on the second open.

**The AI summary isn't showing**
Check the variable is named exactly `ANTHROPIC_API_KEY`, and that you triggered
a fresh deploy afterwards. If the key is wrong the app quietly shows normal
headlines instead — it never breaks.

---

# What this costs

| | Free tier | Realistically |
|---|---|---|
| **Netlify** | 100 GB traffic/month | Free forever at your scale |
| **Supabase** | 500 MB database | A million games would still fit |
| **Anthropic** *(optional)* | Pay per use | A few cents a day, only if you set it up |

Everything except the optional AI is **completely free**.

---

# Questions you might have

**Can I change the Zulu words, facts or quotes?**
Yes — they're all in `sawubona/data.js`. Or just ask Claude: *"add 20 more Zulu
words to Sawubona"*.

**Can I see everyone's scores in a table?**
Yes. In Supabase click **Table Editor** → **sawubona_scores**. You can also
delete any score from there (nobody can delete scores from inside the app).

**Is it private?**
Anyone with your web address can play and appear on the board. Only put in a
name you're happy for others to see. No emails, no passwords, no personal data
is collected.

**Does it still work without signal?**
Yes — the app opens offline and shows the day's word, fact and quote. News and
the shared board need a connection, and any games you play offline are sent up
automatically next time you're online.
