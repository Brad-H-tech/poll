/* Chase API — behaviour tests. Run:  cd api && node --test
   Each test drives the real worker code against the in-memory Supabase stand-in. */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, ROUTES } from '../src/index.js';
import { RateLimiter } from '../src/security.js';
import { openapi } from '../src/openapi.js';
import { fakeSupabase, keyString } from './fake.js';

const ENV = {
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_KEY: 'service', SUPABASE_ANON_KEY: 'anon',
  CHASE_ALLOWED_ORIGINS: 'https://chase-crm.example', CHASE_DAILY_CAP: '1000', RATE_PER_MINUTE: '1000', RATE_IP_PER_MINUTE: '10000',
};
const HEAD = keyString(1), READ = keyString(2), WRITE = keyString(3), REVOKED = keyString(4), EXPIRED = keyString(5), TINY = keyString(6), MGR = keyString(7);
const BASE = 'https://api.test';

let fake, app, pending;
async function fresh(envOverride = {}, limiter) {
  fake = await fakeSupabase();
  pending = [];
  app = createApp({ env: { ...ENV, ...envOverride }, fetchImpl: fake.fetchImpl, limiter: limiter || new RateLimiter() });
}
async function call(method, path, { key, jwt, body, headers = {} } = {}) {
  const h = { ...headers };
  if (key) h.Authorization = 'Bearer ' + key;
  if (jwt) h.Authorization = 'Bearer ' + jwt;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const req = new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const res = await app(req, { waitUntil: p => pending.push(p) });
  await Promise.all(pending.splice(0));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json, headers: res.headers };
}
const audits = () => fake.state.audit;

describe('system', () => {
  beforeEach(() => fresh());
  test('health needs no key', async () => {
    const r = await call('GET', '/v1/health');
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
  });
  test('every response carries the security headers and a request id', async () => {
    const r = await call('GET', '/v1/health');
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.match(r.headers.get('Strict-Transport-Security'), /max-age=31536000/);
    assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.match(r.headers.get('X-Request-Id'), /^[0-9a-f]{16}$/);
  });
  test('unknown endpoint → 404, wrong verb → 405, both as JSON', async () => {
    assert.equal((await call('GET', '/v1/nope')).status, 404);
    const r = await call('DELETE', '/v1/health');
    assert.equal(r.status, 405); assert.match(r.json.error.message, /GET/);
  });
  test('openapi.json lists every route and every route has docs', async () => {
    const r = await call('GET', '/v1/openapi.json');
    assert.equal(r.status, 200); assert.equal(r.json.openapi, '3.1.0');
    for (const route of ROUTES) {
      const p = r.json.paths[route.path.replace(/:(\w+)/g, '{$1}')];
      assert.ok(p && p[route.method.toLowerCase()], 'missing in spec: ' + route.method + ' ' + route.path);
      assert.ok(route.summary, 'no summary: ' + route.path);
    }
    assert.equal(openapi('https://x').servers[0].url, 'https://x');
  });
  test('docs page is HTML with its own strict CSP and no scripts', async () => {
    const r = await call('GET', '/v1/docs');
    assert.equal(r.status, 200); assert.match(r.headers.get('Content-Type'), /text\/html/);
    assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.ok(!/<script/i.test(r.json), 'docs must not need JavaScript');
    assert.match(r.json, /\/v1\/customers/);
  });
});

