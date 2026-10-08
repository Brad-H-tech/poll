/* Head-office admin features, driven in a real browser against the stand-in Supabase:
   1. the column check when loading a base (guess, fix, remember),
   2. allocating people to stores from the Team table,
   3. every store's WhatsApp message in one place, with who changed it last.
   Run:  python3 supabase/build_site.py --mock && node supabase/test_admin.js */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SC = process.env.CHASE_BUILD_DIR || path.join(ROOT, '.build');
const SITE = 'file://' + path.join(SC, 'site-mock', 'index.html');
const CSV = path.join(SC, 'DEMO-shelly-beach-fake-base.csv');
if (!fs.existsSync(CSV)) execFileSync('python3', [path.join(ROOT, 'supabase', 'make-demo-base.py'), SC]);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// a "wrong" export: columns in a different order, two headings Chase cannot guess
const demo = fs.readFileSync(CSV, 'utf8').split('\n');
const H = demo[0].split(',');
const ix = n => H.indexOf(n);
const pick = [ix('PrimaryMSISDN'), ix('AccountNumber'), ix('HandsetRSP'), ix('ProductDescription'), ix('CustomerName'), ix('CSR')];
const weird = ['Number', 'AccountNumber', 'HandsetRSP', 'ProductDescription', 'Person', 'CSR'].join(',') + '\n' +
  demo.slice(1).filter(Boolean).map(l => { const c = l.split(','); return pick.map(i => c[i]).join(','); }).join('\n');
const WEIRD = path.join(SC, 'weird-export.csv');
fs.writeFileSync(WEIRD, weird);

const SEED = {
  users: [{ id: 'u-brad', email: 'bradley@chase.local', password: 'pw-brad' },
          { id: 'u-sim',  email: 'simone@chase.local',  password: 'pw-sim' },
          { id: 'u-sto',  email: 'storemgr@chase.local', password: 'pw-storemgr' }],
  tables: {
    stores: [
      { id: 's1', name: 'Montrose', sort: 1, wa_tpl: '' }, { id: 's2', name: 'Kokstad', sort: 2, wa_tpl: '' },
      { id: 's3', name: 'Scottburgh', sort: 3, wa_tpl: '' }, { id: 's4', name: 'Shelly Beach', sort: 4, wa_tpl: '' },
      { id: 's5', name: 'Howick', sort: 5, wa_tpl: '' }, { id: 's6', name: 'Vryheid', sort: 6, wa_tpl: '' }, { id: 's7', name: 'Admin', sort: 7, wa_tpl: '' },
    ],
    profiles: [
      { id: 'u-brad', username: 'bradley',  name: 'Bradley',  role: 'manager',    agent: '',       store_id: null },
      { id: 'u-sim',  username: 'simone',   name: 'Simone',   role: 'consultant', agent: 'SIMONE', store_id: 's4' },
      { id: 'u-sto',  username: 'storemgr', name: 'Store Mgr', role: 'manager',   agent: '',       store_id: 's4' },
    ],
    bases: [], tracking: [], claims: [], assign: [], settings: [],
  },
};

