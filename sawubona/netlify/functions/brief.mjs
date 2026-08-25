// ============================================================
//  brief — a real Claude agent writes today's MTN summary
// ============================================================
//  This runs on Netlify's servers, NOT on your phone, which means
//  your Anthropic API key never leaves Netlify. Nobody using the
//  app can see it or spend your credit outside the app.
//
//  Setup: in Netlify, add an environment variable called
//         ANTHROPIC_API_KEY  (Site configuration -> Environment
//         variables). If it isn't set, the app quietly falls back
//         to plain headlines — nothing breaks.
//
//  Called by the app as:  /.netlify/functions/brief
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

const PROMPT =
  "Search the web for today's news about MTN (the African mobile telecommunications " +
  "company — MTN Group / MTN South Africa). Then write a friendly morning-brief " +
  "summary: 3 to 5 short bullet points of the most interesting recent MTN news, each " +
  "one or two sentences, in plain English with no jargon. If there is genuinely " +
  "nothing new about MTN today, say so in one line and instead give the most " +
  "interesting recent cellphone news (Samsung, Apple/iPhone, Honor, Huawei, Xiaomi). " +
  "Reply with the bullet points only — no preamble.";

export default async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "AI mode is not set up on this site yet." }, 503);
  }

  const client = new Anthropic();

  try {
    const params = {
      model: "claude-opus-5",
      max_tokens: 2000,
      // Refusal fallback: if a safety classifier declines the request,
      // Anthropic re-runs it on Opus 4.8 inside the same call instead of
      // returning nothing. Safe to delete these two lines if you'd rather not.
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: PROMPT }],
    };

    let response;
    try {
      response = await client.beta.messages.create(params);
    } catch (e) {
      // If this account can't use the refusal-fallback beta, just go without it
      // rather than losing AI mode entirely.
      if (e?.status === 400) {
        delete params.betas;
        delete params.fallbacks;
        response = await client.beta.messages.create(params);
      } else {
        throw e;
      }
    }

    // A long web-search turn can pause partway; nudge it to finish.
    for (let i = 0; i < 2 && response.stop_reason === "pause_turn"; i++) {
      response = await client.beta.messages.create({
        ...params,
        messages: [
          { role: "user", content: PROMPT },
          { role: "assistant", content: response.content },
        ],
      });
    }

    if (response.stop_reason === "refusal") {
      return json({ error: "Claude declined this request — showing headlines instead." }, 200);
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) return json({ error: "Claude returned an empty answer." }, 200);

    return json({ brief: text, model: response.model }, 200, {
      // One shared answer per 30 minutes keeps the cost tiny even
      // if the whole family opens the app at breakfast.
      "Cache-Control": "public, max-age=1800",
    });
  } catch (e) {
    const status = e?.status === 401 ? 401 : 502;
    const msg = e?.status === 401
      ? "That Anthropic API key was rejected — check it in Netlify."
      : (e?.message || "Could not reach Claude.");
    return json({ error: msg }, status);
  }
};

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extra || {}) },
  });
}