describe('authentication', () => {
  beforeEach(() => fresh());
  test('no key → 401; not audited (nothing to attribute) and the database is not asked', async () => {
    const r = await call('GET', '/v1/me');
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'unauthenticated');
    assert.equal(audits().length, 0); assert.equal(fake.state.calls.length, 0);
  });
  test('wrong secret → 401 (hash compared, secret never sent to the database) and it IS audited with the request id', async () => {
    const r = await call('GET', '/v1/me', { key: keyString(2).replace(/\.S3/, '.X3') });
    assert.equal(r.status, 401);
    assert.equal(audits().length, 1); assert.equal(audits()[0].status, 401);
    assert.equal(audits()[0].request_id, r.headers.get('X-Request-Id'));
    const authCall = fake.state.calls.find(c => c.path.endsWith('/rpc/authenticate'));
    assert.ok(authCall, 'authenticate rpc called');
    assert.match(authCall.body.p_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(authCall.body).includes('S3cr3t'), 'secret must not leave the worker');
  });
  test('garbage token → 401', async () => {
    assert.equal((await call('GET', '/v1/me', { key: 'hello' })).status, 401);
  });
  test('revoked and expired keys → 401 with a reason', async () => {
    assert.equal((await call('GET', '/v1/me', { key: REVOKED })).json.error.code, 'revoked');
    assert.equal((await call('GET', '/v1/me', { key: EXPIRED })).json.error.code, 'expired');
  });
  test('X-Api-Key header works too', async () => {
    const r = await call('GET', '/v1/me', { headers: { 'X-Api-Key': READ } });
    assert.equal(r.status, 200); assert.equal(r.json.actor.name, 'Montrose read');
  });
  test('/v1/me shows scopes, store and today’s usage', async () => {
    const r = await call('GET', '/v1/me', { key: READ });
    assert.deepEqual(r.json.actor.scopes, ['read']); assert.equal(r.json.actor.store_id, 's1');
    assert.equal(r.json.usage.calls_today, 1); assert.equal(r.json.usage.daily_limit, 1000);
  });
  test('user login tokens are refused everywhere except the one endpoint the app needs', async () => {
    for (const path of ['/v1/me', '/v1/customers?store=s1', '/v1/reports/summary?store=s1', '/v1/keys']) {
      const r = await call('GET', path, { jwt: 'h.manager.sig' });
      assert.equal(r.status, 401, path); assert.equal(r.json.error.code, 'keys_only', path);
    }
    assert.equal((await call('POST', '/v1/assignments?store=s1', { jwt: 'h.manager.sig', body: { accts: ['X'], agent: 'Y' } })).json.error.code, 'keys_only');
    assert.ok(!fake.state.calls.some(c => c.path === '/auth/v1/user'), 'Supabase Auth never even consulted');
  });
  test('POST /v1/users with a manager token: profile read under THEIR token (RLS), consultant refused', async () => {
    const r = await call('POST', '/v1/users?store=s1', { jwt: 'h.manager.sig', body: { username: 'newbie', name: 'New B', password: 'longenough-pass' } });
    assert.equal(r.status, 201); assert.equal(r.json.store_id, 's1');
    const prof = fake.state.calls.find(x => x.path === '/rest/v1/profiles' && x.method === 'GET');
    assert.equal(prof.headers.Authorization, 'Bearer h.manager.sig', 'row-level security applied, not the service key');
    const c = await call('POST', '/v1/users', { jwt: 'h.consultant.sig', body: { username: 'x2', name: 'X', password: 'longenough-pass' } });
    assert.equal(c.status, 403);
    assert.equal((await call('POST', '/v1/users?store=s1', { jwt: 'h.noprofile.sig', body: {} })).status, 403);
    assert.equal((await call('POST', '/v1/users?store=s1', { jwt: 'h.bogus.sig', body: {} })).status, 401);
  });
});