(async () => {
  const fails = [], errs = [];
  const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails.push(m); };
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // the mock build points "Add user" at a stand-in Chase API; answer it the way the real one would
  await ctx.route('https://chase-api.mock/**', async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON(), store = new URL(req.url()).searchParams.get('store');
    await ctx.pages()[0].evaluate(({ u, name, agent, store, pw }) => {
      const db = JSON.parse(localStorage.getItem('chase-mockdb'));
      db.users.push({ id: 'u-' + u, email: u + '@chase.local', password: pw });
      db.tables.profiles.push({ id: 'u-' + u, username: u, name, role: 'consultant', agent, store_id: store });
      localStorage.setItem('chase-mockdb', JSON.stringify(db));
    }, { u: body.username, name: body.name, agent: body.agent, store, pw: body.password });
    await route.fulfill({ status: 201, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'u-' + body.username, username: body.username }) });
  });
  async function open() {
    const p = await ctx.newPage();
    p.on('pageerror', e => { errs.push(e.message); console.log('  PAGEERROR:', e.message); });
    p.on('dialog', d => d.accept());
    await p.addInitScript(s => { try { if (!localStorage.getItem('chase-mockdb')) localStorage.setItem('chase-mockdb', JSON.stringify(s)); } catch (e) {} }, SEED);
    await p.goto(SITE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
    return p;
  }
  const login = async (p, store, u, pw) => {
    await p.evaluate(s => lfGo('pass', { store: s, someoneElse: true }), store); await p.waitForTimeout(150);
    await p.fill('#liU', u); await p.fill('#liP', pw); await p.click('#liGo'); await p.waitForTimeout(1500);
  };
  const logout = async p => { await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); }); await p.waitForTimeout(400); };
  const sel = (p, field) => p.$eval(`#mMap select[data-field="${field}"]`, e => e.options[e.selectedIndex].textContent);

  const p = await open();
  await login(p, 's4', 'bradley', 'pw-brad');
  ok(await p.evaluate(() => ME && ME.head === true), 'Bradley is recognised as head office');

  /* ---------- 1. column check ---------- */
  await p.setInputFiles('#fileInp', WEIRD); await p.waitForTimeout(1200);
  ok(await p.$eval('#modal', e => e.classList.contains('show')), 'a file with unknown headings still opens the preview (no hard error)');
  ok((await sel(p, 'acct')) === 'AccountNumber' && (await sel(p, 'rsp')) === 'HandsetRSP' && (await sel(p, 'product')) === 'ProductDescription',
     'the headings Chase recognises are pre-selected: ' + [await sel(p, 'acct'), await sel(p, 'rsp'), await sel(p, 'product')].join(' · '));
  ok((await sel(p, 'name')) === '— not in this file —' && (await sel(p, 'msisdn')) === '— not in this file —',
     '"Person" and "Number" are not guessed — left for the manager');
  ok(await p.$eval('#mOk', e => e.disabled), 'Add base is disabled while a starred column is missing');
  ok(await p.$eval('#mRows', e => /Still needed/.test(e.textContent) && /Customer name/.test(e.textContent)), 'preview says what is still needed, in plain words');
  await p.selectOption('#mMap select[data-field="name"]', { label: 'Person' }); await p.waitForTimeout(300);
  await p.selectOption('#mMap select[data-field="msisdn"]', { label: 'Number' }); await p.waitForTimeout(300);
  ok(!(await p.$eval('#mOk', e => e.disabled)), 'choosing Person as the name enables Add base');
  const accounts = await p.$eval('#mRows', e => +(e.textContent.match(/Accounts(\d+)/) || [])[1]);
  ok(accounts === 56, 'preview rebuilt from the chosen columns: 56 accounts (' + accounts + ')');
  // picking a column already used elsewhere moves it (one heading can only mean one thing)
  await p.selectOption('#mMap select[data-field="surname"]', { label: 'Person' }); await p.waitForTimeout(300);
  ok((await sel(p, 'name')) === '— not in this file —' && (await sel(p, 'surname')) === 'Person', 'a heading can only be used once — it moves to the new field');
  await p.selectOption('#mMap select[data-field="name"]', { label: 'Person' }); await p.waitForTimeout(300);
  await p.click('#mOk'); await p.waitForTimeout(2500);
  ok(!(await p.$eval('#modal', e => e.classList.contains('show'))), 'base loads');
  const names = await p.evaluate(() => DS().customers.slice(0, 3).map(c => c.name));
  ok(names.every(n => n && n.length > 2), 'customers carry the names from the "Person" column: ' + names.join(', '));
  const mem = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-colmap') || '{}'));
  ok(mem.person === 'name' && mem.number === 'msisdn', 'the corrections are remembered on this device');
  // next month: same odd headings — guessed straight away
  await p.setInputFiles('#fileInp', WEIRD); await p.waitForTimeout(1200);
  ok((await sel(p, 'name')) === 'Person' && (await sel(p, 'msisdn')) === 'Number' && !(await p.$eval('#mOk', e => e.disabled)),
     'next upload with the same headings is mapped automatically');
  await p.click('#mCancel'); await p.waitForTimeout(300);
  // the ordinary demo export still maps itself completely
  await p.setInputFiles('#fileInp', CSV); await p.waitForTimeout(1200);
  ok(await p.$eval('#mRows', e => /Columnsmatched17of17/.test(e.textContent.replace(/\s+/g, ''))), 'the standard MTN export matches all 17 columns by itself');
  await p.click('#mCancel'); await p.waitForTimeout(300);

  /* ---------- 1b. the blank template ---------- */
  await p.evaluate(() => navTo('load')); await p.waitForTimeout(600);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#tplDl')]);
  ok(dl.suggestedFilename() === 'Chase-base-template.csv', 'Download blank template gives Chase-base-template.csv');
  ok(!(await p.$eval('#modal', e => e.classList.contains('show'))), 'clicking the download button does not open the file picker/preview');
  const tplPath = path.join(SC, 'downloaded-template.csv'); await dl.saveAs(tplPath);
  const tplLines = fs.readFileSync(tplPath, 'utf8').replace(/^\ufeff/, '').trim().split(/\r?\n/);
  ok(tplLines[0] === 'AccountNumber,CustomerName,CustomerSurname,PrimaryMSISDN,ProductDescription,HandsetRSP,Package,ContractType,ActivationDate,InvoiceStatus,CustomerCategory,Offer,Email,CSR,Outcome,NextActionDate,CallNotes',
     'template has the 17 headings Chase reads, required ones first');
  ok(tplLines.length === 2 && /^EXAMPLE-DELETE-THIS-ROW,Thandi/.test(tplLines[1]), 'one clearly-marked example row');
  await p.click('#tplHow'); await p.waitForTimeout(200);
  ok(await p.$eval('#tplHelp', e => !e.hidden && e.querySelectorAll('tr').length === 17 && /AccountNumber/.test(e.textContent) && e.querySelectorAll('.req').length >= 4),
     'the column guide lists all 17 columns and stars the required four');
  // someone fills in two customers but forgets to delete the example row
  const filled = tplLines[0] + '\n' + tplLines[1] + '\n' +
    '2001,Thandi,Mokoena,0831234567,Samsung Galaxy A55,499,MTN Mega Gigs S,Upgrade,2024-03-15,Out of contract,Consumer,,,,,,\n' +
    '2002,Bongani,Dlamini,0829876543,iPhone 13,799,MTN Sky,Upgrade,2024-01-02,Out of contract,Business,,,,,,\n';
  const filledPath = path.join(SC, 'filled-template.csv'); fs.writeFileSync(filledPath, filled);
  await p.setInputFiles('#fileInp', filledPath); await p.waitForTimeout(1200);
  ok(await p.$eval('#mRows', e => /Columnsmatched17of17/.test(e.textContent.replace(/\s+/g, ''))), 'a filled-in template maps itself 17 of 17');
  ok(await p.$eval('#mRows', e => /Accounts2(?!\d)/.test(e.textContent.replace(/\s+/g, ''))), 'the example row is ignored: 2 accounts, not 3');
  ok(!(await p.$eval('#mOk', e => e.disabled)), 'ready to add');
  await p.click('#mCancel'); await p.waitForTimeout(300);

  /* ---------- 2. allocate people to stores ---------- */
  await p.evaluate(() => navTo('team')); await p.waitForTimeout(900);
  const simoneSel = await p.$('#teamList select[data-store-of="simone"]');
  ok(!!simoneSel, 'head office sees a store dropdown on each person');
  ok(await simoneSel.evaluate(e => e.value === 's4'), 'Simone shows Shelly Beach');
  ok(await p.$eval('#teamList select[data-store-of="bradley"]', e => e.value === '' && /head office/i.test(e.options[0].textContent)), 'Bradley shows "All stores (head office)"');
  ok(await p.$eval('#teamList select[data-store-of="simone"]', e => ![...e.options].some(o => /head office/i.test(o.textContent))), 'a consultant cannot be made head office');
  await p.selectOption('#teamList select[data-store-of="simone"]', 's1'); await p.waitForTimeout(1200);
  const moved = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.profiles.find(x => x.username === 'simone').store_id);
  ok(moved === 's1', 'Simone moved to Montrose in the database (' + moved + ')');
  ok(await p.$eval('#teamList select[data-store-of="simone"]', e => e.value === 's1'), 'table shows Montrose after the move');
  ok(await p.$eval('#nuStore', e => !e.hidden && e.options.length === 7), 'Add user row offers the store to put the new person in');
  await p.fill('#nuName', 'Thabo'); await p.fill('#nuUser', 'thabo'); await p.fill('#nuPass', 'thabo12345678'); await p.fill('#nuAgent', 'THABO');
  await p.selectOption('#nuStore', 's2'); await p.click('#nuAdd'); await p.waitForTimeout(1500);
  const thabo = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.profiles.find(x => x.username === 'thabo'));
  ok(thabo && thabo.store_id === 's2', 'new user lands in the chosen store (Kokstad), not the one head office is signed into');

  /* ---------- 3. messages by store ---------- */
  await p.evaluate(() => navTo('settings')); await p.waitForTimeout(900);
  ok(await p.$eval('#storeMsgCard', e => !e.hidden), 'head office sees "Messages by store"');
  const blocks = await p.$$eval('#storeMsgBody .smsg', els => els.map(e => e.querySelector('b').textContent));
  ok(blocks.length === 7 && blocks[0] === 'Montrose', 'one block per store, in order: ' + blocks.join(', '));
  ok(await p.$$eval('#storeMsgBody .pill', els => els.every(e => /Default message/.test(e.textContent))), 'every store starts on the default message');
  // a store manager changes their own store's message
  const p2 = await open();
  await login(p2, 's4', 'storemgr', 'pw-storemgr');
  ok(await p2.evaluate(() => ME && ME.head === false), 'a store manager is not head office');
  ok(await p2.$eval('#storeMsgCard', e => e.hidden), 'store manager does not see the all-stores panel');
  await p2.evaluate(() => navTo('settings')); await p2.waitForTimeout(500);
  await p2.fill('#tplBox', 'Hi {name}, Shelly Beach special for you!'); await p2.click('#tplSave'); await p2.waitForTimeout(800);
  await p2.close();
  // head office can see who changed it
  await p.evaluate(() => navTo('settings')); await p.waitForTimeout(900);
  const sb = await p.$eval('#storeMsgBody [data-smsg="s4"]', e => ({ pill: e.querySelector('.pill').textContent, box: e.querySelector('textarea').value }));
  ok(/Changed by Store Mgr/.test(sb.pill), 'Shelly Beach now says who changed it: "' + sb.pill + '"');
  ok(/Shelly Beach special/.test(sb.box), 'and shows the new wording');
  // head office changes Montrose from here
  await p.fill('#storeMsgBody [data-smsg-box="s1"]', 'Hi {name}, {agent} here from MTN Montrose.'); await p.click('#storeMsgBody [data-smsg-save="s1"]'); await p.waitForTimeout(900);
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.stores.find(x => x.id === 's1'));
  ok(/Montrose\./.test(s1.wa_tpl) && s1.wa_tpl_by === 'Bradley' && !!s1.wa_tpl_at, 'Montrose saved with Bradley recorded as the changer');
  ok(await p.$eval('#storeMsgBody [data-smsg="s1"] .pill', e => /Changed by Bradley/.test(e.textContent)), 'panel shows "Changed by Bradley"');
  await p.click('#storeMsgBody [data-smsg-reset="s4"]'); await p.waitForTimeout(900);
  const s4 = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')).tables.stores.find(x => x.id === 's4'));
  ok(s4.wa_tpl === '' && await p.$eval('#storeMsgBody [data-smsg="s4"] .pill', e => /Default message/.test(e.textContent)), '"Back to default" clears Shelly Beach again');
  await p.screenshot({ path: path.join(SC, 'admin-messages.png'), fullPage: false });

  // a consultant sees none of it
  const p3 = await open();
  await login(p3, 's1', 'simone', 'pw-sim');
  ok(await p3.$eval('#storeMsgCard', e => e.hidden) && await p3.$eval('#teamCard', e => e.offsetParent === null), 'consultant sees neither panel');
  await p3.close();

  ok(errs.length === 0, 'no JavaScript errors during the run');
  await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
