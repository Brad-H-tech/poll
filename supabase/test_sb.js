/* Drives the real Chase app against the stand-in Supabase, in a real browser.
   Every button path the adapter serves gets exercised. */
const { chromium } = require('playwright');
const fs = require('fs');

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// where the --mock build landed (see build_site.py) and where proof files go
const SC = process.env.CHASE_BUILD_DIR || path.join(ROOT, '.build');
const CHROME = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'shelly-app', 'seed-stores.json'), 'utf8'));

// what the database looks like right after Bradley ran schema.sql + make-manager.sql,
// plus two consultants and a loaded base for Montrose and Vryheid.
const SEED = {
  users: [
    { id: 'u-brad',  email: 'bradley@chase.local', password: 'pw-brad' },
    { id: 'u-steve', email: 'steven@chase.local',  password: 'pw-steve' },
    { id: 'u-nol',   email: 'nolwazi@chase.local', password: 'pw-nol' },
  ],
  tables: {
    stores: [
      { id: 's1', name: 'Montrose', sort: 1 }, { id: 's2', name: 'Kokstad', sort: 2 },
      { id: 's3', name: 'Scottburgh', sort: 3 }, { id: 's4', name: 'Shelly Beach', sort: 4 },
      { id: 's5', name: 'Howick', sort: 5 }, { id: 's6', name: 'Vryheid', sort: 6 },
      { id: 's7', name: 'Admin', sort: 7 },
    ],
    profiles: [
      { id: 'u-brad',  username: 'bradley', name: 'Bradley', role: 'manager',    agent: '',        store_id: null },
      { id: 'u-steve', username: 'steven',  name: 'Steven',  role: 'consultant', agent: 'STEVEN',  store_id: 's1' },
      { id: 'u-nol',   username: 'nolwazi', name: 'Nolwazi', role: 'consultant', agent: 'NOLWAZI', store_id: 's6' },
    ],
    bases: [
      { id: 'b-s1-jun', store_id: 's1', label: 'Upgrade base · Jun 2026', rows: seed.s1.slice(0, 30), active: false, created_at: '2026-06-01', rows_count: 30 },
      { id: 'b-s1-jul', store_id: 's1', label: 'Upgrade base · Jul 2026', rows: seed.s1.slice(0, 60), active: false, created_at: '2026-07-01', rows_count: 60 },
      { id: 'b-s1', store_id: 's1', label: 'Upgrade base · Aug 2026', rows: seed.s1, active: true,  created_at: '2026-08-01' },
      { id: 'b-s6', store_id: 's6', label: 'Upgrade base · Aug 2026', rows: seed.s6, active: true,  created_at: '2026-08-01' },
    ],
    tracking: [], claims: [], assign: [], settings: [],
  },
};