describe('authorisation: scopes and stores', () => {
  beforeEach(() => fresh());
  test('a read key cannot write', async () => {
    const r = await call('PUT', '/v1/customers/SB10251/outcome', { key: READ, body: { outcome: 'won' } });
    assert.equal(r.status, 403); assert.match(r.json.error.message, /write scope/);
    assert.equal(fake.state.tracking.find(t => t.acct === 'SB10251').st, 'cb', 'nothing changed');
  });
  test('a write key cannot manage', async () => {
    assert.equal((await call('POST', '/v1/assignments', { key: WRITE, body: { accts: ['SB10252'], agent: 'X' } })).status, 403);
    assert.equal((await call('POST', '/v1/keys', { key: WRITE, body: { name: 'x' } })).status, 403);
  });
  test('a store key cannot look at another store', async () => {
    const r = await call('GET', '/v1/customers?store=s2', { key: READ });
    assert.equal(r.status, 403); assert.match(r.json.error.message, /limited to store s1/);
  });
  test('a store key is pinned to its store even when it says nothing', async () => {
    const r = await call('GET', '/v1/customers', { key: READ });
    assert.equal(r.status, 200); assert.equal(r.json.total, 2);
    assert.equal(fake.state.calls.find(c => c.path.endsWith('/rpc/customers')).body.p_store, 's1');
  });
  test('a head-office key must name the store, and may use any', async () => {
    const none = await call('GET', '/v1/customers', { key: HEAD });
    assert.equal(none.status, 400); assert.match(none.json.error.message, /store/);
    assert.equal((await call('GET', '/v1/customers?store=s2', { key: HEAD })).json.total, 1);
    assert.equal((await call('GET', '/v1/customers?store=bogus', { key: HEAD })).status, 400);
  });
  test('a store manager key cannot mint, list or revoke keys — head office only', async () => {
    assert.equal((await call('POST', '/v1/keys', { key: MGR, body: { name: 'x' } })).status, 403);
    assert.equal((await call('GET', '/v1/keys', { key: MGR })).status, 403);
    assert.equal((await call('DELETE', '/v1/keys/' + fake.state.keys[1].id, { key: MGR })).status, 403);
    assert.equal((await call('GET', '/v1/keys', { key: HEAD })).status, 200);
  });
  test('stores list is filtered to the key’s store', async () => {
    assert.deepEqual((await call('GET', '/v1/stores', { key: READ })).json.map(s => s.id), ['s1']);
    assert.deepEqual((await call('GET', '/v1/stores', { key: HEAD })).json.map(s => s.id), ['s1', 's2']);
  });
});

