// ============================================================
//  news — fetches MTN / phone headlines for the app
// ============================================================
//  Phone browsers aren't allowed to fetch news feeds from other
//  websites directly (a browser security rule called CORS).
//  This tiny helper runs on Netlify's servers instead, grabs the
//  headlines, and hands them to the app. No keys, no setup.
//
//  Called by the app as:  /.netlify/functions/news?q=<search>
// ============================================================

export default async (req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (!q || q.length > 300) {
    return new Response("Missing or oversized ?q= search", { status: 400 });
  }

  const feed =
    "https://news.google.com/rss/search?q=" + encodeURIComponent(q) +
    "&hl=en-ZA&gl=ZA&ceid=ZA:en";

  try {
    const res = await fetch(feed, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SawubonaApp/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error("news source returned " + res.status);
    const xml = await res.text();

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Let Netlify's edge cache hold it for 10 minutes so we're
        // not hammering the news feed on every single app open.
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (e) {
    return new Response("Could not reach the news feed: " + e.message, { status: 502 });
  }
};
