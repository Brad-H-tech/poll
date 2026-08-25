/* A stand-in for supabase-js, faithful to the parts the Chase adapter uses.
   Lets the whole app be driven in a real browser without touching the network,
   so every button is exercised before it ever reaches the live project. */
(function () {
  /* The database is shared by every tab, exactly as the real one is:
     backed by localStorage, with a broadcast so other tabs hear changes. */
  const KEY = 'chase-mockdb';
  function read() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) {}
    return window.__MOCKDB__ || { tables: {}, users: [] };
  }
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {}
  }
  let DB = read();
  Object.defineProperty(window, '__MOCKDB__', { get: () => DB, configurable: true });
  const sync = () => { DB = read(); };
  const T = n => (DB.tables[n] = DB.tables[n] || []);

  let bc = null;
  try {
    bc = new BroadcastChannel('chase-mock-sb');
    bc.onmessage = e => { sync(); emitChange(e.data.table, e.data.type, e.data.row, true); };
  } catch (e) {}
  const clone = v => JSON.parse(JSON.stringify(v));
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

  function match(row, filters) {
    return filters.every(f => {
      if (f.op === 'eq') return String(row[f.col]) === String(f.val);
      return true;
    });
  }

  class Q {
    constructor(table) { this.table = table; this.filters = []; this._op = null; this._payload = null;
                         this._one = false; this._maybe = false; this._orderBy = null; this._asc = true;
                         this._limit = null; this._returning = false; }
    select(_cols) { if (!this._op) this._op = 'select'; else this._returning = true; return this; }
    insert(rows) { this._op = 'insert'; this._payload = Array.isArray(rows) ? rows : [rows]; return this; }
    update(patch) { this._op = 'update'; this._payload = patch; return this; }
    upsert(rows, opts) { this._op = 'upsert'; this._payload = Array.isArray(rows) ? rows : [rows];
                         this._conflict = (opts && opts.onConflict || '').split(',').map(s => s.trim()).filter(Boolean);
                         return this; }
    delete() { this._op = 'delete'; return this; }
    eq(col, val) { this.filters.push({ op: 'eq', col, val }); return this; }
    order(col, o) { this._orderBy = col; this._asc = !o || o.ascending !== false; return this; }
    limit(n) { this._limit = n; return this; }
    single() { this._one = true; return this; }
    maybeSingle() { this._one = true; this._maybe = true; return this; }

    _run() {
      sync();
      const rows = T(this.table);
      try {
        if (this._op === 'select') {
          let out = rows.filter(r => match(r, this.filters)).map(clone);
          if (this._orderBy) out.sort((a, b) => {
            const x = a[this._orderBy], y = b[this._orderBy];
            return (x < y ? -1 : x > y ? 1 : 0) * (this._asc ? 1 : -1);
          });
          if (this._limit != null) out = out.slice(0, this._limit);
          if (this._one) {
            if (!out.length) return this._maybe ? { data: null, error: null }
                                                : { data: null, error: { message: 'no rows' } };
            return { data: out[0], error: null };
          }
          return { data: out, error: null };
        }
        if (this._op === 'insert' || this._op === 'upsert') {
          const written = [];
          for (const raw of this._payload) {
            const row = clone(raw);
            if (this.table === 'bases' && !row.id) row.id = uuid();
            if (this.table === 'claims' && !row.id) row.id = uuid();
            if (row.created_at === undefined &&
                ['bases', 'claims', 'profiles'].includes(this.table)) row.created_at = new Date().toISOString();
            let existing = null;
            if (this._op === 'upsert' && this._conflict && this._conflict.length) {
              existing = rows.find(r => this._conflict.every(c => String(r[c]) === String(row[c])));
            } else if (this._op === 'insert') {
              // unique constraints we actually rely on
              if (this.table === 'profiles' && rows.some(r => r.username === row.username))
                return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
            if (existing) Object.assign(existing, row); else rows.push(row);
            written.push(clone(existing || row));
            emitChange(this.table, existing ? 'UPDATE' : 'INSERT', existing || row);
          }
          write();
          if (this._one) return { data: written[0] || null, error: null };
          return { data: written, error: null };
        }
        if (this._op === 'update') {
          const hit = rows.filter(r => match(r, this.filters));
          hit.forEach(r => { Object.assign(r, clone(this._payload)); emitChange(this.table, 'UPDATE', r); });
          write();
          return { data: hit.map(clone), error: null };
        }
        if (this._op === 'delete') {
          const keep = [], gone = [];
          rows.forEach(r => (match(r, this.filters) ? gone : keep).push(r));
          DB.tables[this.table] = keep;
          gone.forEach(r => emitChange(this.table, 'DELETE', r));
          write();
          return { data: gone.map(clone), error: null };
        }
        return { data: null, error: { message: 'unsupported op' } };
      } catch (e) {
        return { data: null, error: { message: String(e && e.message || e) } };
      }
    }
    then(res, rej) { return Promise.resolve(this._run()).then(res, rej); }
  }

  /* ---- realtime ---- */
  const channels = [];
  function emitChange(table, type, row, fromRemote) {
    if (!fromRemote && bc) { try { bc.postMessage({ table, type, row: clone(row) }); } catch (e) {} }
    channels.forEach(ch => ch._handlers.forEach(h => {
      if (h.cfg.table !== table) return;
      if (h.cfg.filter) {
        const m = /^(\w+)=eq\.(.+)$/.exec(h.cfg.filter);
        if (m && String(row[m[1]]) !== m[2]) return;
      }
      try { h.fn({ eventType: type, new: clone(row), old: clone(row) }); } catch (e) {}
    }));
  }

  class Channel {
    constructor(name) { this.name = name; this._handlers = []; }
    on(_evt, cfg, fn) { this._handlers.push({ cfg, fn }); return this; }
    subscribe() { channels.push(this); return this; }
  }

  /* ---- auth ---- */
  function makeAuth(persist, storageKey) {
    let current = null;
    if (persist) {
      try { const s = sessionStorage.getItem(storageKey); if (s) current = JSON.parse(s); } catch (e) {}
    }
    const save = () => { if (!persist) return;
      try { current ? sessionStorage.setItem(storageKey, JSON.stringify(current))
                    : sessionStorage.removeItem(storageKey); } catch (e) {} };
    return {
      async signInWithPassword({ email, password }) {
        sync();
        const u = DB.users.find(x => x.email === String(email).toLowerCase() && x.password === password);
        if (!u) return { data: { user: null }, error: { message: 'Invalid login credentials' } };
        current = { id: u.id, email: u.email }; save();
        return { data: { user: clone(current) }, error: null };
      },
      async signUp({ email, password }) {
        email = String(email).toLowerCase();
        if (DB.users.some(x => x.email === email))
          return { data: { user: null }, error: { message: 'User already registered' } };
        const u = { id: uuid(), email, password };
        sync(); DB.users.push(u); write();
        return { data: { user: { id: u.id, email } }, error: null };
      },
      async signOut() { current = null; save(); return { error: null }; },
      async getUser() { return { data: { user: current ? clone(current) : null } }; },
    };
  }

  window.supabase = {
    createClient(url, key, opts) {
      const o = (opts && opts.auth) || {};
      return {
        from: t => new Q(t),
        auth: makeAuth(o.persistSession !== false, o.storageKey || 'mock-auth'),
        channel: n => new Channel(n),
        removeChannel(ch) { const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); },
      };
    },
  };
})();