describe('limits and budgets (the credits)', () => {
  test('per-key daily limit → 429 with Retry-After, and it is audited', async () => {
    await fresh();
    assert.equal((await call('GET', '/v1/health', {})).status, 200);
    assert.equal((await call('GET', '/v1/me', { key: TINY })).status, 200);
    assert.equal((await call('GET', '/v1/me', { key: TINY })).status, 200);
    const r = await call('GET', '/v1/me', { key: TINY });
    assert.equal(r.status, 429); assert.equal(r.json.error.code, 'daily_limit'); assert.equal(r.headers.get('Retry-After'), '3600');
    assert.ok(audits().some(a => a.status === 429));
  });
  test('global daily cap across all keys → 503', async () => {
    await fresh({ CHASE_DAILY_CAP: '2' });
    await call('GET', '/v1/me', { key: READ }); await call('GET', '/v1/me', { key: WRITE });
    const r = await call('GET', '/v1/me', { key: HEAD });
    assert.equal(r.status, 503); assert.equal(r.json.error.code, 'budget');
  });
  test('burst rate limit per caller → 429, decided BEFORE the database is asked (no budget burned)', async () => {
    await fresh({ RATE_PER_MINUTE: '3' });
    for (let i = 0; i < 3; i++) assert.equal((await call('GET', '/v1/me', { key: READ })).status, 200);
    const before = fake.state.calls.filter(c => c.path.endsWith('/rpc/authenticate')).length;
    const r = await call('GET', '/v1/me', { key: READ });
    assert.equal(r.status, 429); assert.equal(r.json.error.code, 'rate_limited'); assert.ok(Number(r.headers.get('Retry-After')) > 0);
    assert.equal(fake.state.calls.filter(c => c.path.endsWith('/rpc/authenticate')).length, before, 'throttled call never reached Supabase');
    assert.equal((await call('GET', '/v1/me', { key: WRITE })).status, 200, 'another caller is unaffected');
  });
  test('bodies: byte-accurate cap, bounded nesting, objects where text is expected → 4xx not 500', async () => {
    await fresh();
    const multibyte = 'é'.repeat(200 * 1024);   // 200k chars = 400 KB
    assert.equal((await call('PUT', '/v1/settings', { key: MGR, body: { wa_tpl: multibyte } })).status, 413);
    let deep = 'x'; for (let i = 0; i < 2000; i++) deep = '[' + deep + ']';
    const nested = await call('PUT', '/v1/settings', { key: MGR, body: '{"wa_tpl":' + deep.replace('x', '1') + '}' });
    assert.equal(nested.status, 400);
    const obj = await call('PUT', '/v1/settings', { key: MGR, body: { wa_tpl: { hello: 'world' } } });
    assert.equal(obj.status, 400);
    const cells = await call('POST', '/v1/bases', { key: MGR, body: { rows: [['ok', { nested: true }]] } });
    assert.equal(cells.status, 400);
  });
  test('a malformed percent-encoded path parameter → 400, not 500', async () => {
    await fresh();
    const r = await call('GET', '/v1/customers/%E0%A4%A', { key: READ });
    assert.equal(r.status, 400); assert.equal(r.json.error.code, 'invalid');
  });
  test('per-IP floor applies before authentication', async () => {
    await fresh({ RATE_IP_PER_MINUTE: '2' });
    const h = { 'CF-Connecting-IP': '203.0.113.9' };
    await call('GET', '/v1/health', { headers: h }); await call('GET', '/v1/health', { headers: h });
    assert.equal((await call('GET', '/v1/health', { headers: h })).status, 429);
    assert.equal((await call('GET', '/v1/health', { headers: { 'CF-Connecting-IP': '203.0.113.10' } })).status, 200);
  });
  test('Cloudflare rate-limit binding is honoured when present', async () => {
    await fresh({ RL: { limit: async () => ({ success: false }) } });
    assert.equal((await call('GET', '/v1/me', { key: READ })).status, 429);
  });
  test('body size caps: 256 KB normally, 8 MB for base uploads', async () => {
    await fresh();
    const big = 'x'.repeat(300 * 1024);
    const r = await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: { outcome: 'cb', note: big } });
    assert.equal(r.status, 413);
    const rows = Array.from({ length: 20000 }, (_, i) => ['A', 'n', 's', 'AC' + i, '2782' + i]);   // ~600 KB, allowed on /v1/bases
    const ok = await call('POST', '/v1/bases', { key: HEAD, body: { store: 's1', label: 'Big', rows } });
    assert.equal(ok.status, 201); assert.equal(ok.json.rows, 20000);
    const tooMany = await call('POST', '/v1/bases', { key: HEAD, body: { store: 's1', rows: Array.from({ length: 50001 }, () => ['a']) } });
    assert.equal(tooMany.status, 413);
  });
  test('customer pages are capped at 200 and offsets clamped', async () => {
    await fresh();
    await call('GET', '/v1/customers?limit=99999&offset=-5', { key: READ });
    const args = fake.state.calls.find(c => c.path.endsWith('/rpc/customers')).body;
    assert.equal(args.p_limit, 200); assert.equal(args.p_offset, 0);
  });
  test('the database is asked for the page, not the whole base', async () => {
    await fresh();
    await call('GET', '/v1/bases/22222222-2222-4222-8222-222222222222/rows?limit=1&offset=1', { key: READ });
    const c = fake.state.calls.find(x => x.path.endsWith('/rpc/base_rows'));
    assert.deepEqual([c.body.p_offset, c.body.p_limit], [1, 1]);
    assert.ok(!fake.state.calls.some(x => x.path === '/rest/v1/bases'), 'no raw bases table read');
  });
});

