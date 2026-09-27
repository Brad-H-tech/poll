/* Chase API — the only thing that talks to Supabase.
   A thin PostgREST client: RPC calls into the `api` schema do the real work,
   plus a handful of plain table reads/writes. Every call has a timeout and
   every failure is turned into a safe, non-leaky HTTP error. */

export class DbError extends Error {
  constructor(status, data) {
    super((data && (data.message || data.msg || data.error_description)) || 'Database error');
    this.name = 'DbError';
    this.status = status;
    this.data = data || {};
    this.code = (data && data.code) || '';
  }
}

/* Postgres / PostgREST error codes → what the API caller should see.
   Nothing else about the database (table names, SQL) is ever forwarded. */
export function publicError(err) {
  const msg = (err && err.data && err.data.message) || '';
  switch (err && err.code) {
    case '22023': return { status: 400, code: 'invalid', message: msg || 'Invalid value' };
    case '23503': return { status: 400, code: 'unknown_reference', message: 'Unknown store or reference' };
    case '23505': return { status: 409, code: 'conflict', message: /assigned/i.test(msg) ? 'Already assigned' : 'Already exists' };
    case '21000': return { status: 400, code: 'invalid', message: 'The same item appears more than once in the request' };
    case '23514': return { status: 422, code: 'rejected', message: 'Rejected by a database rule (too long, too many, or a bad code)' };
    case '42501': return { status: 403, code: 'forbidden', message: msg || 'Not allowed' };
    case 'P0002': return { status: 404, code: 'not_found', message: msg || 'Not found' };
    case 'PGRST116': return { status: 404, code: 'not_found', message: 'Not found' };
    case 'PGRST106': case 'PGRST202': case 'PGRST205':
      return { status: 503, code: 'not_configured', message: 'The API schema is not exposed yet: add `api` to Exposed schemas in Supabase → Project Settings → Data API, and run api/sql/001_api.sql' };
    default: return { status: 502, code: 'upstream', message: 'The database did not answer as expected' };
  }
}

export function makeDb(env, fetchImpl) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_KEY || '';
  const anonKey = env.SUPABASE_ANON_KEY || '';
  const timeoutMs = Number(env.DB_TIMEOUT_MS) || 10000;

  async function call(method, path, opts = {}) {
    const auth = opts.userJwt ? { apikey: anonKey, Authorization: 'Bearer ' + opts.userJwt }
                              : { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
    const headers = { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (opts.schema) { headers['Accept-Profile'] = opts.schema; headers['Content-Profile'] = opts.schema; }
    if (opts.prefer) headers.Prefer = opts.prefer;
    const res = await doFetch(base + path, {
      method, headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text.slice(0, 200) }; }
    if (!res.ok) throw new DbError(res.status, data);
    return data;
  }

  const q = obj => Object.entries(obj).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  return {
    /** call a function in the `api` schema */
    rpc: (fn, args) => call('POST', '/rest/v1/rpc/' + fn, { body: args || {}, schema: 'api' }),
    /** read rows; `params` is a PostgREST filter object, e.g. { store_id: 'eq.s1', select: 'id,name' } */
    select: (table, params, schema) => call('GET', '/rest/v1/' + table + '?' + q(params), { schema }),
    insert: (table, rows, schema) => call('POST', '/rest/v1/' + table, { body: rows, schema, prefer: 'return=representation' }),
    update: (table, params, patch, schema) => call('PATCH', '/rest/v1/' + table + '?' + q(params), { body: patch, schema, prefer: 'return=representation' }),
    /** fire-and-forget audit row: never throws */
    audit: async row => { try { await call('POST', '/rest/v1/audit', { body: row, schema: 'api', prefer: 'return=minimal' }); } catch (e) { console.error('[audit]', e.message); } },

    /* ---- Supabase Auth (GoTrue) ---- */
    /** who does this user token belong to? */
    userFromJwt: jwt => call('GET', '/auth/v1/user', { userJwt: jwt }),
    /** the caller's own profile, read under THEIR token so row-level security applies */
    profileFromJwt: (jwt, uid) => call('GET', '/rest/v1/profiles?' + q({ id: 'eq.' + uid, select: 'id,username,name,role,agent,store_id' }), { userJwt: jwt }),
    /** create a login without public sign-ups being enabled */
    adminCreateUser: (email, password) => call('POST', '/auth/v1/admin/users', { body: { email, password, email_confirm: true } }),
    adminDeleteUser: uid => call('DELETE', '/auth/v1/admin/users/' + encodeURIComponent(uid)),
  };
}
