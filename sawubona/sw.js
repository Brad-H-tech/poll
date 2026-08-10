// Sawubona service worker — caches the app shell so it opens instantly (and
// offline), and shows the daily notification when the browser wakes us up via
// periodic background sync. Bump VERSION when app files change.
const VERSION = "sawubona-v4";
const SHELL = ["./", "./index.html", "./data.js", "./manifest.webmanifest",
               "./icon-192.png", "./icon-512.png"];

importScripts("data.js"); // ZULU_WORDS, zuluWordOfTheDay(), fetchMtnNews(), …

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin files (so updates arrive), cache fallback offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Roughly once a day (browser decides exactly when) — build and show the brief.
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "daily-brief") e.waitUntil(showDailyBrief());
});

async function showDailyBrief() {
  const zw = zuluWordOfTheDay();
  let headline = "Tap for today's MTN news";
  try {
    // Daily web search: MTN first, phone world (Samsung/iPhone/Honor…) if quiet
    const items = await fetchMtnNews(1);
    if (items[0]) headline = items[0].title;
  } catch (e) {
    try {
      const items = await fetchPhoneNews(1);
      if (items[0]) headline = "📱 " + items[0].title;
    } catch (e2) { headline = "📱 " + phoneFactOfTheDay().t; }
  }
  return self.registration.showNotification("Sawubona! ☀️ Your daily brief", {
    body: "📰 " + headline +
          "\n🗣️ " + zw.w + " — " + zw.m +
          "\n🎮 Play today's word quiz — keep the streak!",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "sawubona-daily",
  });
}

// Tapping the notification opens (or focuses) the app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes("sawubona") && "focus" in w) return w.focus();
      }
      return clients.openWindow("./index.html");
    })
  );
});