(async () => {
  const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails.push(m); };
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-proxy-server'] });

  async function open(ctx) {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    p.on('console', m => { if (m.type() === 'error') console.log('  CONSOLE:', m.text().slice(0, 160)); });
    await p.addInitScript(s => {
      try { if (!localStorage.getItem('chase-mockdb')) localStorage.setItem('chase-mockdb', JSON.stringify(s)); }
      catch (e) { window.__MOCKDB__ = s; }
    }, SEED);
    await p.goto('file://' + SC + '/site-mock/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    return p;
  }
  const login = async (p, store, u, pw) => {
    await p.selectOption('#liStore', store); await p.waitForTimeout(150);
    await p.fill('#liU', u); await p.fill('#liP', pw);
    await p.click('#liGo'); await p.waitForTimeout(1500);
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const p = await open(ctx);

  // ---- store picker reads from the database, before anyone signs in
  const stores = await p.$$eval('#liStore option', els => els.map(e => e.textContent.trim()));
  ok(stores.length === 7 && stores[0] === 'Montrose' && stores[6] === 'Admin',
     'store picker loads all 7 stores from Supabase before login: ' + stores.join(', '));

  // ---- wrong password is refused
  await login(p, 's1', 'bradley', 'wrong-one');
  ok(await p.$eval('#liErr', e => /wrong/i.test(e.textContent)), 'wrong password refused');

  // ---- head office signs in and picks a store
  await login(p, 's1', 'bradley', 'pw-brad');
  ok(await p.$eval('#storeSub', e => /Montrose/.test(e.textContent)), 'head office signed in at Montrose');
  const rc = await p.$eval('#rowCount', e => e.textContent);
  ok(/of 382 accounts/.test(rc), 'Montrose base loaded from Supabase (' + rc.trim() + ')');
  // only the active base and the one before it (KPI deltas) were downloaded; older bases are listed by count only
  const lazy = await p.evaluate(() => datasets.map(d => ({ label: d.label, rows: d.rows.length, lazy: !!d.lazy, count: d.count })));
  ok(lazy.length === 3 && lazy[2].rows > 300 && lazy[1].rows === 60 && lazy[0].rows === 0 && lazy[0].lazy && lazy[0].count === 30,
     'older base listed without downloading its rows: ' + JSON.stringify(lazy));
  ok(await p.$eval('#basePills', e => /30 rows · tap to load/.test(e.textContent)), 'lazy base pill shows its row count');
  // and at the wire: every bases query that asked for `rows` was limited to the active base or to ≤ 2 ids
  const wire = await p.evaluate(() => (window.__mockQueries || []).filter(q => q.table === 'bases' && q.op === 'select')
    .map(q => ({ cols: q.cols, filters: q.filters.map(f => f.op === 'in' ? 'in:' + f.vals.length : f.col + '=' + f.val) })));
  const rowQueries = wire.filter(q => q.cols === '*' || q.cols.split(',').includes('rows'));
  ok(rowQueries.length > 0 && rowQueries.every(q => q.filters.includes('active=true') || q.filters.some(f => /^in:[12]$/.test(f))),
     'no bases query downloaded rows for more than the active base and one before it: ' + JSON.stringify(wire));
  ok(await p.$eval('#whoami', e => /Bradley/.test(e.textContent) && /manager/.test(e.textContent)), 'signed in as manager');

  // ---- set an outcome; it must persist to the database with history
  const acct = await p.$eval('#tbody tr.main', e => e.dataset.acct);
  await p.$eval('#tbody .track-sel', el => { el.value = 'won'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(800);
  let row = await p.evaluate(a => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || []).find(t => t.acct === a), acct);
  ok(row && row.st === 'won' && row.by_name === 'Bradley', 'outcome saved to the tracking table');
  ok(row && row.hist && row.hist.length === 1 && row.hist[0].to === 'won', 'outcome history written (audit trail)');

  // ---- log an activity (the quick-log bolt)
  await p.click('#tbody .qzap'); await p.waitForTimeout(400);
  await p.click('#qsGrid .qs-btn[data-q="na"]'); await p.waitForTimeout(800);
  const acct2 = await p.evaluate(() => qsAcct);
  row = await p.evaluate(a => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || []).find(t => t.acct === a), acct2);
  ok(row && (row.acts || []).some(x => x.t === 'na'), 'activity logged against the customer');
  await p.evaluate(() => closeQuick()); await p.waitForTimeout(300);

  // ---- add a walk-in
  await p.click('#addCustBtn'); await p.waitForTimeout(300);
  await p.fill('#ncName', 'Test Walkin'); await p.fill('#ncCell', '0821234567');
  await p.click('#ncAdd'); await p.waitForTimeout(1400);
  const added = await p.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('chase-mockdb')).tables.bases.find(x => x.id === 'b-s1');
    return b.rows.some(r => r[1] === 'Test Walkin' && r[4] === '27821234567');
  });
  ok(added, 'walk-in appended to the store base (number normalised to 27…)');

  // ---- settings save
  await p.evaluate(() => navTo('settings')); await p.waitForTimeout(500);
  await p.fill('#tplBox', 'Hi {name}, {agent} here from {store}.');
  await p.click('#tplSave'); await p.waitForTimeout(900);
  // settings live on the store row now (no separate settings table)
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.stores.find(s => s.id === 's1'));
  ok(st && /Hi \{name\}/.test(st.wa_tpl || ''), 'WhatsApp template saved on the store row');

  // ---- MTN activations verify
  fs.writeFileSync(SC + '/act.csv', 'MSISDN,Account\n27000000000,' + acct + '\n');
  const before = await p.evaluate(a => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || []).find(t => t.acct === a), acct);
  await p.evaluate(() => navTo('report')); await p.waitForTimeout(600);
  await p.setInputFiles('#verInp', SC + '/act.csv'); await p.waitForTimeout(1500);
  row = await p.evaluate(a => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || []).find(t => t.acct === a), acct);
  ok(row && !!row.ver, 'MTN activations file confirmed the Won (ver stamped)');
  ok(row && row.st === before.st && JSON.stringify(row.hist) === JSON.stringify(before.hist) && JSON.stringify(row.acts) === JSON.stringify(before.acts),
     'verify only touched ver: outcome, history and activities untouched');
  const verAt = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.stores.find(s => s.id === 's1').verify_at);
  ok(!!verAt, 'verify date stamped on the store row');

  // ---- splits on Vryheid: switch store by re-login (head office)
  // sign out without reloading — a reload would re-seed the stand-in database
  await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); });
  await p.waitForTimeout(700);
  await login(p, 's6', 'bradley', 'pw-brad');
  ok(await p.$eval('#storeSub', e => /Vryheid/.test(e.textContent)), 'head office switched to Vryheid');
  await p.evaluate(() => navTo('base')); await p.waitForTimeout(800);
  await p.evaluate(() => api('/api/assign/split', { method: 'POST', body: JSON.stringify({ mode: 'even', agents: ['STEVEN', 'NOLWAZI'] }) }));
  await p.waitForTimeout(1600);
  // who owns a customer is the `agent` column on the tracking row (no separate assign table)
  const assigned = await p.evaluate(() => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || [])
    .filter(t => t.store_id === 's6' && t.agent !== null && t.agent !== undefined).length);
  ok(assigned > 400, 'even split wrote ' + assigned + ' owners onto tracking rows');

  // put one customer back in the pool so the claims flow has something to claim
  const backAcct = await p.evaluate(() => Object.keys(ASSIGN)[0]);
  await p.evaluate(a => api('/api/assign', { method: 'POST', body: JSON.stringify({ accts: [a], agent: '' }) }), backAcct);
  await p.waitForTimeout(900);

  // ---- consultant: scoped to their own store, blocked from manager actions
  const p2 = await open(ctx);
  await login(p2, 's1', 'nolwazi', 'pw-nol');   // deliberately picks the WRONG store
  const sub2 = await p2.$eval('#storeSub', e => e.textContent);
  ok(/Vryheid/.test(sub2), 'consultant forced into their own store, ignoring the picker (' + sub2.trim() + ')');
  const denied = await p2.evaluate(() => fetch('/api/assign', { method: 'POST',
    body: JSON.stringify({ accts: ['X'], agent: 'NOLWAZI' }) }).then(r => r.status));
  ok(denied === 403, 'consultant blocked from moving accounts (' + denied + ')');
  const rc2 = await p2.$eval('#rowCount', e => e.textContent);
  ok(/of 2\d\d accounts/.test(rc2), 'consultant sees only their split share (' + rc2.trim() + ')');

  // ---- claim -> manager approves
  await p2.evaluate(() => { filters = { ...F0(), agent: '__none' }; shown = 40; syncFilterControls(); renderExplorer(); });
  await p2.waitForTimeout(600);
  const claimBtn = await p2.$('#tbody .claimbtn');
  if (claimBtn) { await claimBtn.click(); await p2.waitForTimeout(1000); }
  const claimRow = await p2.evaluate(() => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.claims || [])[0]);
  ok(claimRow && claimRow.status === 'pending' && claimRow.by_name === 'Nolwazi', 'consultant raised a claim');

  // ---- live sync: what Nolwazi logs must appear on the manager's screen
  const liveAcct = await p2.$eval('#tbody tr.main', e => e.dataset.acct);
  await p2.$eval('#tbody .track-sel', el => { el.value = 'quote'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p2.waitForTimeout(1200);
  const seenByManager = await p.evaluate(a => (tracking[a] || {}).st, liveAcct);
  ok(seenByManager === 'quote', "manager's screen updated live from the consultant's phone (" + seenByManager + ')');
  await p2.close();

  await p.evaluate(() => refreshState()); await p.waitForTimeout(900);
  await p.evaluate(() => navTo('claims')); await p.waitForTimeout(700);
  const okBtn = await p.$('#claimsList [data-ok]');
  ok(!!okBtn, 'manager sees the pending claim');
  if (okBtn) { await okBtn.click(); await p.waitForTimeout(1200); }
  const decided = await p.evaluate(() => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.claims || [])[0]);
  ok(decided && decided.status === 'approved', 'manager approved it');
  const owner = await p.evaluate(a => ((JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || [])
    .find(t => t.store_id === 's6' && t.acct === a) || {}).agent, decided && decided.acct);
  ok(owner === 'NOLWAZI', 'approval made Nolwazi the owner on the tracking row (' + owner + ')');

  // ---- creating a consultant goes through the Chase API (no public sign-up), with the manager's own token
  const apiCalls = [];
  await ctx.route('https://chase-api.mock/**', async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                   'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON();
    apiCalls.push({ url: req.url(), auth: req.headers()['authorization'], body });
    // what the real API does server-side: create the login and the profile
    await p.evaluate(({ u, name, agent, store, pw }) => {
      const db = JSON.parse(localStorage.getItem('chase-mockdb'));
      db.users.push({ id: 'u-' + u, email: u + '@chase.local', password: pw });
      db.tables.profiles.push({ id: 'u-' + u, username: u, name, role: 'consultant', agent, store_id: store });
      localStorage.setItem('chase-mockdb', JSON.stringify(db));
    }, { u: body.username, name: body.name, agent: body.agent, store: new URL(req.url()).searchParams.get('store'), pw: body.password });
    await route.fulfill({ status: 201, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'u-' + body.username, username: body.username }) });
  });
  await p.evaluate(() => navTo('team')); await p.waitForTimeout(700);
  await p.fill('#nuName', 'Busi'); await p.fill('#nuUser', 'busi');
  await p.fill('#nuPass', 'short'); await p.fill('#nuAgent', 'BUSI');
  await p.click('#nuAdd'); await p.waitForTimeout(600);
  ok(apiCalls.length === 0, 'a 5-character password is refused before anything is sent');
  await p.fill('#nuPass', 'busi-123456');
  await p.click('#nuAdd'); await p.waitForTimeout(1400);
  const newUser = await p.evaluate(() => ({
    auth: JSON.parse(localStorage.getItem('chase-mockdb')).users.some(u => u.email === 'busi@chase.local'),
    prof: (JSON.parse(localStorage.getItem('chase-mockdb')).tables.profiles || []).find(x => x.username === 'busi'),
  }));
  ok(apiCalls.length === 1 && /\/v1\/users\?store=s6$/.test(apiCalls[0].url),
     'Team tab called the Chase API for this store (' + (apiCalls[0] || {}).url + ')');
  ok(apiCalls[0] && apiCalls[0].auth === 'Bearer mock-jwt-u-brad', "…with the manager's own login token, no API key in the page");
  ok(apiCalls[0] && apiCalls[0].body.username === 'busi' && apiCalls[0].body.agent === 'BUSI' && !('u' in apiCalls[0].body),
     'request body uses the API contract (username/name/password/role/agent)');
  ok(newUser.auth && newUser.prof && newUser.prof.store_id === 's6' && newUser.prof.agent === 'BUSI',
     'manager created a consultant: login + profile, scoped to this store');
  const stillMgr = await p.$eval('#whoami', e => /Bradley/.test(e.textContent));
  ok(stillMgr, 'creating a user did NOT sign the manager out');

  // that new consultant can actually sign in
  const p3 = await open(ctx);
  await login(p3, 's6', 'busi', 'busi-123456');
  ok(await p3.$eval('#whoami', e => /Busi/.test(e.textContent)).catch(() => false),
     'the brand-new consultant can sign in');
  await p3.close();

  await p.screenshot({ path: SC + '/proof-supabase.png' });
  await p.close(); await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
