/* The SME book: chosen at sign-in or switched at the top; its own base per store; a multi-sheet
   SME export folds into one list; email comes first for a business; the SME template round-trips.
   Run:  python3 supabase/build_site.py --mock && node supabase/test_sme.js */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SC = process.env.CHASE_BUILD_DIR || path.join(ROOT, '.build');
const SITE = 'file://' + path.join(SC, 'site-mock', 'index.html');
const CSV = path.join(SC, 'DEMO-shelly-beach-fake-base.csv');
if (!fs.existsSync(CSV)) execFileSync('python3', [path.join(ROOT, 'supabase', 'make-demo-base.py'), SC]);
const SME_XLSX = path.join(ROOT, 'supabase', 'fixtures', 'sme-sample.xlsx');   // fake businesses, same shape as the real export
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SEED = {
  users: [{ id: 'u-brad', email: 'bradley@chase.local', password: 'pw-brad' },
          { id: 'u-les',  email: 'lesley@chase.local',  password: 'pw-lesley' }],
  tables: {
    stores: [{ id: 's1', name: 'Montrose', sort: 1 }, { id: 's2', name: 'Kokstad', sort: 2 }, { id: 's4', name: 'Shelly Beach', sort: 4 }],
    profiles: [
      { id: 'u-brad', username: 'bradley', name: 'Bradley', role: 'manager',    agent: '',       store_id: null },
      { id: 'u-les',  username: 'lesley',  name: 'Lesley',  role: 'consultant', agent: 'LESLEY', store_id: 's2' },
    ],
    bases: [], tracking: [], claims: [], assign: [], settings: [],
  },
};

