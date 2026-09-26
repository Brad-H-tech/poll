/* Chase API — Cloudflare Worker entry point.
   Request → CORS/preflight → find route → rate-limit → authenticate → scope →
   parse body → resolve store → handler → JSON, with security headers and an
   audit row for every write and every refusal. */
import { makeDb, DbError, publicError } from './db.js';
import { authenticate, callerHint } from './auth.js';
import { HttpError, securityHeaders, corsHeaders, RateLimiter, readJson, requestId, isStoreId } from './security.js';
import { ROUTES, Reply, VERSION } from './routes.js';
import { openapi, docsHtml } from './openapi.js';

const sharedLimiter = new RateLimiter();

export function createApp({ env, fetchImpl, limiter, now } = {}) {
  const db = makeDb(env, fetchImpl);
  const rl = limiter || sharedLimiter;
  const clock = now || (() => Date.now());

  return async function handle(request, ctx) {
    const rid = requestId();
    const started = clock();
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const cors = corsHeaders(request, env);
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
    let actor = null, store = null, route = null, status = 500;

    const finish = (s, body, extraHeaders) => {
      status = s;
      const headers = { ...securityHeaders(rid), ...cors, ...(extraHeaders || {}) };
      if (body instanceof Response) return body;
      if (s === 204) return new Response(null, { status: 204, headers });
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new Response(text, { status: s, headers });
    };
    const fail = (s, code, message, extra) => finish(s, { error: { code, message, request_id: rid } },
      extra && extra.retryAfter ? { 'Retry-After': String(extra.retryAfter) } : undefined);

    let response;
    try {
      if (method === 'OPTIONS') return finish(204, '');

      const pathMatches = ROUTES.filter(r => r.re.test(url.pathname));
      route = pathMatches.find(r => r.method === method);
      if (!route) {
        if (pathMatches.length) throw new HttpError(405, 'method_not_allowed', 'Allowed: ' + pathMatches.map(r => r.method).join(', '));
        throw new HttpError(404, 'not_found', 'Unknown endpoint — see /v1/docs');
      }
      const isWrite = method !== 'GET';

      // pre-auth: a floor per IP so unauthenticated floods (and password-style guessing) cost the caller
      const ipHit = rl.hit('ip:' + ip, Number(env.RATE_IP_PER_MINUTE) || 300);
      if (!ipHit.ok) throw new HttpError(429, 'rate_limited', 'Too many requests from this address', { retryAfter: ipHit.retryAfter });

      if (route.auth !== false) {
        // per-caller limits run BEFORE the database is asked anything, so a throttled caller
        // costs no round trip and burns no budget. The key id is readable from the token.
        const perMinute = Number(env.RATE_PER_MINUTE) || 120;
        const throttle = async id => {
          const hit = rl.hit(id, perMinute);
          if (!hit.ok) throw new HttpError(429, 'rate_limited', 'Too many requests — slow down', { retryAfter: hit.retryAfter });
          if (env.RL && typeof env.RL.limit === 'function') {        // Cloudflare's global rate-limit binding, if configured
            const g = await env.RL.limit({ key: id });
            if (g && g.success === false) throw new HttpError(429, 'rate_limited', 'Too many requests — slow down', { retryAfter: 60 });
          }
        };
        const hint = callerHint(request);
        if (hint) await throttle(hint);
        actor = await authenticate(request, env, db, isWrite, route.userTokens === true);
        if (!hint) await throttle(actor.id);                          // user tokens: known only after the check
        if (!actor.scopes.has(route.scope))
          throw new HttpError(403, 'forbidden', `This needs the ${route.scope} scope; your key has: ${[...actor.scopes].join(', ') || 'none'}`);
        if (route.headOffice && actor.store_id)
          throw new HttpError(403, 'forbidden', 'Only a head-office key may do this');
      }

      const body = isWrite ? await readJson(request, route.maxBody) : {};

      if (route.store !== 'none') {
        const wanted = String(url.searchParams.get('store') || body.store || '').trim();
        if (actor.store_id) {
          if (wanted && wanted !== actor.store_id)
            throw new HttpError(403, 'forbidden', `Your key is limited to store ${actor.store_id}`);
          store = actor.store_id;
        } else {
          if (!wanted) throw new HttpError(400, 'missing', 'A head-office key must say which store: ?store=s1');
          if (!isStoreId(wanted)) throw new HttpError(400, 'invalid', 'store must look like s1');
          store = wanted;
        }
      }

      const c = {
        env, db, actor, store, body, request, ctx, query: url.searchParams,
        params: Object.fromEntries(route.keys.map((k, i) => [k, decodeParam(route.re.exec(url.pathname)[i + 1])])),
        openapi: () => openapi(url.origin),
        docs: () => new Response(docsHtml(url.origin), { status: 200, headers: {
          ...securityHeaders(rid), 'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } }),
      };
      const out = await route.handler(c);
      response = out instanceof Response ? (status = out.status, out)
               : out instanceof Reply ? finish(out.status, out.body)
               : finish(200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) response = fail(e.status, e.code, e.message, e.extra);
      else if (e instanceof DbError) {
        const p = publicError(e);
        if (p.status >= 500) console.error(`[${rid}] db ${e.status} ${e.code}: ${e.message}`);
        response = fail(p.status, p.code, p.message);
      } else if (e && e.name === 'TimeoutError') response = fail(504, 'timeout', 'The database took too long to answer');
      else { console.error(`[${rid}]`, e && e.stack || e); response = fail(500, 'internal', 'Something went wrong on our side'); }
    }

    // audit every write and every refusal of an identifiable caller (a real key id, or a checked
    // login). Requests with no credential at all are not written down: that would let anyone
    // grow the audit table for free. They are still rate-limited per IP.
    const identifiable = !!actor || !!callerHint(request);
    if (route && route.auth !== false && identifiable && (method !== 'GET' || [401, 403, 429].includes(status))) {
      const row = {
        request_id: rid,
        key_id: actor && actor.key_id || null, actor: actor ? String(actor.name).slice(0, 80) : '',
        // a refusal that happened before the store was resolved is still attributed to the key's own store
        method, path: url.pathname.slice(0, 200), store_id: store || (actor && actor.store_id) || null,
        status, ms: Math.max(0, clock() - started),
        ip: String(ip).slice(0, 64), detail: status >= 400 ? (await safeErrorText(response)).slice(0, 400) : '',
      };
      const p = db.audit(row);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    }
    return response;
  };
}

function decodeParam(s) {
  try { return decodeURIComponent(s); }
  catch (e) { throw new HttpError(400, 'invalid', 'Bad percent-encoding in the URL'); }
}

async function safeErrorText(res) {
  try { const j = await res.clone().json(); return (j.error && (j.error.code + ': ' + j.error.message)) || ''; } catch (e) { return ''; }
}

export { VERSION, ROUTES };
export default {
  async fetch(request, env, ctx) {
    return createApp({ env })(request, ctx);
  },
};
