#!/usr/bin/env node
/* Shelly — team server. Zero dependencies: Node 18+ only.
   Storage: data/store.json (atomic writes). Auth: scrypt + httpOnly cookie sessions.
   Live sync: server-sent events on /api/events. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const STORE = path.join(DATA, 'store.json');
const SESSION_DAYS = 30;
const BODY_LIMIT = 25 * 1024 * 1024;

fs.mkdirSync(DATA, { recursive: true });

/* ---------------- store ---------------- */
const uid = () => crypto.randomBytes(8).toString('hex');
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPw(pw, u) {
  const h = crypto.scryptSync(String(pw), u.salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash));
}
function defaultStore() {
  const s = { users: [], sessions: {}, bases: [], active: null, tracking: {} };
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed-rows.json'), 'utf8'));
    if (Array.isArray(rows) && rows.length) {
      const id = uid();
      s.bases.push({ id, label: 'Base · May–Jul 2024', rows });
      s.active = id;
    }
  } catch (e) { /* no seed — start empty */ }
  return s;
}
let saveTimer = null;
let store;
try { store = JSON.parse(fs.readFileSync(STORE, 'utf8')); }
catch (e) { store = defaultStore(); persistNow(); }

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 100);
}
function persistNow() {
  clearTimeout(saveTimer);
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE);
}

/* first run: create the manager account */
if (!store.users.length) {
  const pw = process.env.SHELLY_ADMIN_PASSWORD || 'shelly-' + crypto.randomBytes(3).toString('hex');
  store.users.push({ u: 'admin', name: 'Manager', role: 'manager', ...hashPw(pw) });
  persistNow();
  console.log('\n  ┌─ Shelly first run ─────────────────────────┐');
  console.log('  │  Manager account created                   │');
  console.log('  │  username: admin                           │');
  console.log(`  │  password: ${pw.padEnd(32)}│`);
  console.log('  │  Add consultants in Manager → Team.        │');
  console.log('  └────────────────────────────────────────────┘\n');
}

/* ---------------- sessions & auth ---------------- */
function newSession(u) {
  const token = crypto.randomBytes(24).toString('hex');
  store.sessions[token] = { u, exp: Date.now() + SESSION_DAYS * 864e5 };
  persist();
  return token;
}
function getUser(req) {
  const m = /(?:^|;\s*)shelly_sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = store.sessions[m[1]];
  if (!s || s.exp < Date.now()) { if (s) { delete store.sessions[m[1]]; persist(); } return null; }
  const user = store.users.find(x => x.u === s.u);
  return user ? { token: m[1], user } : null;
}
const attempts = new Map(); // ip -> {n, reset}
function rateLimited(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) { attempts.set(ip, { n: 1, reset: Date.now() + 15 * 60e3 }); return false; }
  a.n++;
  return a.n > 25;
}

/* ---------------- SSE ---------------- */
const clients = new Set();
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
setInterval(() => broadcast('ping', { t: Date.now() }), 25e3).unref();

