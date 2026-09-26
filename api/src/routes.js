/* Chase API — every endpoint, in one table.
   Each route carries its own documentation (summary, params, body, example), so
   the OpenAPI spec and the /v1/docs page are generated from here and can never
   drift from what the code does.

   Handlers receive `c`:
     c.env      worker environment (vars + secrets)
     c.db       the Supabase client (src/db.js)
     c.actor    who is calling (src/auth.js): { type, name, store_id, scopes, agent, key_id }
     c.store    the store this call is about ('s1' …) — already checked against the actor
     c.params   path parameters, c.query URLSearchParams, c.body parsed JSON (writes only)
   They return a plain object (→ 200 JSON) or reply(status, object). */
import {
  HttpError, str, requireStr, oneOf, isoDate, intIn, isUuid, isStoreId, cleanAcct,
  OUTCOMES, ACTIVITIES, SCOPES,
} from './security.js';

export const VERSION = '1.0.0';
export class Reply { constructor(status, body) { this.status = status; this.body = body; } }
export const reply = (status, body) => new Reply(status, body);

const KB = 1024, MB = 1024 * KB;
function route(method, path, meta, handler) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { method, path, re, keys, handler, auth: true, scope: 'read', store: 'required', maxBody: 256 * KB, ...meta };
}

/* ---- shared schema fragments for the docs ---- */
const S = {
  storeParam: { name: 'store', in: 'query', description: 'Store id (s1 … s7). Required for head-office keys; ignored for store-scoped keys.', example: 's1' },
  customer: {
    acct: 'SB10251', name: 'Thandi Ndlovu', msisdn: '27821234567', email: '', category: 'Consumer', product: 'iPhone 15',
    package: 'Made For Me M', offer: 'R599 p/m', rsp: 599, lines: 1, owner: 'SIPHO', owner_overridden: false,
    outcome: 'cb', next_action: '2026-10-02', note: 'Call back after payday', updated_by: 'Sipho', updated_on: '2026-09-26', verified_on: null,
  },
};

