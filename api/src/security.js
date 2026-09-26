/* Chase API — the guard rails.
   Everything here exists so the API cannot be abused: strict headers, a CORS
   allow-list, per-caller rate limits, body-size caps, safe JSON parsing and
   constant-time secret comparison. No business logic lives in this file. */

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message); this.name = 'HttpError';
    this.status = status; this.code = code; this.extra = extra;
  }
}

export const OUTCOMES = ['', 'fu', 'cb', 'quote', 'visit', 'won', 'lost', 'na', 'nowa', 'upg', 'wrong'];
export const ACTIVITIES = ['wa', 'call', 'na', 'sms', 'em'];
export const SCOPES = ['read', 'write', 'manage'];

/* ---- headers every response carries ---- */
export function securityHeaders(requestId) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex',
    'X-Request-Id': requestId,
  };
}

/* ---- CORS: only origins named in CHASE_ALLOWED_ORIGINS, never "*" ---- */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = String(env.CHASE_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

/* ---- rate limiting: fixed one-minute windows per caller, in memory ----
   Cloudflare runs many isolates, so this is a per-isolate floor; the Workers
   rate-limit binding (env.RL, see wrangler.jsonc) is the global ceiling. */
export class RateLimiter {
  constructor(now) { this.buckets = new Map(); this.now = now || (() => Date.now()); this.ops = 0; }
  /** returns { ok, remaining, retryAfter } */
  hit(key, limit, windowMs = 60000) {
    const t = this.now();
    if (++this.ops % 500 === 0) this.prune(t);
    let b = this.buckets.get(key);
    if (!b || b.reset <= t) { b = { n: 0, reset: t + windowMs }; this.buckets.set(key, b); }
    b.n++;
    const ok = b.n <= limit;
    return { ok, remaining: Math.max(0, limit - b.n), retryAfter: Math.ceil((b.reset - t) / 1000) };
  }
  prune(t) { for (const [k, b] of this.buckets) if (b.reset <= t) this.buckets.delete(k); }
}

/* ---- body reading with a hard size cap and safe JSON ---- */
export async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', `Body larger than ${maxBytes} bytes`);
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', `Body larger than ${maxBytes} bytes`);
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch (e) { throw new HttpError(400, 'bad_json', 'Body must be a JSON object'); }
}

/* ---- input helpers: every field is clamped before it goes anywhere ---- */
export const str = (v, max) => String(v == null ? '' : v).slice(0, max);
export function requireStr(v, max, field) {
  const s = str(v, max).trim();
  if (!s) throw new HttpError(400, 'missing', `${field} is required`);
  return s;
}
export function oneOf(v, list, field) {
  const s = str(v, 20);
  if (!list.includes(s)) throw new HttpError(400, 'invalid', `${field} must be one of: ${list.filter(Boolean).join(', ')}`);
  return s;
}
export function isoDate(v, field) {
  const s = str(v, 10);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, 'invalid', `${field} must be YYYY-MM-DD`);
  return s;
}
export function intIn(v, min, max, dflt) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
export const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
export const isStoreId = v => /^s\d{1,3}$/.test(String(v || ''));
export const cleanAcct = v => str(v, 40).replace(/[^A-Za-z0-9._-]/g, '');

/* ---- crypto ---- */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export function requestId() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