describe('input validation', () => {
  beforeEach(() => fresh());
  test('malformed JSON and non-object bodies → 400', async () => {
    assert.equal((await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: '{oops' })).status, 400);
    assert.equal((await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: '[1,2]' })).status, 400);
  });
  test('outcome codes, dates and activity types are checked before touching the database', async () => {
    let r = await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: { outcome: 'DROP TABLE' } });
    assert.equal(r.status, 400); assert.match(r.json.error.message, /outcome must be one of/);
    r = await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: { outcome: 'cb', next_action: 'tomorrow' } });
    assert.equal(r.status, 400); assert.match(r.json.error.message, /YYYY-MM-DD/);
    r = await call('POST', '/v1/customers/SB10251/activities', { key: WRITE, body: { type: 'carrier-pigeon' } });
    assert.equal(r.status, 400);
    assert.ok(!fake.state.calls.some(c => /set_outcome|log_activity/.test(c.path)), 'database never called');
  });
  test('account numbers are sanitised and unknown customers are 404', async () => {
    const r = await call('GET', '/v1/customers/SB10251%27%20OR%201=1', { key: READ });
    assert.equal(r.status, 404);
    assert.equal(fake.state.calls.find(c => c.path.endsWith('/rpc/customer')).body.p_acct, 'SB10251OR11');
  });
  test('ids must be UUIDs', async () => {
    assert.equal((await call('POST', '/v1/claims/not-a-uuid/decide', { key: MGR, body: { verdict: 'approved' } })).status, 400);
    assert.equal((await call('GET', '/v1/bases/xyz/rows', { key: READ })).status, 400);
    assert.equal((await call('DELETE', '/v1/keys/xyz', { key: HEAD })).status, 400);
  });
  test('over-long text is trimmed before the database sees it', async () => {
    const r = await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: { outcome: 'cb', note: 'n'.repeat(6000) } });
    assert.equal(r.status, 200);
    assert.equal(fake.state.calls.find(c => c.path.endsWith('/rpc/set_outcome')).body.p_note.length, 5000);
  });
  test('a database rule violation → 422 without leaking table names or SQL', async () => {
    const orig = fake.fetchImpl;
    app = createApp({ env: ENV, limiter: new RateLimiter(), fetchImpl: async (url, init) => {
      if (String(url).endsWith('/rpc/set_outcome'))
        return new Response(JSON.stringify({ code: '23514', message: 'new row for relation "tracking" violates check constraint "tracking_size_chk"', details: 'Failing row contains (...)' }), { status: 400 });
      return orig(url, init);
    } });
    const r = await call('PUT', '/v1/customers/SB10251/outcome', { key: WRITE, body: { outcome: 'cb' } });
    assert.equal(r.status, 422); assert.equal(r.json.error.code, 'rejected');
    assert.ok(!/tracking|constraint|relation/.test(JSON.stringify(r.json)), 'internals hidden');
  });
});