export const ROUTES = [
  /* ------------------------------------------------------------ system */
  route('GET', '/v1/health', { auth: false, store: 'none', tag: 'System', summary: 'Is the API up?',
    example: { ok: true, service: 'chase-api', version: VERSION } },
    async () => ({ ok: true, service: 'chase-api', version: VERSION, time: new Date().toISOString() })),

  route('GET', '/v1/openapi.json', { auth: false, store: 'none', tag: 'System', summary: 'This API described as OpenAPI 3.1 (machine-readable)' },
    async c => c.openapi()),

  route('GET', '/v1/docs', { auth: false, store: 'none', tag: 'System', summary: 'Human-readable reference for every endpoint' },
    async c => c.docs()),

  route('GET', '/v1/me', { store: 'none', tag: 'System', summary: 'Who am I, what may I do, how much budget is left today',
    example: { actor: { type: 'key', name: 'Excel report', store_id: 's1', scopes: ['read'] }, usage: { calls_today: 12, daily_limit: 500 } } },
    async c => ({
      actor: { type: c.actor.type, name: c.actor.name, store_id: c.actor.store_id, scopes: [...c.actor.scopes], agent: c.actor.agent || '' },
      usage: c.actor.type === 'key' ? { calls_today: c.actor.calls_today, daily_limit: c.actor.daily_limit } : null,
    })),

  /* ------------------------------------------------------------ stores */
  route('GET', '/v1/stores', { store: 'none', tag: 'Stores', summary: 'The stores this caller may see',
    example: [{ id: 's1', name: 'Montrose', sort: 1 }] },
    async c => c.db.select('stores', { select: 'id,name,sort', order: 'sort.asc',
      ...(c.actor.store_id ? { id: 'eq.' + c.actor.store_id } : {}) })),

  route('GET', '/v1/settings', { tag: 'Stores', summary: "A store's WhatsApp template, mission quotes, report number and last MTN check",
    params: [S.storeParam], example: { id: 's1', name: 'Montrose', wa_tpl: 'Hi {name}! …', quotes: '', report_to: '27820000000', verify_at: '2026-09-20' } },
    async c => {
      const rows = await c.db.select('stores', { id: 'eq.' + c.store, select: 'id,name,wa_tpl,quotes,report_to,verify_at' });
      if (!rows.length) throw new HttpError(404, 'not_found', 'Unknown store');
      return rows[0];
    }),

  route('PUT', '/v1/settings', { scope: 'manage', tag: 'Stores', summary: 'Change one or more store settings (manager)',
    params: [S.storeParam], body: { wa_tpl: 'Hi {name}! It’s {agent} from MTN {store}…', quotes: 'One quote per line', report_to: '27820000000' },
    example: { id: 's1', wa_tpl: '…', quotes: '…', report_to: '27820000000' } },
    async c => {
      const patch = {};
      if ('wa_tpl' in c.body) patch.wa_tpl = str(c.body.wa_tpl, 8000);
      if ('quotes' in c.body) patch.quotes = str(c.body.quotes, 8000);
      if ('report_to' in c.body) patch.report_to = str(c.body.report_to, 40).replace(/[^0-9+ ]/g, '');
      if (!Object.keys(patch).length) throw new HttpError(400, 'missing', 'Send at least one of wa_tpl, quotes, report_to');
      const rows = await c.db.update('stores', { id: 'eq.' + c.store, select: 'id,wa_tpl,quotes,report_to,verify_at' }, patch);
      if (!rows.length) throw new HttpError(404, 'not_found', 'Unknown store');
      return rows[0];
    }),

  /* ------------------------------------------------------------ customers */
  route('GET', '/v1/customers', { tag: 'Customers', summary: 'Search and page through the store’s customer book',
    description: 'One row per customer in the active base, joined with their current outcome and owner. Computed inside the database; only the requested page travels.',
    params: [S.storeParam,
      { name: 'q', in: 'query', description: 'Search name, account or cell number', example: 'ndlovu' },
      { name: 'agent', in: 'query', description: 'Owner name as in the base (e.g. SIPHO), or "none" for unowned', example: 'SIPHO' },
      { name: 'status', in: 'query', description: 'Outcome code: ' + OUTCOMES.filter(Boolean).join(', ') + ' — or "none"', example: 'cb' },
      { name: 'offset', in: 'query', description: 'Skip this many (default 0)', example: 0 },
      { name: 'limit', in: 'query', description: '1–200 (default 50)', example: 50 }],
    example: { total: 382, offset: 0, limit: 50, items: [S.customer] } },
    async c => c.db.rpc('customers', {
      p_store: c.store,
      p_q: str(c.query.get('q'), 60).trim(),
      p_agent: str(c.query.get('agent'), 40).trim(),
      p_status: c.query.get('status') ? oneOf(c.query.get('status'), [...OUTCOMES.filter(Boolean), 'none'], 'status') : '',
      p_offset: intIn(c.query.get('offset'), 0, 1000000, 0),
      p_limit: intIn(c.query.get('limit'), 1, 200, 50),
    })),

  route('GET', '/v1/customers/:acct', { tag: 'Customers', summary: 'One customer with their full activity and outcome history',
    params: [S.storeParam], example: { ...S.customer, activities: [{ t: 'wa', by: 'Sipho', at: '2026-09-26 09:14' }], history: [{ from: '', to: 'cb', by: 'Sipho', at: '2026-09-26 09:20' }] } },
    async c => {
      const acct = cleanAcct(c.params.acct);
      if (!acct) throw new HttpError(400, 'invalid', 'Bad account number');
      const r = await c.db.rpc('customer', { p_store: c.store, p_acct: acct });
      if (!r || !r.acct) throw new HttpError(404, 'not_found', 'No such customer in the active base');
      return r;
    }),

  route('PUT', '/v1/customers/:acct/outcome', { scope: 'write', tag: 'Customers', summary: 'Record an outcome, callback date and note (history is kept automatically)',
    params: [S.storeParam], body: { outcome: 'cb', next_action: '2026-10-02', note: 'Call back after payday' },
    example: { acct: 'SB10251', outcome: 'cb', next_action: '2026-10-02', note: '…', updated_by: 'Excel report', updated_on: '2026-09-26', history: [{ from: '', to: 'cb', by: 'Excel report', at: '2026-09-26 09:20' }] } },
    async c => {
      const acct = cleanAcct(c.params.acct);
      if (!acct) throw new HttpError(400, 'invalid', 'Bad account number');
      return c.db.rpc('set_outcome', {
        p_store: c.store, p_acct: acct,
        p_st: oneOf(c.body.outcome == null ? '' : c.body.outcome, OUTCOMES, 'outcome'),
        p_next: isoDate(c.body.next_action, 'next_action'),
        p_note: str(c.body.note, 5000),
        p_by: c.actor.name,
      });
    }),

  route('POST', '/v1/customers/:acct/activities', { scope: 'write', tag: 'Customers', summary: 'Log a touch: WhatsApp, call, no answer, SMS or email',
    params: [S.storeParam], body: { type: 'wa' }, example: { acct: 'SB10251', activities: [{ t: 'wa', by: 'Excel report', at: '2026-09-26 09:14' }] } },
    async c => {
      const acct = cleanAcct(c.params.acct);
      if (!acct) throw new HttpError(400, 'invalid', 'Bad account number');
      return reply(201, await c.db.rpc('log_activity', {
        p_store: c.store, p_acct: acct, p_t: oneOf(c.body.type, ACTIVITIES, 'type'), p_by: c.actor.name,
      }));
    }),

  route('POST', '/v1/customers', { scope: 'write', tag: 'Customers', summary: 'Add a walk-in / manual lead to the active base',
    params: [S.storeParam], body: { name: 'Thandi Ndlovu', msisdn: '0821234567', email: '', note: 'Asked about fibre' },
    example: { acct: 'WI3F9A2C1B', base_id: 'uuid' } },
    async c => reply(201, await c.db.rpc('add_walkin', {
      p_store: c.store, p_name: requireStr(c.body.name, 60, 'name'),
      p_msisdn: str(c.body.msisdn, 20), p_email: str(c.body.email, 120), p_note: str(c.body.note, 5000),
      p_agent: c.actor.agent || '', p_by: c.actor.name,
    }))),

  /* ------------------------------------------------------------ claims & ownership */
  route('GET', '/v1/claims', { tag: 'Claims', summary: 'Claims on customers (who asked for whom)',
    params: [S.storeParam, { name: 'status', in: 'query', description: 'pending | approved | rejected', example: 'pending' },
             { name: 'limit', in: 'query', description: '1–500 (default 100)', example: 100 }],
    example: [{ id: 'uuid', acct: 'SB10258', customer: 'Thandi Ndlovu', by_name: 'Sipho', agent: 'SIPHO', status: 'pending', at: '2026-09-26', decided: null }] },
    async c => c.db.select('claims', {
      store_id: 'eq.' + c.store, select: 'id,acct,customer,by_name,agent,status,at,decided,created_at',
      order: 'created_at.desc', limit: intIn(c.query.get('limit'), 1, 500, 100),
      ...(c.query.get('status') ? { status: 'eq.' + oneOf(c.query.get('status'), ['pending', 'approved', 'rejected'], 'status') } : {}),
    })),

  route('POST', '/v1/claims', { scope: 'write', tag: 'Claims', summary: 'Ask for a customer (consultant)',
    params: [S.storeParam], body: { acct: 'SB10258', customer: 'Thandi Ndlovu' },
    example: { id: 'uuid', acct: 'SB10258', status: 'pending' } },
    async c => reply(201, await c.db.rpc('raise_claim', {
      p_store: c.store, p_acct: cleanAcct(requireStr(c.body.acct, 40, 'acct')),
      p_customer: str(c.body.customer, 60), p_by: c.actor.name, p_agent: c.actor.agent || '',
    }))),

  route('POST', '/v1/claims/:id/decide', { scope: 'manage', tag: 'Claims', summary: 'Approve or reject a claim (manager); approving makes them the owner',
    params: [S.storeParam], body: { verdict: 'approved' }, example: { id: 'uuid', acct: 'SB10258', status: 'approved', owner: 'SIPHO' } },
    async c => {
      if (!isUuid(c.params.id)) throw new HttpError(400, 'invalid', 'Bad claim id');
      return c.db.rpc('decide_claim', { p_store: c.store, p_claim: c.params.id, p_verdict: oneOf(c.body.verdict, ['approved', 'rejected'], 'verdict') });
    }),

  route('GET', '/v1/assignments', { tag: 'Claims', summary: 'Manager overrides of who owns which customer',
    params: [S.storeParam], example: [{ acct: 'SB10258', agent: 'SIPHO' }] },
    async c => c.db.select('tracking', { store_id: 'eq.' + c.store, agent: 'not.is.null', select: 'acct,agent', order: 'acct.asc' })),

  route('POST', '/v1/assignments', { scope: 'manage', tag: 'Claims', summary: 'Give customers to a consultant (manager). agent "" = nobody, null = let the base decide',
    params: [S.storeParam], body: { accts: ['SB10258', 'SB10259'], agent: 'SIPHO' }, example: { assigned: 2, agent: 'SIPHO' } },
    async c => {
      const accts = (Array.isArray(c.body.accts) ? c.body.accts : []).slice(0, 5000).map(cleanAcct).filter(Boolean);
      if (!accts.length) throw new HttpError(400, 'missing', 'accts must be a non-empty array of account numbers');
      const agent = c.body.agent === null ? null : str(c.body.agent, 40).toUpperCase().trim();
      const n = await c.db.rpc('assign', { p_store: c.store, p_accts: accts, p_agent: agent });
      return { assigned: n, agent };
    }),

  /* ------------------------------------------------------------ bases */
  route('GET', '/v1/bases', { tag: 'Bases', summary: 'The uploaded bases for a store (metadata only, no rows)',
    params: [S.storeParam], example: [{ id: 'uuid', label: 'Upgrade base · Sep 2026', active: true, rows: 382, created_at: '2026-09-01T06:00:00Z' }] },
    async c => c.db.rpc('bases', { p_store: c.store })),

  route('GET', '/v1/bases/:id/rows', { tag: 'Bases', summary: 'Page through the raw rows of one base',
    params: [S.storeParam, { name: 'offset', in: 'query', description: 'Skip this many (default 0)', example: 0 },
             { name: 'limit', in: 'query', description: '1–500 (default 200)', example: 200 }],
    example: { id: 'uuid', label: '…', total: 382, offset: 0, limit: 200, columns: ['csr', 'name', '…'], rows: [['SIPHO', 'Thandi', 'Ndlovu', 'SB10251', '27821234567']] } },
    async c => {
      if (!isUuid(c.params.id)) throw new HttpError(400, 'invalid', 'Bad base id');
      const r = await c.db.rpc('base_rows', { p_store: c.store, p_base: c.params.id,
        p_offset: intIn(c.query.get('offset'), 0, 10000000, 0), p_limit: intIn(c.query.get('limit'), 1, 500, 200) });
      if (!r || !r.id) throw new HttpError(404, 'not_found', 'No such base in this store');
      return r;
    }),

  route('POST', '/v1/bases', { scope: 'manage', tag: 'Bases', summary: 'Load a new monthly base (manager). Becomes the active base.', maxBody: 8 * MB,
    params: [S.storeParam], body: { label: 'Upgrade base · Oct 2026', rows: [['SIPHO', 'Thandi', 'Ndlovu', 'SB10251', '27821234567', 'Made For Me M', '2024-10-01', 'iPhone 15', 599, 'Upgrade', '', 'Consumer', 'R599 p/m', '']] },
    example: { id: 'uuid', rows: 382 } },
    async c => {
      const rows = c.body.rows;
      if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'missing', 'rows must be a non-empty array');
      if (rows.length > 50000) throw new HttpError(413, 'too_large', 'At most 50 000 rows per base');
      if (!rows.every(Array.isArray)) throw new HttpError(400, 'invalid', 'Every row must be an array of cells');
      return reply(201, await c.db.rpc('load_base', { p_store: c.store, p_label: str(c.body.label, 40), p_rows: rows }));
    }),

  /* ------------------------------------------------------------ reports */
  route('GET', '/v1/reports/summary', { tag: 'Reports', summary: 'Store KPIs computed in the database: outcomes, per-owner, callbacks due, Wons vs MTN',
    params: [S.storeParam],
    example: { store: 's1', store_name: 'Montrose', customers: 382, offer_value: 210450.5, by_outcome: { none: 300, cb: 40, won: 12 },
      by_owner: [{ owner: 'SIPHO', customers: 190, won: 7, contacted: 60, offer_value: 105000 }], callbacks_due: 9, won: 12, won_verified: 8, pending_claims: 1, verified_at: '2026-09-20' } },
    async c => c.db.rpc('summary', { p_store: c.store })),

  /* ------------------------------------------------------------ keys, usage, audit, users */
  route('GET', '/v1/usage', { store: 'none', tag: 'Admin', summary: 'Calls per day for your key (managers: ?all=1 for every key)',
    params: [{ name: 'days', in: 'query', description: '1–365 (default 30)', example: 30 }, { name: 'all', in: 'query', description: '1 = every key (manage scope)', example: 1 }],
    example: [{ key_id: 'uuid', name: 'Excel report', day: '2026-09-26', calls: 12, writes: 0, denied: 0 }] },
    async c => {
      const all = c.query.get('all') === '1' && c.actor.scopes.has('manage');
      if (!all && !c.actor.key_id) return [];
      return c.db.rpc('usage_report', { p_key: all ? null : c.actor.key_id, p_days: intIn(c.query.get('days'), 1, 365, 30) });
    }),

  route('GET', '/v1/keys', { scope: 'manage', store: 'none', tag: 'Admin', summary: 'List API keys (never the secrets)',
    example: [{ id: 'uuid', name: 'Excel report', store_id: 's1', scopes: ['read'], daily_limit: 500, active: true, expires_at: '2027-09-26T00:00:00Z', last_used_at: null }] },
    async c => c.db.select('keys', { select: 'id,name,store_id,scopes,daily_limit,active,expires_at,created_by,created_at,last_used_at',
      order: 'created_at.desc', ...(c.actor.store_id ? { store_id: 'eq.' + c.actor.store_id } : {}) }, 'api')),

  route('POST', '/v1/keys', { scope: 'manage', store: 'none', tag: 'Admin', summary: 'Create an API key. The secret is shown ONCE in this reply.',
    body: { name: 'Excel report', store: 's1', scopes: ['read'], daily_limit: 500, expires_days: 365 },
    example: { id: 'uuid', key: 'chk_9f3…​.Xy…', name: 'Excel report', store_id: 's1', scopes: ['read'], daily_limit: 500, note: 'Store this now — it cannot be shown again' } },
    async c => {
      const name = requireStr(c.body.name, 60, 'name');
      const scopes = [...new Set((Array.isArray(c.body.scopes) ? c.body.scopes : ['read']).map(s => str(s, 10)))];
      for (const s of scopes) {
        if (!SCOPES.includes(s)) throw new HttpError(400, 'invalid', 'scopes must be from: ' + SCOPES.join(', '));
        if (!c.actor.scopes.has(s)) throw new HttpError(403, 'forbidden', `You cannot grant the ${s} scope`);
      }
      let store = c.actor.store_id || null;
      if (!store && c.body.store != null && c.body.store !== '') {
        if (!isStoreId(c.body.store)) throw new HttpError(400, 'invalid', 'store must look like s1');
        store = c.body.store;
      }
      const rows = await c.db.rpc('mint_key', {
        p_name: name, p_store: store, p_scopes: scopes,
        p_daily_limit: intIn(c.body.daily_limit, 1, 100000, 2000),
        p_expires_days: intIn(c.body.expires_days, 1, 3650, 365),
        p_created_by: str(c.actor.name, 60),
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      return reply(201, { id: r.id, key: r.key, name, store_id: store, scopes, daily_limit: intIn(c.body.daily_limit, 1, 100000, 2000),
        note: 'Store this now — it cannot be shown again' });
    }),

  route('DELETE', '/v1/keys/:id', { scope: 'manage', store: 'none', tag: 'Admin', summary: 'Revoke an API key immediately',
    example: { id: 'uuid', active: false } },
    async c => {
      if (!isUuid(c.params.id)) throw new HttpError(400, 'invalid', 'Bad key id');
      if (c.params.id === c.actor.key_id) throw new HttpError(400, 'invalid', 'Use a different key to revoke this one');
      const rows = await c.db.update('keys', { id: 'eq.' + c.params.id, select: 'id,active',
        ...(c.actor.store_id ? { store_id: 'eq.' + c.actor.store_id } : {}) }, { active: false }, 'api');
      if (!rows.length) throw new HttpError(404, 'not_found', 'No such key');
      return rows[0];
    }),

  route('GET', '/v1/audit', { scope: 'manage', store: 'none', tag: 'Admin', summary: 'Who did what through the API (writes and refusals)',
    params: [{ name: 'limit', in: 'query', description: '1–200 (default 50)', example: 50 }],
    example: [{ at: '2026-09-26T09:20:11Z', actor: 'Excel report', method: 'PUT', path: '/v1/customers/SB10251/outcome', store_id: 's1', status: 200, ms: 84, ip: '196.0.0.1' }] },
    async c => c.db.select('audit', { select: 'at,key_id,actor,method,path,store_id,status,ms,ip,detail', order: 'at.desc',
      limit: intIn(c.query.get('limit'), 1, 200, 50), ...(c.actor.store_id ? { store_id: 'eq.' + c.actor.store_id } : {}) }, 'api')),

  route('POST', '/v1/users', { scope: 'manage', tag: 'Admin', summary: 'Create a consultant or manager login (manager) — works with public sign-ups turned OFF',
    params: [S.storeParam], body: { username: 'thandi', name: 'Thandi Ndlovu', password: 'at least 10 characters', role: 'consultant', agent: 'THANDI' },
    example: { id: 'uuid', username: 'thandi', name: 'Thandi Ndlovu', role: 'consultant', agent: 'THANDI', store_id: 's1' } },
    async c => {
      const username = str(c.body.username, 40).toLowerCase().trim();
      if (!/^[a-z0-9._-]{2,40}$/.test(username)) throw new HttpError(400, 'invalid', 'username: 2–40 of a-z 0-9 . _ -');
      const name = requireStr(c.body.name, 60, 'name');
      const password = String(c.body.password || '');
      if (password.length < 10 || password.length > 128) throw new HttpError(400, 'invalid', 'password must be 10–128 characters');
      const role = oneOf(c.body.role || 'consultant', ['consultant', 'manager'], 'role');
      const agent = str(c.body.agent, 40).toUpperCase().trim();
      const email = username + '@' + (c.env.CHASE_EMAIL_DOMAIN || 'chase.local');
      let user;
      try { user = await c.db.adminCreateUser(email, password); }
      catch (e) {
        if (e.status === 422 || /already|exists|registered/i.test(e.message)) throw new HttpError(409, 'conflict', 'Username already exists');
        throw e;
      }
      const id = user && (user.id || (user.user && user.user.id));
      if (!id) throw new HttpError(502, 'upstream', 'Supabase did not return the new user');
      try {
        const rows = await c.db.insert('profiles', { id, username, name, role, agent, store_id: c.store });
        return reply(201, rows[0] || { id, username, name, role, agent, store_id: c.store });
      } catch (e) {
        try { await c.db.adminDeleteUser(id); } catch (e2) { /* best effort */ }
        if (e.code === '23505') throw new HttpError(409, 'conflict', 'Username already exists');
        throw e;
      }
    }),
];