(async () => {
  const fails = [], errs = [];
  const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails.push(m); };
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  async function open() {
    const p = await ctx.newPage();
    p.on('pageerror', e => { errs.push(e.message); console.log('  PAGEERROR:', e.message); });
    p.on('dialog', d => d.accept());
    await p.addInitScript(s => { try { if (!localStorage.getItem('chase-mockdb')) localStorage.setItem('chase-mockdb', JSON.stringify(s)); } catch (e) {} }, SEED);
    await p.goto(SITE, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
    return p;
  }
  const db = p => p.evaluate(() => JSON.parse(localStorage.getItem('chase-mockdb')));
  const seg = p => p.evaluate(() => SEG);
  const rows = p => p.$eval('#mRows', e => e.textContent.replace(/\s+/g, ''));
  const order = p => p.$eval('#tbody tr.main .cust .mini', e => [...e.children].map(x => ['em', 'wa', 'tel'].find(k => x.classList.contains(k)) || x.className).join(','));

  const p = await open();
  // ---- sign-in offers the book
  await p.evaluate(() => lfGo('pass', { store: 's2', someoneElse: true })); await p.waitForTimeout(150);
  ok(await p.$eval('#lfSeg', e => e.offsetParent !== null && e.querySelectorAll('button').length === 2), 'password step offers Consumer / SME');
  await p.click('#lfSeg [data-seg="sme"]');
  await p.fill('#liU', 'bradley'); await p.fill('#liP', 'pw-brad'); await p.click('#liGo'); await p.waitForTimeout(1500);
  ok((await seg(p)) === 'sme' && await p.$eval('body', b => b.classList.contains('sme')), 'signed straight into the SME book');
  ok(await p.$eval('#segSw [data-seg="sme"]', b => b.getAttribute('aria-pressed') === 'true' && b.offsetParent !== null), 'the switch at the top shows SME');
  ok(await p.evaluate(() => (JSON.parse(localStorage.getItem('chase-people'))[0] || {}).seg === 'sme'), 'the choice is remembered with the face');

  // ---- load the multi-sheet SME export into Kokstad
  await p.setInputFiles('#fileInp', SME_XLSX); await p.waitForTimeout(1500);
  let r = await rows(p);
  ok(/LoadingintoSMEbook/.test(r), 'preview says it is loading into the SME book');
  ok(/Accounts7(?!\d)/.test(r), 'three sheets folded into one list: 7 businesses (' + (r.match(/Accounts(\d+)/) || [])[1] + ')');
  ok(/2extralinecolumns/.test(r), 'MSISDN 2 and 3 recognised as extra lines');
  ok(await p.$eval('#mNote', e => e.hidden), 'no wrong-book warning in the SME book');
  ok(await p.$eval('#mAlloc', e => !e.hidden) && await p.$eval('#mAllocSel', e => [...e.options].some(o => o.value === 'LESLEY')), 'no CSR column → "Allocate every row to" offers Lesley');
  await p.selectOption('#mAllocSel', 'LESLEY');
  ok(!(await p.$eval('#mOk', e => e.disabled)), 'ready to add (business name + number is enough)');
  await p.click('#mOk'); await p.waitForTimeout(2500);
  const d1 = await db(p);
  const smeBase = d1.tables.bases.find(b => b.segment === 'sme');
  ok(smeBase && smeBase.store_id === 's2' && smeBase.active && smeBase.rows.length === 7, 'SME base saved for Kokstad, flagged sme, 7 rows');
  ok(smeBase.rows.every(x => x[0] === 'LESLEY'), 'every business allocated to Lesley');
  const tk = smeBase.rows.find(x => x[1] === 'Tyre King');
  ok(tk && tk[3] === 'SME:27830000030' && tk[4] === '0830000030' && tk[14] === '27830000031|27830000032' && tk[13] === 'mark@tyreking.example' && /3 lines/.test(tk[7]),
     'Tyre King: SME account id from its main number, 2 extra lines, email, "3 lines"');
  ok(await p.evaluate(() => DS().customers.length === 7 && DS().customers.find(c => c.name === 'Tyre King').lines.length === 2), 'the book shows 7 businesses with their lines');
  ok((await order(p)) === 'em,wa,tel', 'SME row: email button first, then WhatsApp, then call (' + (await order(p)) + ')');
  ok(await p.$$eval('#tbody tr.main .cust small', els => els.some(e => /3 lines/.test(e.textContent))), 'a row shows "3 lines" for the three-line business');
  const tkRow = await p.$$eval('#tbody tr.main', els => els.findIndex(e => /Tyre King/.test(e.textContent)));
  await p.click(`#tbody tr.main:nth-of-type(${tkRow + 1}) .qzap`).catch(async () => { await p.evaluate(a => openQuick(a), 'SME:27830000030'); }); await p.waitForTimeout(400);
  ok(await p.$eval('#qsContact .contact', e => [...e.children].map(x => ['em', 'wa', 'tel'].find(k => x.classList.contains(k)) || x.className).join(',') === 'em,wa,tel'), 'quick-log sheet: email first too');
  ok(await p.$eval('#qsContact .contact a.wa', a => /wa\.me\/27830000030\?/.test(a.href)), 'WhatsApp link dials 27… for a number typed as 083…');
  ok(await p.$eval('#qsheet', e => e.querySelectorAll('.lines a').length >= 1), 'quick-log lists the other lines as tap-to-call');
  await p.evaluate(() => closeQuick());

  // ---- switch to Consumer: empty, then load the consumer base; SME untouched
  await p.click('#segSw [data-seg="consumer"]'); await p.waitForTimeout(1200);
  ok((await seg(p)) === 'consumer' && await p.evaluate(() => DS().customers.length === 0), 'Consumer book for Kokstad is still empty');
  await p.setInputFiles('#fileInp', CSV); await p.waitForTimeout(1500);
  r = await rows(p);
  ok(/LoadingintoConsumerbook/.test(r) && /Accounts56/.test(r), 'consumer base previews into the Consumer book');
  ok(await p.$eval('#mNote', e => e.hidden), 'a consumer file in the consumer book: no warning');
  ok(await p.$eval('#mAlloc', e => e.hidden), 'file has a CSR column → no allocate row');
  await p.click('#mOk'); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => DS().customers.length === 56), '56 consumer accounts in the Consumer book');
  ok((await order(p)) === 'tel,wa,em', 'consumer row keeps call, WhatsApp, email order');
  const d2 = await db(p);
  ok(d2.tables.bases.filter(b => b.active && b.store_id === 's2').length === 2, 'Kokstad now has two active bases — one per book');
  await p.click('#segSw [data-seg="sme"]'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => DS().customers.length === 7), 'back in SME: the 7 businesses are still there');

  // ---- wrong book detection
  await p.click('#segSw [data-seg="consumer"]'); await p.waitForTimeout(1000);
  await p.setInputFiles('#fileInp', SME_XLSX); await p.waitForTimeout(1500);
  ok(await p.$eval('#mNote', e => !e.hidden && /looks like an SME list/.test(e.textContent)), 'SME file in the Consumer book → warning');
  await p.click('#mSwitchBook'); await p.waitForTimeout(2500);
  ok((await seg(p)) === 'sme' && await p.$eval('#modal', e => e.classList.contains('show')) && /LoadingintoSMEbook/.test(await rows(p)), 'one tap switches to SME and re-opens the preview there');
  await p.click('#mCancel'); await p.waitForTimeout(300);

  // ---- the SME template
  await p.evaluate(() => navTo('template')); await p.waitForTimeout(500);
  const [xl] = await Promise.all([p.waitForEvent('download'), p.click('#tplXlsxSme')]);
  ok(xl.suggestedFilename() === 'Chase-SME-base-template.xlsx', 'SME Excel template downloads');
  const xlPath = path.join(SC, 'sme-template.xlsx'); await xl.saveAs(xlPath);
  await p.setInputFiles('#fileInp', xlPath); await p.waitForTimeout(1500);
  r = await rows(p);
  ok(/Accounts0(?!\d)/.test(r) && await p.$eval('#mOk', e => e.disabled), 'template reads back; the example business is ignored');
  ok(await p.$eval('#mMap', e => /MSISDN 1/.test(e.textContent) && /Other numbers/.test(e.textContent) && /1 column \(MSISDN 2\+\)/.test(e.textContent)), 'column check shows the SME fields; only the filled-in extra line column counts');
  await p.click('#mCancel'); await p.waitForTimeout(300);
  const [cv] = await Promise.all([p.waitForEvent('download'), p.click('#tplDlSme')]);
  ok(cv.suggestedFilename() === 'Chase-SME-base-template.csv', 'SME csv template downloads');

  // ---- the email button opens the email sheet (no silent mailto:)
  await p.click('#segSw [data-seg="sme"]'); await p.waitForTimeout(1000);
  await p.evaluate(() => navTo('book')); await p.waitForTimeout(400);
  const tkIdx = await p.$$eval('#tbody tr.main', els => els.findIndex(e => /Tyre King/.test(e.textContent)));
  await p.click(`#tbody tr.main:nth-of-type(${tkIdx + 1}) .cust .mini .em`); await p.waitForTimeout(400);
  ok(await p.$eval('#mailModal', e => e.classList.contains('show')), 'clicking the email icon opens the email sheet');
  const mail = await p.evaluate(() => ({ to: $('#mailTo').value, su: $('#mailSubj').value, body: $('#mailBody').value }));
  ok(mail.to === 'mark@tyreking.example', 'To is the business email');
  ok(/Kokstad/.test(mail.su) && /Good day Tyre King/.test(mail.body) && /Bradley/.test(mail.body) && /Tyre King's account/.test(mail.body),
     'subject and message written from the default template with the business, store and agent filled in');
  ok(await p.$eval('#mailGmail', e => e.offsetParent !== null) && await p.$eval('#mailOutlook', e => e.offsetParent !== null) && await p.$eval('#mailApp', e => e.offsetParent !== null) && await p.$eval('#mailCopy', e => e.offsetParent !== null),
     'offers Gmail, Outlook, the device mail app, or copy');
  await ctx.route('https://mail.google.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: 'gmail' }));
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#mailGmail')]);
  await pop.waitForURL(/mail\.google\.com/, { timeout: 5000 }).catch(() => {});
  ok(/mail\.google\.com\/mail\/\?view=cm/.test(pop.url()) && /to=mark%40tyreking\.example/.test(pop.url()), 'Gmail opens a compose window with the address filled in (' + pop.url().slice(0, 60) + ')');
  await pop.close(); await p.waitForTimeout(400);
  ok(await p.evaluate(() => (tracking['SME:27830000030'] || {}).st === 'fu' && ((tracking['SME:27830000030'] || {}).acts || []).some(a => a.k === 'em' || a.t === 'em' || JSON.stringify(a).includes('em'))), 'sending logs "emailed" and moves the business to follow-up');
  await p.click('#mailClose'); await p.waitForTimeout(200);

  // ---- email templates per store
  await p.evaluate(() => navTo('email')); await p.waitForTimeout(800);
  ok(!!(await p.$('#sidenav .sn-item[data-nav="email"]')) && await p.$eval('#emailCard', e => !e.hidden), '"Email templates" is in the manager menu, under Message & quotes');
  const eblocks = await p.$$eval('#emailBody .smsg', els => els.map(e => e.querySelector('b').textContent));
  ok(eblocks.length === 3 && eblocks.includes('Kokstad'), 'head office sees every store (' + eblocks.join(', ') + ')');
  await p.fill('#emailBody [data-etpl-subj="s2"]', 'Kokstad business offer for {business}');
  await p.fill('#emailBody [data-etpl-box="s2"]', 'Hello {name}, {agent} here from Kokstad.');
  await p.click('#emailBody [data-etpl-save="s2"]'); await p.waitForTimeout(1200);
  const st = (await db(p)).tables.stores.find(x => x.id === 's2');
  ok(/Kokstad business offer/.test(st.email_subj) && /Hello \{name\}/.test(st.email_tpl) && st.email_tpl_by === 'Bradley', 'Kokstad email template saved with Bradley as the changer');
  ok(await p.$eval('#emailBody [data-etpl="s2"] .pill', e => /Changed by Bradley/.test(e.textContent)), 'pill shows who changed it');
  await p.evaluate(() => navTo('book')); await p.waitForTimeout(400);
  await p.click(`#tbody tr.main:nth-of-type(${tkIdx + 1}) .cust .mini .em`); await p.waitForTimeout(400);
  ok(await p.evaluate(() => $('#mailSubj').value === 'Kokstad business offer for Tyre King' && $('#mailBody').value === 'Hello Tyre King, Bradley here from Kokstad.'), 'the email button now writes from the saved Kokstad template');
  await p.click('#mailClose'); await p.waitForTimeout(200);

  // ---- walk-in lands in the SME base
  await p.evaluate(() => navTo('book')); await p.waitForTimeout(300);
  await p.evaluate(async () => { await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Walk-in Traders', msisdn: '0830009999', email: 'hello@walkin.example' }) }); });
  await p.waitForTimeout(600);
  const d3 = await db(p);
  const sme2 = d3.tables.bases.find(b => b.segment === 'sme' && b.active);
  ok(sme2.rows.length === 8 && sme2.rows[7][11] === 'SME', 'a walk-in added while in SME goes into the SME base, tagged SME');
  ok(d3.tables.bases.find(b => b.segment === 'consumer' && b.active).rows.length === 56, 'the consumer base was not touched');

  // ---- Lesley signs in as SME on her phone and sees her businesses
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => { errs.push(e.message); });
  await p2.goto(SITE, { waitUntil: 'domcontentloaded' }); await p2.waitForTimeout(900);
  await p2.evaluate(() => lfGo('pass', { store: 's2', someoneElse: true })); await p2.waitForTimeout(150);
  await p2.click('#lfSeg [data-seg="sme"]'); await p2.fill('#liU', 'lesley'); await p2.fill('#liP', 'pw-lesley'); await p2.click('#liGo'); await p2.waitForTimeout(1500);
  ok(await p2.evaluate(() => SEG === 'sme' && DS().customers.filter(c => assignedTo(c) === 'LESLEY').length === 7), 'Lesley in the SME book sees her 7 businesses');
  ok(await p2.$eval('#segSw', e => e.offsetParent !== null), 'a consultant can switch books too');
  await p2.close();

  ok(errs.length === 0, 'no JavaScript errors during the run');
  await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + fails.length : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