describe('the business calls', () => {
  beforeEach(() => fresh());
  test('search customers with filters', async () => {
    const r = await call('GET', '/v1/customers?q=zulu&status=none&agent=none', { key: READ });
    assert.equal(r.status, 200); assert.equal(r.json.total, 1); assert.equal(r.json.items[0].acct, 'SB10252');
  });
  test('record an outcome: history is written and the caller is stamped as the author', async () => {
    const r = await call('PUT', '/v1/customers/SB10252/outcome', { key: WRITE, body: { outcome: 'won', next_action: '2026-10-01', note: 'Signed!' } });
    assert.equal(r.status, 200); assert.equal(r.json.outcome, 'won'); assert.equal(r.json.updated_by, 'Montrose write');
    assert.equal(r.json.history[0].to, 'won');
    const a = audits().find(x => x.method === 'PUT');
    assert.ok(a); assert.equal(a.status, 200); assert.equal(a.store_id, 's1'); assert.equal(a.actor, 'Montrose write');
  });
  test('log an activity → 201', async () => {
    const r = await call('POST', '/v1/customers/SB10252/activities', { key: WRITE, body: { type: 'wa' } });
    assert.equal(r.status, 201); assert.equal(r.json.activities[0].t, 'wa');
  });
  test('walk-in needs a name; success returns the new account', async () => {
    assert.equal((await call('POST', '/v1/customers', { key: WRITE, body: { msisdn: '0821234567' } })).status, 400);
    const r = await call('POST', '/v1/customers', { key: WRITE, body: { name: 'New Person', msisdn: '0821234567' } });
    assert.equal(r.status, 201); assert.match(r.json.acct, /^WI/);
  });
  test('claims: raise, duplicate → 409, decide (manage) → owner set', async () => {
    const dup = await call('POST', '/v1/claims', { key: WRITE, body: { acct: 'SB10252', customer: 'Bongani' } });
    assert.equal(dup.status, 409);
    const taken = await call('POST', '/v1/claims', { key: WRITE, body: { acct: 'SB10251' } });
    assert.equal(taken.status, 409); assert.match(taken.json.error.message, /assigned/i);
    const list = await call('GET', '/v1/claims?status=pending', { key: READ });
    assert.equal(list.json.length, 1);
    const d = await call('POST', '/v1/claims/11111111-1111-4111-8111-111111111111/decide', { key: MGR, body: { verdict: 'approved' } });
    assert.equal(d.status, 200); assert.equal(d.json.owner, 'SIPHO');
    assert.equal(fake.state.tracking.find(t => t.acct === 'SB10252').agent, 'SIPHO');
    assert.equal((await call('POST', '/v1/claims/11111111-1111-4111-8111-111111111111/decide', { key: MGR, body: { verdict: 'approved' } })).status, 404);
  });
  test('assignments: list overrides; "" = nobody; null = base decides', async () => {
    assert.deepEqual((await call('GET', '/v1/assignments', { key: READ })).json, [{ acct: 'SB10251', agent: 'SIPHO' }]);
    await call('POST', '/v1/assignments', { key: MGR, body: { accts: ['SB10251'], agent: '' } });
    assert.equal(fake.state.tracking[0].agent, '');
    await call('POST', '/v1/assignments', { key: MGR, body: { accts: ['SB10251'], agent: null } });
    assert.equal(fake.state.tracking[0].agent, null);
    const dup = await call('POST', '/v1/assignments', { key: MGR, body: { accts: ['SB10251', 'SB10251', 'SB10252'], agent: 'X' } });
    assert.equal(dup.status, 200); assert.equal(dup.json.assigned, 2, 'duplicates collapsed before the database');
    assert.equal((await call('POST', '/v1/assignments', { key: MGR, body: { accts: [], agent: 'X' } })).status, 400);
  });
  test('bases: metadata only, then paged rows, then a new upload becomes active', async () => {
    const meta = await call('GET', '/v1/bases', { key: READ });
    assert.equal(meta.json[0].rows, 2); assert.ok(!('rows' in meta.json[0]) || typeof meta.json[0].rows === 'number');
    const page = await call('GET', '/v1/bases/22222222-2222-4222-8222-222222222222/rows?limit=1', { key: READ });
    assert.equal(page.json.total, 2); assert.equal(page.json.rows.length, 1);
    const up = await call('POST', '/v1/bases', { key: MGR, body: { label: 'Oct', rows: [['A', 'B', 'C', 'X1']] } });
    assert.equal(up.status, 201);
    assert.equal(fake.state.bases.filter(b => b.store_id === 's1' && b.active).length, 1);
    assert.equal((await call('POST', '/v1/bases', { key: MGR, body: { rows: [1, 2] } })).status, 400);
  });
  test('settings: read for read scope, write for manage only, keys whitelisted', async () => {
    assert.equal((await call('GET', '/v1/settings', { key: READ })).json.wa_tpl, 'Hi {name}');
    assert.equal((await call('PUT', '/v1/settings', { key: WRITE, body: { wa_tpl: 'x' } })).status, 403);
    const r = await call('PUT', '/v1/settings', { key: MGR, body: { wa_tpl: 'Hello {name}', report_to: '+27 82 000 0000; DROP', evil: 'x' } });
    assert.equal(r.status, 200);
    assert.equal(fake.state.stores[0].wa_tpl, 'Hello {name}'); assert.equal(fake.state.stores[0].report_to, '+27 82 000 0000 ');
    assert.ok(!('evil' in fake.state.stores[0]));
    assert.equal((await call('PUT', '/v1/settings', { key: MGR, body: {} })).status, 400);
  });
  test('summary report comes from the database', async () => {
    const r = await call('GET', '/v1/reports/summary', { key: READ });
    assert.equal(r.status, 200); assert.equal(r.json.customers, 2); assert.equal(r.json.offer_value, 898);
  });
});