/* ---------------- helpers ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, urlPath) {
  let p = path.normalize(path.join(PUB, urlPath === '/' ? 'index.html' : urlPath));
  if (!p.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
}
function cleanStr(v, max) { return String(v ?? '').slice(0, max || 200); }
function publicUser(u) { return { u: u.u, name: u.name, role: u.role, agent: u.agent || '' }; }
function today() { return new Date().toISOString().slice(0, 10); }

function applyOutcomes(list, byName) {
  let applied = 0;
  for (const t of (Array.isArray(list) ? list : [])) {
    const acct = cleanStr(t.acct, 40); if (!acct) continue;
    const cur = store.tracking[acct] = store.tracking[acct] || {};
    let touched = false;
    if (t.st && ['fu', 'cb', 'won', 'lost', 'na'].includes(t.st)) { cur.st = t.st; applied++; touched = true; }
    if (t.next) { cur.next = cleanStr(t.next, 10); touched = true; }
    if (t.note) { cur.note = cleanStr(t.note, 2000); touched = true; }
    if (touched) { cur.by = byName; cur.at = today(); broadcast('tracking', { acct, rec: cur }); }
  }
  if (applied) persist();
  return applied;
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    /* ---- public: login ---- */
    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      if (rateLimited(ip)) return json(res, 429, { error: 'Too many attempts — wait 15 minutes' });
      const { u, p: pw } = await readBody(req);
      const user = store.users.find(x => x.u === cleanStr(u, 40).toLowerCase());
      if (!user || !checkPw(pw || '', user)) return json(res, 401, { error: 'Wrong username or password' });
      const token = newSession(user.u);
      res.setHeader('Set-Cookie',
        `shelly_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
      return json(res, 200, { ok: true, me: publicUser(user) });
    }

    /* ---- everything else requires auth ---- */
    const auth = getUser(req);
    if (!auth) return json(res, 401, { error: 'Not signed in' });
    const me = auth.user;
    const isMgr = me.role === 'manager';

    if (p === '/api/logout' && req.method === 'POST') {
      delete store.sessions[auth.token]; persist();
      res.setHeader('Set-Cookie', 'shelly_sid=; HttpOnly; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (p === '/api/me') return json(res, 200, { me: publicUser(me) });

    if (p === '/api/state') {
      return json(res, 200, {
        me: publicUser(me),
        bases: store.bases.map(b => ({ id: b.id, label: b.label, rows: b.rows })),
        active: store.active,
        tracking: store.tracking,
      });
    }

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    /* ---- tracking: any signed-in user ---- */
    let m = /^\/api\/tracking\/(.+)$/.exec(p);
    if (m && req.method === 'PUT') {
      const acct = cleanStr(decodeURIComponent(m[1]), 40);
      const body = await readBody(req);
      const rec = {
        st: ['', 'fu', 'cb', 'won', 'lost', 'na'].includes(body.st) ? body.st : '',
        next: cleanStr(body.next, 10),
        note: cleanStr(body.note, 2000),
        by: me.name, at: today(),
      };
      store.tracking[acct] = rec; persist();
      broadcast('tracking', { acct, rec });
      return json(res, 200, { ok: true });
    }

    /* ---- bases: manager only ---- */
    if (p === '/api/bases' && req.method === 'POST') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      const body = await readBody(req);
      const applied = applyOutcomes(body.outcomes, me.name);
      let added = false;
      if (body.addBase !== false) {
        const rows = body.rows;
        if (!Array.isArray(rows) || !rows.length || rows.length > 50000 || !Array.isArray(rows[0]))
          return json(res, 400, { error: 'Invalid rows payload' });
        const id = uid();
        store.bases.push({ id, label: cleanStr(body.label, 40) || 'Uploaded base', rows });
        store.active = id; added = true; persist();
        broadcast('bases', {});
      }
      return json(res, 200, { ok: true, added, applied });
    }
    m = /^\/api\/bases\/([a-f0-9]+)\/activate$/.exec(p);
    if (m && req.method === 'POST') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      if (!store.bases.find(b => b.id === m[1])) return json(res, 404, { error: 'No such base' });
      store.active = m[1]; persist(); broadcast('bases', {});
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/bases\/([a-f0-9]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      const i = store.bases.findIndex(b => b.id === m[1]);
      if (i < 0) return json(res, 404, { error: 'No such base' });
      if (store.bases.length === 1) return json(res, 400, { error: 'Cannot remove the last base' });
      store.bases.splice(i, 1);
      if (store.active === m[1]) store.active = store.bases[store.bases.length - 1].id;
      persist(); broadcast('bases', {});
      return json(res, 200, { ok: true });
    }

    /* ---- users: manager only (password change: self allowed) ---- */
    if (p === '/api/users' && req.method === 'GET') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      return json(res, 200, store.users.map(publicUser));
    }
    if (p === '/api/users' && req.method === 'POST') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      const b = await readBody(req);
      const u = cleanStr(b.u, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const name = cleanStr(b.name, 60).trim();
      const role = b.role === 'manager' ? 'manager' : 'consultant';
      if (!u || !name) return json(res, 400, { error: 'Name and username are required' });
      if (String(b.p || '').length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
      if (store.users.find(x => x.u === u)) return json(res, 409, { error: 'Username already exists' });
      const agent = cleanStr(b.agent, 30).toUpperCase().trim();
      store.users.push({ u, name, role, agent, ...hashPw(b.p) }); persist();
      broadcast('team', {});
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/users\/([a-z0-9._-]+)\/password$/.exec(p);
    if (m && req.method === 'PUT') {
      const target = store.users.find(x => x.u === m[1]);
      if (!target) return json(res, 404, { error: 'No such user' });
      if (!isMgr && target.u !== me.u) return json(res, 403, { error: 'Not allowed' });
      const b = await readBody(req);
      if (!isMgr && !checkPw(b.old || '', target)) return json(res, 401, { error: 'Current password is wrong' });
      if (String(b.p || '').length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
      Object.assign(target, hashPw(b.p)); persist();
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/users\/([a-z0-9._-]+)$/.exec(p);
    if (m && req.method === 'DELETE') {
      if (!isMgr) return json(res, 403, { error: 'Manager only' });
      if (m[1] === me.u) return json(res, 400, { error: 'You cannot remove yourself' });
      const i = store.users.findIndex(x => x.u === m[1]);
      if (i < 0) return json(res, 404, { error: 'No such user' });
      store.users.splice(i, 1);
      for (const [tok, s] of Object.entries(store.sessions)) if (s.u === m[1]) delete store.sessions[tok];
      persist(); broadcast('team', {});
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    return json(res, err.message === 'Payload too large' ? 413 : 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Shelly running → http://localhost:${PORT}`));
