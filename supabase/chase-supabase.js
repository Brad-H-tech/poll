/* =========================================================
   Chase — Supabase adapter
   ---------------------------------------------------------
   The app talks to itself over a small HTTP API (/api/…).
   Rather than rewrite 3,000 lines of tested app code, this
   intercepts those calls and serves them from Supabase.
   The app cannot tell the difference.

   Also swaps EventSource (live sync) for Supabase Realtime.
========================================================= */
(function () {
  const SB_URL = '__SB_URL__';
  const SB_KEY = '__SB_KEY__';
  const EMAIL_DOMAIN = 'chase.local';

  const sb = supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'chase-auth' },
  });
  // separate client so creating a consultant doesn't sign the manager out
  const sbSignup = supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'chase-signup' },
  });

  const emailFor = u => String(u || '').trim().toLowerCase() + '@' + EMAIL_DOMAIN;
  const today = () => new Date().toISOString().slice(0, 10);
  const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const J = (o, s) => new Response(JSON.stringify(o), {
    status: s || 200, headers: { 'Content-Type': 'application/json' },
  });
  const ERR = (e, s) => J({ error: typeof e === 'string' ? e : (e && e.message) || 'Something went wrong' }, s || 400);

  const OUT = ['fu', 'cb', 'quote', 'visit', 'won', 'lost', 'na', 'nowa', 'upg', 'wrong'];
  const ACTS = ['wa', 'call', 'na', 'sms', 'em'];

  /* ---------- session state ---------- */
  let ME = null;        // {id, u, name, role, agent, store_id}
  let STORE = 's1';     // store currently being worked
  let STORE_NAMES = {};
  const cache = { tracking: {}, assign: {}, settings: {}, claims: [], bases: [], active: null };

  const isMgr = () => !!ME && ME.role === 'manager';
  const headOffice = () => isMgr() && !ME.store_id;

  async function loadProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { ME = null; return null; }
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error || !data) { ME = null; return null; }
    ME = { id: data.id, u: data.username, name: data.name, role: data.role,
           agent: data.agent || '', store_id: data.store_id };
    if (ME.store_id) STORE = ME.store_id;
    return ME;
  }
  const pubMe = () => ME && { u: ME.u, name: ME.name, role: ME.role, agent: ME.agent || '' };

  async function loadStores() {
    const { data } = await sb.from('stores').select('id,name,sort').order('sort');
    STORE_NAMES = {};
    (data || []).forEach(s => { STORE_NAMES[s.id] = s.name; });
    return (data || []).map(s => ({ id: s.id, name: s.name }));
  }

  /* ---------- read the whole working set for one store ---------- */
  async function loadState() {
    const sid = STORE;
    const [bases, tracking, claims, assign, settings] = await Promise.all([
      sb.from('bases').select('id,label,rows,active,created_at').eq('store_id', sid).order('created_at'),
      sb.from('tracking').select('*').eq('store_id', sid),
      sb.from('claims').select('*').eq('store_id', sid).order('created_at', { ascending: false }),
      sb.from('assign').select('acct,agent').eq('store_id', sid),
      sb.from('settings').select('*').eq('store_id', sid).maybeSingle(),
    ]);

    cache.bases = (bases.data || []).map(b => ({ id: b.id, label: b.label, rows: b.rows || [] }));
    const act = (bases.data || []).find(b => b.active);
    cache.active = act ? act.id : (cache.bases.length ? cache.bases[cache.bases.length - 1].id : null);

    cache.tracking = {};
    (tracking.data || []).forEach(t => {
      const rec = { st: t.st || '', next: t.next || '', note: t.note || '',
                    by: t.by_name || '', at: t.at || '',
                    acts: t.acts || [], hist: t.hist || [] };
      if (t.ver) rec.ver = t.ver;
      cache.tracking[t.acct] = rec;
    });

    cache.claims = (claims.data || []).map(c => ({
      acct: c.acct, customer: c.customer || '', by: c.by_name || '', agent: c.agent || '',
      status: c.status, at: c.at || '', decided: c.decided || undefined,
    }));

    cache.assign = {};
    (assign.data || []).forEach(a => { cache.assign[a.acct] = a.agent || ''; });

    const s = settings.data || {};
    cache.settings = {};
    ['wa_tpl', 'quotes', 'report_to', 'verify_at'].forEach(k => { if (s[k]) cache.settings[k] = s[k]; });

    return {
      me: pubMe(), store: sid, storeName: STORE_NAMES[sid] || sid,
      bases: cache.bases, active: cache.active,
      tracking: cache.tracking, settings: cache.settings,
      claims: cache.claims, assign: cache.assign,
    };
  }

  /* ---------- writes ---------- */
  async function saveTracking(acct, patch, opts) {
    const prev = cache.tracking[acct] || {};
    const rec = Object.assign({}, prev, patch);
    rec.acts = Array.isArray(rec.acts) ? rec.acts : [];
    rec.hist = Array.isArray(rec.hist) ? rec.hist : [];
    if (opts && opts.hist && (prev.st || '') !== (rec.st || '')) {
      rec.hist = [{ from: prev.st || '', to: rec.st || '', by: ME.name, at: stamp() }]
        .concat(rec.hist).slice(0, 25);
    }
    cache.tracking[acct] = rec;
    const { error } = await sb.from('tracking').upsert({
      store_id: STORE, acct,
      st: rec.st || '', next: rec.next || '', note: rec.note || '',
      by_name: rec.by || ME.name, at: rec.at || today(),
      ver: rec.ver || null, acts: rec.acts, hist: rec.hist,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'store_id,acct' });
    if (error) throw error;
    return rec;
  }

  async function activeBase() {
    const b = cache.bases.find(x => x.id === cache.active);
    return b || null;
  }

  /* ---------- the router ---------- */
  const routes = [
    ['GET', /^\/api\/health$/, async () => J({ ok: true, backend: 'supabase' })],

    ['GET', /^\/api\/stores$/, async () => J(await loadStores())],

    ['POST', /^\/api\/login$/, async (m, body) => {
      const { error } = await sb.auth.signInWithPassword({
        email: emailFor(body.u), password: String(body.p || ''),
      });
      if (error) return ERR('Wrong username or password', 401);
      const me = await loadProfile();
      if (!me) {
        await sb.auth.signOut();
        return ERR('That login has no Chase profile yet — ask your manager to finish setting it up', 403);
      }
      if (!me.store_id) STORE = STORE_NAMES[body.store] ? body.store : STORE;   // head office picks
      await loadStores();
      subscribeLive();
      return J({ ok: true, me: pubMe() });
    }],

    ['POST', /^\/api\/logout$/, async () => {
      unsubscribeLive(); await sb.auth.signOut(); ME = null;
      return J({ ok: true });
    }],

    ['GET', /^\/api\/me$/, async () => {
      const me = ME || await loadProfile();
      return me ? J({ me: pubMe() }) : ERR('Not signed in', 401);
    }],

    ['GET', /^\/api\/state$/, async () => {
      const me = ME || await loadProfile();
      if (!me) return ERR('Not signed in', 401);
      if (!Object.keys(STORE_NAMES).length) await loadStores();
      subscribeLive();
      return J(await loadState());
    }],

    ['POST', /^\/api\/tracking\/(.+)\/activity$/, async (m, body) => {
      const acct = decodeURIComponent(m[1]);
      if (!ACTS.includes(body.t)) return ERR('Unknown activity type');
      const prev = cache.tracking[acct] || {};
      const acts = [{ t: body.t, by: ME.name, at: stamp() }]
        .concat(Array.isArray(prev.acts) ? prev.acts : []).slice(0, 30);
      const rec = await saveTracking(acct, { acts });
      emit('tracking', { acct, rec });
      return J({ ok: true });
    }],

    ['PUT', /^\/api\/tracking\/(.+)$/, async (m, body) => {
      const acct = decodeURIComponent(m[1]);
      const rec = await saveTracking(acct, {
        st: OUT.includes(body.st) ? body.st : '',
        next: String(body.next || '').slice(0, 10),
        note: String(body.note || '').slice(0, 5000),
        by: ME.name, at: today(),
      }, { hist: true });
      emit('tracking', { acct, rec });
      return J({ ok: true });
    }],

    ['POST', /^\/api\/customers$/, async (m, body) => {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return ERR('A name is required');
      let ms = String(body.msisdn || '').replace(/[^0-9]/g, '');
      if (ms.length === 10 && ms[0] === '0') ms = '27' + ms.slice(1);
      const base = await activeBase();
      if (!base) return ERR('Load a base first');
      const acct = 'WI' + Math.random().toString(36).slice(2, 10).toUpperCase();
      const email = /@/.test(String(body.email || '')) ? String(body.email).slice(0, 120).trim() : '';
      const rows = base.rows.concat([[ME.agent || '', name, '', acct, ms, '', today(),
        'Walk-in / manual lead', 0, 'New / Add Sim', '', 'Consumer', '', email]]);
      const { error } = await sb.from('bases').update({ rows }).eq('id', base.id);
      if (error) return ERR(error);
      base.rows = rows;
      const note = String(body.note || '').slice(0, 5000);
      if (note) await saveTracking(acct, { note, by: ME.name, at: today() });
      emit('bases', {});
      return J({ ok: true, acct });
    }],

    ['PUT', /^\/api\/settings$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const key = String(body.key || '').replace(/[^a-z_]/gi, '');
      if (!['wa_tpl', 'quotes', 'report_to'].includes(key)) return ERR('Unknown setting');
      const patch = { store_id: STORE }; patch[key] = String(body.value || '').slice(0, 8000);
      const { error } = await sb.from('settings').upsert(patch, { onConflict: 'store_id' });
      if (error) return ERR(error);
      cache.settings[key] = patch[key];
      emit('settings', {});
      return J({ ok: true });
    }],

    ['POST', /^\/api\/claims$/, async (m, body) => {
      const acct = String(body.acct || '').slice(0, 40);
      if (!acct) return ERR('No customer');
      if (cache.assign[acct]) return ERR('Already assigned', 409);
      if (cache.claims.some(c => c.acct === acct && c.status === 'pending'))
        return ERR('Someone already has a claim on this customer', 409);
      const { error } = await sb.from('claims').insert({
        store_id: STORE, acct, customer: String(body.customer || '').slice(0, 60),
        by_name: ME.name, agent: ME.agent || '', status: 'pending', at: today(),
      });
      if (error) return ERR(error);
      emit('claims', {});
      return J({ ok: true });
    }],

    ['POST', /^\/api\/claims\/(.+)\/decide$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const acct = decodeURIComponent(m[1]);
      const verdict = body.verdict === 'approved' ? 'approved' : 'rejected';
      const { data: rows } = await sb.from('claims').select('id,agent,by_name')
        .eq('store_id', STORE).eq('acct', acct).eq('status', 'pending').limit(1);
      if (!rows || !rows.length) return ERR('No pending claim', 404);
      const cl = rows[0];
      const { error } = await sb.from('claims').update({ status: verdict, decided: today() }).eq('id', cl.id);
      if (error) return ERR(error);
      if (verdict === 'approved') {
        const agent = cl.agent || cl.by_name;
        await sb.from('assign').upsert({ store_id: STORE, acct, agent }, { onConflict: 'store_id,acct' });
        cache.assign[acct] = agent;
      }
      emit('claims', {}); emit('bases', {});
      return J({ ok: true });
    }],

    ['POST', /^\/api\/verify$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const accts = (Array.isArray(body.accts) ? body.accts : []).slice(0, 10000)
        .map(a => String(a || '').slice(0, 40)).filter(Boolean);
      if (!accts.length) return ERR('No matched accounts');
      const d = today();
      const rows = accts.map(acct => {
        const prev = cache.tracking[acct] || {};
        cache.tracking[acct] = Object.assign({}, prev, { ver: d });
        return { store_id: STORE, acct, st: prev.st || '', next: prev.next || '', note: prev.note || '',
                 by_name: prev.by || ME.name, at: prev.at || d, ver: d,
                 acts: prev.acts || [], hist: prev.hist || [] };
      });
      const { error } = await sb.from('tracking').upsert(rows, { onConflict: 'store_id,acct' });
      if (error) return ERR(error);
      await sb.from('settings').upsert({ store_id: STORE, verify_at: d }, { onConflict: 'store_id' });
      cache.settings.verify_at = d;
      emit('tracking', {}); emit('settings', {});
      return J({ ok: true, verified: accts.length });
    }],

    ['POST', /^\/api\/assign$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const accts = (Array.isArray(body.accts) ? body.accts : []).slice(0, 5000)
        .map(a => String(a || '').slice(0, 40)).filter(Boolean);
      if (!accts.length) return ERR('No accounts given');
      const agent = String(body.agent || '').toUpperCase().trim().slice(0, 40);
      const rows = accts.map(acct => ({ store_id: STORE, acct, agent }));
      const { error } = await sb.from('assign').upsert(rows, { onConflict: 'store_id,acct' });
      if (error) return ERR(error);
      accts.forEach(a => { cache.assign[a] = agent; });
      emit('bases', {});
      return J({ ok: true, moved: accts.length, agent });
    }],

    ['POST', /^\/api\/assign\/split$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const mode = ['value', 'give'].includes(body.mode) ? body.mode : 'even';
      const agents = (Array.isArray(body.agents) ? body.agents : []).slice(0, 40)
        .map(a => String(a || '').toUpperCase().trim()).filter(Boolean);
      if (mode !== 'give' && !agents.length) return ERR('No consultants to split between');
      const base = await activeBase();
      if (!base) return ERR('Load a base first');

      const accts = new Map();
      base.rows.forEach(r => {
        const acct = r[3]; if (!acct) return;
        const cur = accts.get(acct) || { csr: '', rsp: 0 };
        if (!cur.csr && r[0]) cur.csr = String(r[0]).toUpperCase();
        cur.rsp += (+r[8] || 0);
        accts.set(acct, cur);
      });
      const pool = [...accts.entries()]
        .filter(([acct, v]) => !((acct in cache.assign ? cache.assign[acct] : v.csr)))
        .sort((a, b) => b[1].rsp - a[1].rsp);
      if (!pool.length) return J({ ok: true, assigned: 0 });

      const per = {}, writes = [];
      const put = (acct, agent) => {
        writes.push({ store_id: STORE, acct, agent });
        cache.assign[acct] = agent;
        per[agent] = (per[agent] || 0) + 1;
      };
      if (mode === 'give') {
        const agent = String(body.agent || '').toUpperCase().trim();
        if (!agent) return ERR('No consultant given');
        const n = Math.max(1, Math.min(5000, Math.round(+body.n) || 0));
        pool.slice(0, n).forEach(([acct]) => put(acct, agent));
      } else if (mode === 'value') {
        let i = 0, dir = 1;
        pool.forEach(([acct]) => {
          put(acct, agents[i]);
          i += dir;
          if (i === agents.length) { i = agents.length - 1; dir = -1; }
          else if (i < 0) { i = 0; dir = 1; }
        });
      } else {
        pool.forEach(([acct], idx) => put(acct, agents[idx % agents.length]));
      }
      for (let i = 0; i < writes.length; i += 500) {
        const { error } = await sb.from('assign').upsert(writes.slice(i, i + 500), { onConflict: 'store_id,acct' });
        if (error) return ERR(error);
      }
      emit('bases', {});
      return J({ ok: true, assigned: writes.length, per });
    }],

    ['POST', /^\/api\/bases$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      let applied = 0;
      for (const t of (Array.isArray(body.outcomes) ? body.outcomes : [])) {
        const acct = String(t.acct || '').slice(0, 40); if (!acct) continue;
        const patch = {};
        if (t.st && OUT.includes(t.st)) { patch.st = t.st; applied++; }
        if (t.next) patch.next = String(t.next).slice(0, 10);
        if (t.note) patch.note = String(t.note).slice(0, 5000);
        if (!Object.keys(patch).length) continue;
        patch.by = ME.name; patch.at = today();
        const rec = await saveTracking(acct, patch);
        emit('tracking', { acct, rec });
      }
      let added = false;
      if (body.addBase !== false) {
        const rows = body.rows;
        if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0]))
          return ERR('Invalid rows payload');
        await sb.from('bases').update({ active: false }).eq('store_id', STORE);
        const { data, error } = await sb.from('bases').insert({
          store_id: STORE, label: String(body.label || 'Uploaded base').slice(0, 40),
          rows, active: true,
        }).select('id').single();
        if (error) return ERR(error);
        cache.bases.push({ id: data.id, label: String(body.label || 'Uploaded base').slice(0, 40), rows });
        cache.active = data.id; added = true;
        emit('bases', {});
      }
      return J({ ok: true, added, applied });
    }],

    ['POST', /^\/api\/bases\/([\w-]+)\/activate$/, async m => {
      if (!isMgr()) return ERR('Manager only', 403);
      await sb.from('bases').update({ active: false }).eq('store_id', STORE);
      const { error } = await sb.from('bases').update({ active: true }).eq('id', m[1]);
      if (error) return ERR(error);
      cache.active = m[1];
      emit('bases', {});
      return J({ ok: true });
    }],

    ['DELETE', /^\/api\/bases\/([\w-]+)$/, async m => {
      if (!isMgr()) return ERR('Manager only', 403);
      if (cache.bases.length <= 1) return ERR('Cannot remove the last base');
      const { error } = await sb.from('bases').delete().eq('id', m[1]);
      if (error) return ERR(error);
      cache.bases = cache.bases.filter(b => b.id !== m[1]);
      if (cache.active === m[1] && cache.bases.length) {
        cache.active = cache.bases[cache.bases.length - 1].id;
        await sb.from('bases').update({ active: true }).eq('id', cache.active);
      }
      emit('bases', {});
      return J({ ok: true });
    }],

    ['GET', /^\/api\/users$/, async () => {
      if (!isMgr()) return ERR('Manager only', 403);
      let q = sb.from('profiles').select('username,name,role,agent,store_id');
      if (!headOffice()) q = q.eq('store_id', STORE);
      const { data, error } = await q;
      if (error) return ERR(error);
      return J((data || []).map(u => ({ u: u.username, name: u.name, role: u.role, agent: u.agent || '' })));
    }],

    ['POST', /^\/api\/users$/, async (m, body) => {
      if (!isMgr()) return ERR('Manager only', 403);
      const u = String(body.u || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!u || !body.name) return ERR('Name and username are required');
      if (String(body.p || '').length < 6) return ERR('Password must be at least 6 characters');
      const { data, error } = await sbSignup.auth.signUp({ email: emailFor(u), password: body.p });
      if (error) {
        return ERR(/already/i.test(error.message) ? 'Username already exists' : error.message,
                   /already/i.test(error.message) ? 409 : 400);
      }
      const id = data && data.user && data.user.id;
      if (!id) return ERR('Supabase did not return the new user — check that email confirmation is turned off in Authentication → Providers → Email');
      const { error: pe } = await sb.from('profiles').insert({
        id, username: u, name: String(body.name).slice(0, 60),
        role: body.role === 'manager' ? 'manager' : 'consultant',
        agent: String(body.agent || '').toUpperCase().trim(), store_id: STORE,
      });
      if (pe) return ERR(pe);
      emit('team', {});
      return J({ ok: true });
    }],

    ['PUT', /^\/api\/users\/([\w.-]+)\/password$/, async () =>
      ERR('For safety, passwords are reset in Supabase → Authentication → Users → ⋯ → Send password recovery. The app cannot change someone else\'s password.', 400)],

    ['DELETE', /^\/api\/users\/([\w.-]+)$/, async m => {
      if (!isMgr()) return ERR('Manager only', 403);
      if (m[1] === (ME && ME.u)) return ERR('You cannot remove yourself');
      const { error } = await sb.from('profiles').delete().eq('username', m[1]);
      if (error) return ERR(error);
      emit('team', {});
      return J({ ok: true });
    }],
  ];

  /* ---------- fetch interception ---------- */
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, opt) {
    opt = opt || {};
    if (typeof url !== 'string' || url.indexOf('/api/') !== 0) return realFetch(url, opt);
    const method = (opt.method || 'GET').toUpperCase();
    let body = {};
    try { body = opt.body ? JSON.parse(opt.body) : {}; } catch (e) {}
    const path = url.split('?')[0];

    for (const [verb, re, handler] of routes) {
      if (verb !== method) continue;
      const m = re.exec(path);
      if (!m) continue;
      // everything except these needs a session
      const open = /^\/api\/(health|stores|login)$/.test(path);
      return (async () => {
        try {
          if (!open && !ME && !(await loadProfile())) return ERR('Not signed in', 401);
          return await handler(m, body);
        } catch (e) {
          console.error('[chase/supabase]', path, e);
          return ERR(e, 500);
        }
      })();
    }
    return Promise.resolve(ERR('Unknown endpoint', 404));
  };

  /* ---------- live sync: Realtime pretending to be EventSource ---------- */
  const listeners = {};
  function emit(type, payload) {
    (listeners[type] || []).forEach(fn => {
      try { fn({ data: JSON.stringify(payload || {}) }); } catch (e) {}
    });
  }
  window.EventSource = class {
    constructor() {}
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); }
    close() {}
  };

  let channel = null, channelStore = null;
  function subscribeLive() {
    if (channel && channelStore === STORE) return;
    unsubscribeLive();
    channelStore = STORE;
    const flt = 'store_id=eq.' + STORE;
    channel = sb.channel('chase-' + STORE)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracking', filter: flt }, p => {
        const r = p.new || {};
        if (!r.acct) return;
        const rec = { st: r.st || '', next: r.next || '', note: r.note || '',
                      by: r.by_name || '', at: r.at || '', acts: r.acts || [], hist: r.hist || [] };
        if (r.ver) rec.ver = r.ver;
        cache.tracking[r.acct] = rec;
        emit('tracking', { acct: r.acct, rec });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims', filter: flt }, () => emit('claims', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assign', filter: flt }, () => emit('bases', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bases', filter: flt }, () => emit('bases', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: flt }, () => emit('settings', {}))
      .subscribe();
  }
  function unsubscribeLive() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
    channel = null; channelStore = null;
  }

  window.__chase = { sb, state: () => ({ ME, STORE, cache }) };  // handy when debugging together
})();