describe('keys, usage, audit, users', () => {
  beforeEach(() => fresh());
  test('create a key: secret shown once, scopes cannot exceed the creator’s, store as asked', async () => {
    const r = await call('POST', '/v1/keys', { key: HEAD, body: { name: 'Excel', scopes: ['read'], daily_limit: 50, store: 's2' } });
    assert.equal(r.status, 201); assert.match(r.json.key, /^chk_[0-9a-f]{32}\.[A-Za-z0-9_-]{40,}$/);
    assert.equal(r.json.store_id, 's2');
    const list = await call('GET', '/v1/keys', { key: HEAD });
    assert.ok(list.json.every(k => !('key_hash' in k) && !('key' in k)), 'secrets and hashes never listed');
    assert.equal((await call('POST', '/v1/keys', { key: HEAD, body: { name: 'x', scopes: ['root'] } })).status, 400);
    assert.equal((await call('POST', '/v1/keys', { key: HEAD, body: { name: 'x', store: 'nope' } })).status, 400);
    const ho = await call('POST', '/v1/keys', { key: HEAD, body: { name: 'HQ bot' } });
    assert.equal(ho.json.store_id, null);
    // the new key works immediately, inherits its budget, and is pinned to its store
    const me = await call('GET', '/v1/me', { key: r.json.key });
    assert.equal(me.status, 200); assert.equal(me.json.usage.daily_limit, 50);
    assert.equal((await call('GET', '/v1/customers?store=s1', { key: r.json.key })).status, 403);
  });
  test('revoke a key: takes effect at once; cannot revoke the key in use', async () => {
    const created = await call('POST', '/v1/keys', { key: HEAD, body: { name: 'temp', store: 's2' } });
    const id = created.json.id;
    assert.equal((await call('DELETE', '/v1/keys/' + id, { key: HEAD })).json.active, false);
    assert.equal((await call('GET', '/v1/me', { key: created.json.key })).json.error.code, 'revoked');
    const self = await call('DELETE', '/v1/keys/' + fake.state.keys[0].id, { key: HEAD });
    assert.equal(self.status, 400);
  });
  test('usage: a key sees its own days; only a head-office manage key sees every key', async () => {
    await call('GET', '/v1/me', { key: READ });
    const mine = await call('GET', '/v1/usage', { key: READ });
    assert.equal(mine.json.length, 1); assert.equal(mine.json[0].calls, 2);
    const all = await call('GET', '/v1/usage?all=1', { key: HEAD });
    assert.ok(all.json.length >= 2);
    assert.equal(fake.state.calls.filter(c => c.path.endsWith('/rpc/usage_report')).pop().body.p_key, null);
    assert.equal((await call('GET', '/v1/usage?all=1', { key: MGR })).status, 403, 'a store manage key cannot see other stores’ keys');
  });
  test('openapi declares each route’s real success status and the error statuses the dispatcher emits', async () => {
    const spec = (await call('GET', '/v1/openapi.json')).json;
    for (const r of ROUTES) {
      const op = spec.paths[r.path.replace(/:(\w+)/g, '{$1}')][r.method.toLowerCase()];
      assert.ok(op.responses[String(r.status || 200)], `${r.method} ${r.path} should document ${r.status || 200}`);
      for (const s of ['404', '409', '413', '422', '503']) assert.ok(op.responses[s], `${r.path} missing ${s}`);
    }
    assert.ok(spec.paths['/v1/customers']['post'].responses['201']);
  });
  test('audit lists writes and refusals, newest first, store-scoped for store keys', async () => {
    await call('PUT', '/v1/customers/SB10252/outcome', { key: WRITE, body: { outcome: 'fu' } });
    await call('GET', '/v1/customers?store=s2', { key: READ });
    const r = await call('GET', '/v1/audit', { key: MGR });
    assert.equal(r.status, 200);
    assert.ok(r.json.some(a => a.path === '/v1/customers/SB10252/outcome' && a.status === 200));
    assert.ok(r.json.some(a => a.status === 403 && /limited to store/.test(a.detail)));
    assert.equal(fake.state.calls.filter(c => c.path === '/rest/v1/audit' && c.method === 'GET').pop().query.store_id, 'eq.s1');
    assert.equal((await call('GET', '/v1/audit', { key: WRITE })).status, 403);
  });
  test('create a login without public sign-ups: auth user + profile, rollback if the profile fails', async () => {
    const bad = await call('POST', '/v1/users', { key: MGR, body: { username: 'Bad Name!', name: 'x', password: 'short' } });
    assert.equal(bad.status, 400);
    const r = await call('POST', '/v1/users', { key: MGR, body: { username: 'Thandi', name: 'Thandi N', password: 'longenough-pass', agent: 'thandi' } });
    assert.equal(r.status, 201); assert.equal(r.json.username, 'thandi'); assert.equal(r.json.store_id, 's1'); assert.equal(r.json.agent, 'THANDI');
    assert.ok(fake.state.users.some(u => u.email === 'thandi@chase.local'));
    const dup = await call('POST', '/v1/users', { key: MGR, body: { username: 'thandi', name: 'Again', password: 'longenough-pass' } });
    assert.equal(dup.status, 409);
    const weak = await call('POST', '/v1/users', { key: MGR, body: { username: 'weakling', name: 'W', password: 'weak-but-long-enough' } });
    assert.equal(weak.status, 400); assert.match(weak.json.error.message, /password/i);
    // profile insert fails (username taken in profiles but not in auth) → the auth user is removed again
    fake.state.profiles.push({ id: 'zzz', username: 'taken', name: 'T', role: 'consultant', agent: '', store_id: 's1' });
    const rb = await call('POST', '/v1/users', { key: MGR, body: { username: 'taken', name: 'T', password: 'longenough-pass' } });
    assert.equal(rb.status, 409);
    assert.ok(!fake.state.users.some(u => u.email === 'taken@chase.local'), 'orphan login cleaned up');
  });
});

