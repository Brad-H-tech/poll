/* The sign-in flow (business -> store -> who's chasing -> password) and the Start-here card,
   driven in a real browser against the stand-in Supabase.
   Run:  python3 supabase/build_site.py --mock && node supabase/test_login.js */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SC = process.env.CHASE_BUILD_DIR || path.join(ROOT, '.build');
const SITE = 'file://' + path.join(SC, 'site-mock', 'index.html');
const CSV = path.join(SC, 'DEMO-shelly-beach-fake-base.csv');
if (!fs.existsSync(CSV)) execFileSync('python3', [path.join(ROOT, 'supabase', 'make-demo-base.py'), SC]);

const SEED = {
  users: [{ id: 'u-brad', email: 'bradley@chase.local', password: 'pw-brad' },
          { id: 'u-sim',  email: 'simone@chase.local',  password: 'pw-sim' }],
  tables: {
    stores: [
      { id: 's1', name: 'Montrose', sort: 1 }, { id: 's2', name: 'Kokstad', sort: 2 },
      { id: 's3', name: 'Scottburgh', sort: 3 }, { id: 's4', name: 'Shelly Beach', sort: 4 },
      { id: 's5', name: 'Howick', sort: 5 }, { id: 's6', name: 'Vryheid', sort: 6 }, { id: 's7', name: 'Admin', sort: 7 },
    ],
    profiles: [
      { id: 'u-brad', username: 'bradley', name: 'Bradley', role: 'manager',    agent: '',       store_id: null },
      { id: 'u-sim',  username: 'simone',  name: 'Simone',  role: 'consultant', agent: 'SIMONE', store_id: 's4' },
    ],
    bases: [], tracking: [], claims: [], assign: [], settings: [],
  },
};

