# Sawubona — setup guide

**Sawubona** (Zulu for "hello — I see you") is a little app that gives you
one friendly brief a day:

- 📰 **MTN today** — the latest news about MTN, fetched fresh every day
- 🗣️ **Zulu word of the day** — with pronunciation and an example you can try
- 💡 **Did you know?** — one tech thing explained in plain English
  (what's a pull request, what's Supabase, what's Claude… a new one daily)

It's a website that installs like an app: it gets its own icon on your home
screen, opens full-screen, and can pop up a daily notification.

Everything is free. No accounts, no database, nothing to sign up for.

---

# Part 1 · Put it online — GitHub, ~2 min

The app's files are already in this project. You just need GitHub Pages
pointed at the branch that contains them.

1. Go to **github.com/Brad-H-tech/poll** and sign in.
2. Click the **Settings** tab along the top (far right of the row that
   starts with "Code").
3. In the left-hand menu, scroll down and click **Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, open the first dropdown and choose
   **`claude/daily-mtn-claude-notifier-h0m9i3`**. Leave the second dropdown
   on **/ (root)**. Click **Save**.

   > Already using Pages for another app in this project (like SlipStream)?
   > No problem — this branch contains **all** the apps, so switching to it
   > keeps the others working at their same addresses.

6. Wait a minute or two, then open:
   **https://brad-h-tech.github.io/poll/sawubona/**

You should see the yellow Sawubona screen with today's brief.

---

# Part 2 · Install it on your phone, ~1 min

Open **https://brad-h-tech.github.io/poll/sawubona/** on your phone.

**Android (Chrome):**
1. Tap the **⋮** menu (top right).
2. Tap **Add to Home screen** (sometimes called **Install app**).
3. Confirm. A yellow sun icon appears on your home screen — open it from
   there from now on.

**iPhone (Safari):**
1. Tap the **Share** button (the square with the arrow, bottom of the screen).
2. Scroll down, tap **Add to Home Screen**, then **Add**.
3. Open it from the new icon (this matters — notifications on iPhone only
   work when the app was opened from the home-screen icon).

---

# Part 3 · Turn on the daily notification, ~30 sec

1. Open the app **from its home-screen icon**.
2. Scroll to the **Daily notification** card and tap
   **Turn on daily notifications**.
3. When your phone asks for permission, tap **Allow**.

You'll get today's brief straight away as a test.

**How the timing works, honestly:** phones don't let websites promise an
exact delivery time — the phone itself decides when to wake the app up,
roughly once a day. On Android this happens in the background
automatically. On iPhone it's more restrictive: opening the app now and
then is what keeps the daily brief flowing. Either way, the brief inside
the app is always up to date the moment you open it.

---

# Part 4 (optional) · AI mode

Out of the box, the news card shows real MTN headlines gathered from
Google News — free, no setup.

If you want an actual **AI agent** to search the web each day and *write*
your summary in friendly bullet points, you can plug in Claude:

1. Go to **console.anthropic.com**, create an account, and add a small
   amount of credit (a few dollars lasts a long time — each daily summary
   costs a few cents).
2. In the console, create an **API key** (it starts with `sk-ant-`).
   Treat it like a password.
3. In the app, open **⚡ AI mode (optional)**, paste the key, and tap
   **Save key & use AI mode**.

From then on the news card says **✦ WRITTEN BY CLAUDE** and shows a daily
summary written just for you. The key is stored only on your phone. Tap
**Turn off AI mode** any time to go back to plain headlines.

---

# Questions you might have

**Where do the Zulu words and tech facts come from?**
They're built into the app — 83 Zulu words and 62 plain-English tech
explainers that rotate daily, so you get months of content before anything
repeats.

**Does it work offline?**
Yes — the app itself opens without signal (it shows the day's word and
fact; news needs a connection).

**Can someone else install it too?**
Absolutely. Just send them the link — anyone can install it, and everyone
sees the same word and fact on the same day. Nice for learning together.

**How do I change or add words/facts?**
Ask Claude! The lists live in `sawubona/data.js` — a request like "add 20
more Zulu words to Sawubona" is all it takes.