describe('CORS', () => {
  beforeEach(() => fresh());
  test('allowed origin gets CORS headers; others get none; preflight is 204', async () => {
    const ok = await call('GET', '/v1/health', { headers: { Origin: 'https://chase-crm.example' } });
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://chase-crm.example');
    const no = await call('GET', '/v1/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(no.headers.get('Access-Control-Allow-Origin'), null);
    const pre = await call('OPTIONS', '/v1/customers', { headers: { Origin: 'https://chase-crm.example', 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  });
});

describe('when Supabase is not set up yet', () => {
  test('missing api schema → 503 with the fix in the message, not a stack trace', async () => {
    await fresh();
    fake.fetchImpl = async () => new Response(JSON.stringify({ code: 'PGRST106', message: 'schema not exposed' }), { status: 406 });
    app = createApp({ env: ENV, fetchImpl: fake.fetchImpl, limiter: new RateLimiter() });
    const r = await call('GET', '/v1/me', { key: READ });
    assert.equal(r.status, 503); assert.match(r.json.error.message, /Exposed schemas/);
  });
  test('database timeout → 504, unexpected error → 500, neither leaks details', async () => {
    await fresh();
    app = createApp({ env: ENV, fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, limiter: new RateLimiter() });
    assert.equal((await call('GET', '/v1/me', { key: READ })).status, 504);
    app = createApp({ env: ENV, fetchImpl: async () => { throw new Error('secret internal path /etc/x'); }, limiter: new RateLimiter() });
    const r = await call('GET', '/v1/me', { key: READ });
    assert.equal(r.status, 500); assert.ok(!/etc/.test(JSON.stringify(r.json)));
  });
});