(async () => {
  const fails = [], errs = [];
  const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails.push(m); };
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => { errs.push(e.message); console.log('  PAGEERROR:', e.message); });
  await p.addInitScript(s => { try { if (!localStorage.getItem('chase-mockdb')) localStorage.setItem('chase-mockdb', JSON.stringify(s)); } catch (e) {} }, SEED);
  await p.goto(SITE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);

  const step = () => p.$eval('#lf', e => [...e.querySelectorAll('[data-step]')].find(s => !s.hidden).dataset.step);
  const vis = sel => p.$eval(sel, e => e.offsetParent !== null).catch(() => false);

  // ---- default look
  ok((await p.evaluate(() => document.documentElement.getAttribute('data-accent'))) === 'blue', 'fresh phone opens in the blue accent');

  // ---- first ever visit: welcome -> business -> store -> who are you -> sign in
  ok((await step()) === 'welcome', 'first visit lands on the welcome screen');
  ok(await vis('[data-go="new"]') && await vis('[data-go="business"]'), 'welcome offers "I\'m new here" and "My business is on Chase"');
  await p.click('[data-go="new"]'); await p.waitForTimeout(200);
  ok((await step()) === 'new' && await p.$eval('[data-step="new"] a', a => /wa\.me/.test(a.href)), '"I\'m new here" explains setup and offers a WhatsApp request');
  await p.click('[data-step="new"] [data-go="welcome"]'); await p.waitForTimeout(150);
  await p.click('[data-go="business"]'); await p.waitForTimeout(300);
  ok((await step()) === 'business' && /Cell-Logic/.test(await p.$eval('#lfBiz', e => e.textContent)), 'business screen shows the yellow Cell-Logic block');
  const tiles = await p.$$eval('#lfStores .lf-store b', els => els.map(e => e.textContent));
  ok(tiles.length === 7 && tiles[3] === 'Shelly Beach', 'all seven stores offered as tiles: ' + tiles.join(', '));
  await p.click('#lfStores [data-store="s4"]'); await p.waitForTimeout(250);
  ok((await step()) === 'who' && /Who are you/.test(await p.$eval('#lfWho', e => e.textContent)), 'no faces yet on this phone → "Who are you?" with a Sign in tile');
  ok(/Shelly Beach/.test(await p.$eval('#lfWhoStore', e => e.textContent)), 'store pill shows Shelly Beach');
  await p.click('#lfElse'); await p.waitForTimeout(250);
  ok((await step()) === 'pass' && await vis('#liU'), 'password step asks for a username the first time');
  await p.fill('#liU', 'simone'); await p.fill('#liP', 'wrong'); await p.click('#liGo'); await p.waitForTimeout(900);
  ok(/wrong|invalid|failed/i.test(await p.$eval('#liErr', e => e.textContent)), 'wrong password refused on the new screen');
  await p.fill('#liP', 'pw-sim'); await p.click('#liGo'); await p.waitForTimeout(1800);
  ok(await p.$eval('#whoami', e => /Simone/.test(e.textContent)), 'Simone signed in');
  const remembered = await p.evaluate(() => JSON.parse(localStorage.getItem('chase-people') || '[]'));
  ok(remembered.length === 1 && remembered[0].u === 'simone' && remembered[0].store === 's4', 'her face is now remembered on this phone');

  // ---- start-here card: no base yet → hidden
  ok(await p.$eval('#startHere', e => e.hidden), 'Start here hidden while the store has no base');

  // ---- manager loads the demo base (via the flow, second time round)
  await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); }); await p.waitForTimeout(500);
  ok((await step()) === 'business', 'second time round the welcome screen is skipped');
  await p.click('#lfStores [data-store="s4"]'); await p.waitForTimeout(250);
  const faces = await p.$$eval('#lfPeople .lf-person b', els => els.map(e => e.textContent));
  ok(faces[0] === 'Simone' && faces[1] === 'Someone else', "who's chasing shows Simone's face + Someone else");
  await p.click('#lfElse'); await p.waitForTimeout(200);
  await p.fill('#liU', 'bradley'); await p.fill('#liP', 'pw-brad'); await p.click('#liGo'); await p.waitForTimeout(1800);
  ok(await p.$eval('#whoami', e => /Bradley/.test(e.textContent)), 'Bradley signed in');
  ok(await p.$eval('#startHere', e => e.hidden), 'Start here never shows for a manager');
  await p.setInputFiles('#fileInp', CSV); await p.waitForTimeout(1500); await p.click('#mOk'); await p.waitForTimeout(2500);

  // ---- Simone again, by tapping her face
  await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); }); await p.waitForTimeout(500);
  await p.click('#lfStores [data-store="s4"]'); await p.waitForTimeout(250);
  const faces2 = await p.$$eval('#lfPeople .lf-person b', els => els.map(e => e.textContent));
  ok(faces2.includes('Bradley') && faces2.includes('Simone'), 'both remembered faces listed: ' + faces2.join(', '));
  await p.click('#lfPeople [data-u="simone"]'); await p.waitForTimeout(250);
  ok((await step()) === 'pass' && !(await vis('#liU')) && /Hi Simone/.test(await p.$eval('#lfHi', e => e.textContent)), 'tapping her face → "Hi Simone", password only');
  await p.fill('#liP', 'pw-sim'); await p.press('#liP', 'Enter'); await p.waitForTimeout(1800);
  ok(await p.$eval('#whoami', e => /Simone/.test(e.textContent)), 'Enter signs her in');

  // ---- start-here card for a consultant with a book
  const sh = await p.$eval('#startHere', e => ({ hidden: e.hidden, text: e.textContent.replace(/\s+/g, ' ') }));
  ok(!sh.hidden && /Start here/.test(sh.text) && /Call/.test(sh.text) && /WhatsApp/.test(sh.text) && /Log the call/.test(sh.text),
     'Start here shows one lead with Call / WhatsApp / Log the call');
  const mine = await p.evaluate(() => DS().customers.filter(c => assignedTo(c) === 'SIMONE').map(c => c.name));
  const lead = await p.$eval('#startHere .sh-name', e => e.textContent);
  ok(mine.some(n => n.toLowerCase() === lead.toLowerCase()), 'the lead is one of her own customers (' + lead + ')');
  ok(/overdue|today|Hottest|value/.test(sh.text), 'and it says why: ' + (sh.text.match(/(Callback overdue[^C]*|Callback promised for today|Hottest lead in your book|Best value still open)/) || [''])[0]);
  await p.click('#startHere [data-sh-log]'); await p.waitForTimeout(400);
  ok(!(await p.$eval('#qsheet', e => e.hidden)) && (await p.$eval('#qsName', e => e.textContent)).toLowerCase() === lead.toLowerCase(), '"Log the call" opens the quick-log for that customer');
  await p.evaluate(() => closeQuick());
  await p.screenshot({ path: SC + '/proof-login-home.png' });

  // ---- "Not you?" removes a face
  await p.evaluate(async () => { await fetch('/api/logout', { method: 'POST' }); showLogin(); }); await p.waitForTimeout(400);
  await p.click('#lfStores [data-store="s4"]'); await p.waitForTimeout(200);
  await p.click('#lfPeople [data-u="bradley"]'); await p.waitForTimeout(200);
  await p.click('#lfForget'); await p.waitForTimeout(200);
  const faces3 = await p.$$eval('#lfPeople .lf-person b', els => els.map(e => e.textContent));
  ok(!faces3.includes('Bradley') && faces3.includes('Simone'), '"Not you?" removes that face from this phone');
  await p.screenshot({ path: SC + '/proof-login-who.png' });

  ok(errs.length === 0, 'no JavaScript errors during the run');
  await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
