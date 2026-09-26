/* A stand-in for Supabase (PostgREST + Auth), faithful to the calls the worker makes.
   Keeps tables in memory, records every request, and implements the `api.*`
   functions with the same contracts as api/sql/001_api.sql — so the worker
   can be driven end-to-end without a network. */
import { sha256Hex } from '../src/security.js';

export const SECRET = 'S3cr3t-S3cr3t-S3cr3t-S3cr3t-S3cr3t-S3cr3t-0';   // 43 chars, url-safe
const hex32 = n => String(n).padStart(32, '0');
const uuidOf = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
export const keyString = n => `chk_${hex32(n)}.${SECRET}`;

export async function fakeSupabase() {
  const hash = await sha256Hex(SECRET);
  const day = new Date().toISOString().slice(0, 10);
  const k = (n, name, store_id, scopes, extra) => ({ id: uuidOf(hex32(n)), name, key_hash: hash, store_id, scopes,
    daily_limit: 1000, active: true, expires_at: null, created_by: 'seed', created_at: '2026-09-01T00:00:00Z', last_used_at: null, ...extra });
  const state = {
    keys: [
      k(1, 'Head office', null, ['read', 'write', 'manage']),
      k(2, 'Montrose read', 's1', ['read']),
      k(3, 'Montrose write', 's1', ['read', 'write']),
      k(4, 'Revoked', 's1', ['read'], { active: false }),
      k(5, 'Expired', 's1', ['read'], { expires_at: '2020-01-01T00:00:00Z' }),
      k(6, 'Tiny budget', 's1', ['read'], { daily_limit: 2 }),
      k(7, 'Montrose manager', 's1', ['read', 'write', 'manage']),
    ],
    usage: {}, audit: [],
    stores: [
      { id: 's1', name: 'Montrose', sort: 1, wa_tpl: 'Hi {name}', quotes: '', report_to: '27820000000', verify_at: null },
      { id: 's2', name: 'Kokstad', sort: 2, wa_tpl: '', quotes: '', report_to: '', verify_at: null },
    ],
    book: {
      s1: [{ acct: 'SB10251', name: 'Thandi Ndlovu', msisdn: '27821234567', owner: 'SIPHO', outcome: 'cb', rsp: 599 },
           { acct: 'SB10252', name: 'Bongani Zulu', msisdn: '27829999999', owner: '', outcome: '', rsp: 299 }],
      s2: [{ acct: 'KK1', name: 'Kokstad Person', msisdn: '27820000001', owner: '', outcome: '', rsp: 100 }],
    },
    tracking: [{ store_id: 's1', acct: 'SB10251', agent: 'SIPHO', st: 'cb', acts: [], hist: [] }],
    claims: [{ id: '11111111-1111-4111-8111-111111111111', store_id: 's1', acct: 'SB10252', customer: 'Bongani Zulu', by_name: 'Sipho', agent: 'SIPHO', status: 'pending', at: day, decided: null, created_at: '2026-09-26T08:00:00Z' }],
    bases: [{ id: '22222222-2222-4222-8222-222222222222', store_id: 's1', label: 'Sep', active: true, rows: [['SIPHO', 'Thandi', 'Ndlovu', 'SB10251', '27821234567'], ['', 'Bongani', 'Zulu', 'SB10252', '27829999999']], created_at: '2026-09-01T00:00:00Z' }],
    profiles: [
      { id: 'u-mgr', username: 'bradley', name: 'Bradley', role: 'manager', agent: '', store_id: null },
      { id: 'u-con', username: 'sipho', name: 'Sipho', role: 'consultant', agent: 'SIPHO', store_id: 's1' },
      { id: 'u-nop', username: 'ghost', name: 'Ghost', role: 'consultant', agent: '', store_id: 's1', hidden: true },
    ],
    users: [{ id: 'u-mgr', email: 'bradley@chase.local', jwt: 'h.manager.sig' }, { id: 'u-con', email: 'sipho@chase.local', jwt: 'h.consultant.sig' },
            { id: 'u-nop', email: 'ghost@chase.local', jwt: 'h.noprofile.sig' }],
    calls: [],
  };

  const fail = (code, message, status = 400) => { const e = new Error(message); e.code = code; e.status = status; throw e; };
  const rpcs = {
    authenticate({ p_key_id, p_hash, p_write }) {
      const key = state.keys.find(x => x.id === p_key_id);
      if (!key || key.key_hash !== p_hash) return { ok: false, reason: 'bad_key' };
      if (!key.active) return { ok: false, reason: 'revoked' };
      if (key.expires_at && key.expires_at < new Date().toISOString()) return { ok: false, reason: 'expired' };
      const u = state.usage[key.id + day] ||= { calls: 0, writes: 0 };
      u.calls++; if (p_write) u.writes++;
      const total = Object.values(state.usage).reduce((s, x) => s + x.calls, 0);
      return { ok: u.calls <= key.daily_limit, reason: u.calls > key.daily_limit ? 'daily_limit' : null,
        key: { id: key.id, name: key.name, store_id: key.store_id, scopes: key.scopes, daily_limit: key.daily_limit },
        calls_today: u.calls, total_today: total };
    },
    customers({ p_store, p_q, p_agent, p_status, p_offset, p_limit }) {
      let rows = state.book[p_store] || [];
      if (p_q) rows = rows.filter(r => (r.name + r.acct + r.msisdn).toLowerCase().includes(p_q.toLowerCase()));
      if (p_agent) rows = rows.filter(r => p_agent === 'none' ? r.owner === '' : r.owner === p_agent.toUpperCase());
      if (p_status) rows = rows.filter(r => p_status === 'none' ? r.outcome === '' : r.outcome === p_status);
      return { total: rows.length, offset: p_offset, limit: p_limit, items: rows.slice(p_offset, p_offset + p_limit) };
    },
    customer({ p_store, p_acct }) {
      const r = (state.book[p_store] || []).find(x => x.acct === p_acct);
      return r ? { ...r, activities: [], history: [] } : null;
    },
    set_outcome({ p_store, p_acct, p_st, p_next, p_note, p_by }) {
      if (!['', 'fu', 'cb', 'quote', 'visit', 'won', 'lost', 'na', 'nowa', 'upg', 'wrong'].includes(p_st)) fail('22023', 'Unknown outcome code');
      if (p_note.length > 5000) fail('23514', 'check violation');
      let t = state.tracking.find(x => x.store_id === p_store && x.acct === p_acct);
      if (!t) { t = { store_id: p_store, acct: p_acct, agent: null, acts: [], hist: [] }; state.tracking.push(t); }
      if ((t.st || '') !== p_st) t.hist.unshift({ from: t.st || '', to: p_st, by: p_by });
      Object.assign(t, { st: p_st, next: p_next, note: p_note, by_name: p_by });
      return { acct: p_acct, outcome: p_st, next_action: p_next, note: p_note, updated_by: p_by, history: t.hist };
    },
    log_activity({ p_store, p_acct, p_t, p_by }) {
      let t = state.tracking.find(x => x.store_id === p_store && x.acct === p_acct);
      if (!t) { t = { store_id: p_store, acct: p_acct, agent: null, acts: [], hist: [] }; state.tracking.push(t); }
      t.acts.unshift({ t: p_t, by: p_by });
      return { acct: p_acct, activities: t.acts };
    },
    add_walkin({ p_store, p_name }) {
      if (!p_name.trim()) fail('22023', 'A name is required');
      const b = state.bases.find(x => x.store_id === p_store && x.active);
      if (!b) fail('22023', 'Load a base first');
      const acct = 'WI' + String(b.rows.length).padStart(8, '0');
      b.rows.push(['', p_name, '', acct]);
      return { acct, base_id: b.id };
    },
    assign({ p_store, p_accts, p_agent }) {
      if (new Set(p_accts).size !== p_accts.length) fail('21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time');
      for (const a of p_accts) {
        let t = state.tracking.find(x => x.store_id === p_store && x.acct === a);
        if (!t) { t = { store_id: p_store, acct: a, acts: [], hist: [] }; state.tracking.push(t); }
        t.agent = p_agent === null ? null : p_agent.toUpperCase();
      }
      return p_accts.length;
    },
    raise_claim({ p_store, p_acct, p_customer, p_by, p_agent }) {
      const t = state.tracking.find(x => x.store_id === p_store && x.acct === p_acct);
      if (t && t.agent) fail('23505', 'Already assigned', 409);
      if (state.claims.some(c => c.store_id === p_store && c.acct === p_acct && c.status === 'pending')) fail('23505', 'duplicate key', 409);
      const c = { id: '33333333-3333-4333-8333-' + String(state.claims.length).padStart(12, '0'), store_id: p_store, acct: p_acct, customer: p_customer, by_name: p_by, agent: p_agent, status: 'pending', at: day, decided: null };
      state.claims.push(c); return c;
    },
    decide_claim({ p_store, p_claim, p_verdict }) {
      const c = state.claims.find(x => x.id === p_claim && x.store_id === p_store && x.status === 'pending');
      if (!c) fail('P0002', 'No pending claim', 404);
      c.status = p_verdict; c.decided = day;
      let owner = null;
      if (p_verdict === 'approved') { owner = c.agent || c.by_name.toUpperCase(); rpcs.assign({ p_store, p_accts: [c.acct], p_agent: owner }); }
      return { id: c.id, acct: c.acct, status: p_verdict, owner };
    },
    bases({ p_store }) { return state.bases.filter(b => b.store_id === p_store).map(b => ({ id: b.id, label: b.label, active: b.active, rows: b.rows.length, created_at: b.created_at })); },
    base_rows({ p_store, p_base, p_offset, p_limit }) {
      const b = state.bases.find(x => x.id === p_base && x.store_id === p_store);
      if (!b) return {};
      return { id: b.id, label: b.label, total: b.rows.length, offset: p_offset, limit: p_limit, columns: ['csr', 'name'], rows: b.rows.slice(p_offset, p_offset + p_limit) };
    },
    load_base({ p_store, p_label, p_rows }) {
      if (!Array.isArray(p_rows) || !p_rows.length) fail('22023', 'rows must be a non-empty array of rows');
      if (p_rows.length > 50000) fail('23514', 'check violation');
      state.bases.forEach(b => { if (b.store_id === p_store) b.active = false; });
      const b = { id: '44444444-4444-4444-8444-' + String(state.bases.length).padStart(12, '0'), store_id: p_store, label: p_label || 'Uploaded base', active: true, rows: p_rows, created_at: new Date().toISOString() };
      state.bases.push(b); return { id: b.id, rows: p_rows.length };
    },
    summary({ p_store }) {
      const b = state.book[p_store] || [];
      return { store: p_store, customers: b.length, offer_value: b.reduce((s, x) => s + x.rsp, 0), won: b.filter(x => x.outcome === 'won').length };
    },
    usage_report({ p_key, p_days }) {
      return Object.entries(state.usage).filter(([id]) => !p_key || id.startsWith(p_key)).map(([id, u]) => ({ key_id: id.slice(0, 36), day, calls: u.calls, writes: u.writes, denied: 0, days: p_days }));
    },
    mint_key({ p_name, p_store, p_scopes, p_daily_limit, p_expires_days, p_created_by }) {
      const n = state.keys.length + 1;
      const id = uuidOf(hex32(n));
      state.keys.push({ id, name: p_name, key_hash: hash, store_id: p_store, scopes: p_scopes, daily_limit: p_daily_limit, active: true,
        expires_at: p_expires_days ? new Date(Date.now() + p_expires_days * 864e5).toISOString() : null, created_by: p_created_by, created_at: new Date().toISOString() });
      return [{ id, key: keyString(n) }];
    },
  };

  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers, body });
    const schema = headers['Accept-Profile'] || 'public';
    const isService = headers.Authorization === 'Bearer service';

    /* ---- auth server ---- */
    if (u.pathname === '/auth/v1/user') {
      const jwt = String(headers.Authorization || '').replace(/^Bearer /, '');
      const user = state.users.find(x => x.jwt === jwt);
      return user ? json(200, { id: user.id, email: user.email }) : json(401, { message: 'invalid JWT' });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (!isService) return json(401, { message: 'service role required' });
      // GoTrue's real shape: { code, error_code, msg }
      if (state.users.some(x => x.email === body.email)) return json(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
      if (/^weak/.test(body.password)) return json(422, { code: 422, error_code: 'weak_password', msg: 'Password should contain at least one symbol' });
      const id = 'u-new-' + (state.users.length + 1);
      state.users.push({ id, email: body.email, jwt: 'h.' + id + '.sig' });
      return json(200, { id, email: body.email });
    }
    const del = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(u.pathname);
    if (del && method === 'DELETE') { state.users = state.users.filter(x => x.id !== decodeURIComponent(del[1])); return json(200, {}); }

    /* ---- rpc ---- */
    const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
    if (m) {
      if (!isService) return json(401, { code: '42501', message: 'permission denied' });
      if (schema !== 'api') return json(404, { code: 'PGRST202', message: 'function not found in public' });
      const fn = rpcs[m[1]];
      if (!fn) return json(404, { code: 'PGRST202', message: 'no such function ' + m[1] });
      try { return json(200, fn(body || {})); }
      catch (e) { return json(e.status || 400, { code: e.code, message: e.message }); }
    }

    /* ---- tables ---- */
    const t = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
    if (t) {
      const table = t[1];
      if (schema === 'api' && !['keys', 'usage', 'audit'].includes(table)) return json(404, { code: 'PGRST205', message: 'no table' });
      if (table === 'profiles' && !isService) {
        // RLS: a user token only ever sees their own row (and "hidden" simulates a login with no profile)
        const jwt = String(headers.Authorization || '').replace(/^Bearer /, '');
        const user = state.users.find(x => x.jwt === jwt);
        const rows = state.profiles.filter(p => user && p.id === user.id && !p.hidden);
        return json(200, rows);
      }
      if (!isService) return json(401, { code: '42501', message: 'permission denied' });
      const rows = state[table] || (state[table] = []);
      const filters = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
      const match = r => filters.every(([k, v]) => {
        if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
        if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
        return true;
      });
      const project = r => {
        const sel = u.searchParams.get('select');
        if (!sel || sel === '*') return r;
        return Object.fromEntries(sel.split(',').map(c => [c, r[c]]));
      };
      if (method === 'GET') {
        let out = rows.filter(match);
        const lim = Number(u.searchParams.get('limit')); if (lim) out = out.slice(0, lim);
        return json(200, out.map(project));
      }
      if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(200, hit.map(project)); }
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        if (table === 'profiles' && list.some(r => rows.some(x => x.username === r.username))) return json(409, { code: '23505', message: 'duplicate key' });
        rows.push(...list);
        return headers.Prefer === 'return=minimal' ? new Response('', { status: 201 }) : json(201, list);
      }
    }
    return json(404, { message: 'fake: unhandled ' + method + ' ' + u.pathname });
  }

  return { state, fetchImpl };
}
