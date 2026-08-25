/* Drives the real Chase app against the stand-in Supabase, in a real browser.
   Every button path the adapter serves gets exercised. */
const { chromium } = require('playwright');
const fs = require('fs');

const SC = '/tmp/claude-0/-home-user-poll/9568d26a-bb99-556f-bb65-a5bb50270263/scratchpad';
const seed = JSON.parse(fs.readFileSync('/home/user/poll/shelly-app/seed-stores.json', 'utf8'));

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
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server'] });

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
  const st = await p.evaluate(() => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.settings || [])[0]);
  ok(st && /Hi \{name\}/.test(st.wa_tpl || ''), 'WhatsApp template saved for the store');

  // ---- MTN activations verify
  fs.writeFileSync(SC + '/act.csv', 'MSISDN,Account\n27000000000,' + acct + '\n');
  await p.evaluate(() => navTo('report')); await p.waitForTimeout(600);
  await p.setInputFiles('#verInp', SC + '/act.csv'); await p.waitForTimeout(1500);
  row = await p.evaluate(a => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.tracking || []).find(t => t.acct === a), acct);
  ok(row && !!row.ver, 'MTN activations file confirmed the Won (ver stamped)');

  // ---- splits on Vryheid: switch store by re-login (head office)
  // sign out without reloading — a reload would re-seed the stand-in database
  await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); });
  await p.waitForTimeout(700);
  await login(p, 's6', 'bradley', 'pw-brad');
  ok(await p.$eval('#storeSub', e => /Vryheid/.test(e.textContent)), 'head office switched to Vryheid');
  await p.evaluate(() => navTo('base')); await p.waitForTimeout(800);
  await p.evaluate(() => api('/api/assign/split', { method: 'POST', body: JSON.stringify({ mode: 'even', agents: ['STEVEN', 'NOLWAZI'] }) }));
  await p.waitForTimeout(1600);
  const assigned = await p.evaluate(() => (JSON.parse(localStorage.getItem('chase-mockdb')).tables.assign || []).length);
  ok(assigned > 400, 'even split wrote ' + assigned + ' assignments to the database');

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

  // ---- creating a consultant makes a real login
  await p.evaluate(() => navTo('team')); await p.waitForTimeout(700);
  await p.fill('#nuName', 'Busi'); await p.fill('#nuUser', 'busi');
  await p.fill('#nuPass', 'busi12345'); await p.fill('#nuAgent', 'BUSI');
  await p.click('#nuAdd'); await p.waitForTimeout(1400);
  const newUser = await p.evaluate(() => ({
    auth: JSON.parse(localStorage.getItem('chase-mockdb')).users.some(u => u.email === 'busi@chase.local'),
    prof: (JSON.parse(localStorage.getItem('chase-mockdb')).tables.profiles || []).find(x => x.username === 'busi'),
  }));
  ok(newUser.auth && newUser.prof && newUser.prof.store_id === 's6' && newUser.prof.agent === 'BUSI',
     'manager created a consultant: login + profile, scoped to this store');
  const stillMgr = await p.$eval('#whoami', e => /Bradley/.test(e.textContent));
  ok(stillMgr, 'creating a user did NOT sign the manager out');

  // that new consultant can actually sign in
  const p3 = await open(ctx);
  await login(p3, 's6', 'busi', 'busi12345');
  ok(await p3.$eval('#whoami', e => /Busi/.test(e.textContent)).catch(() => false),
     'the brand-new consultant can sign in');
  await p3.close();

  await p.screenshot({ path: SC + '/proof-supabase.png' });
  await p.close(); await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
