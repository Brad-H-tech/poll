#!/usr/bin/env python3
"""Build a pretend store base so the app can be driven with data that looks
real, without touching a live customer list.

  python3 supabase/make-demo-base.py            -> DEMO-shelly-beach-fake-base.csv here
  python3 supabase/make-demo-base.py /some/dir  -> written into that folder

Column names are the ones the Chase importer already recognises. Two thirds
of the accounts are tagged to consultants; the rest sit in the unassigned
pool so splits and claims have something to work on. Ten are pre-worked so
the tracker is not a wall of grey on day one."""
import csv, os, random, sys

random.seed(11)

FIRST = ['Thabo','Nomsa','Riaan','Ayesha','Sipho','Lerato','Devan','Kirsten','Mandla','Chantel',
         'Yusuf','Zanele','Pieter','Nadia','Bongani','Michelle','Ravi','Precious','Johan','Amahle',
         'Fatima','Sizwe','Elmarie','Kabelo','Shaun','Nokuthula','Priya','Andre','Thandiwe','Wesley',
         'Rethabile','Gerhard','Naledi','Imraan','Charmaine','Tebogo','Dylan','Zinhle','Marius','Aisha',
         'Katlego','Denise','Vusi','Renee','Siyabonga','Tarryn','Hendrik','Palesa','Craig','Nosipho']
LAST  = ['Mkhize','Naidoo','Botha','Dlamini','Pillay','Nkosi','van Wyk','Moodley','Zulu','Fourie',
         'Khumalo','Govender','Steyn','Mahomed','Ndlovu','Smit','Reddy','Mthembu','du Plessis','Cele',
         'Adams','Sithole','Coetzee','Molefe','Petersen','Buthelezi','Singh','Nel','Mabaso','Jacobs']

PACKAGES = ['MTN Sky VIP 5GB','MTN Made For Me M','MTN Sky S','MTN Made For Business 2GB',
            'MTN Sky M','MTN Made For Me L','MTN Sky VIP 10GB','MTN Made For Me S']
DEVICES  = [('Samsung Galaxy A55 128GB',7499),('Apple iPhone 15 128GB',18999),
            ('Samsung Galaxy S24 256GB',21999),('Huawei nova 12 SE',6499),
            ('Apple iPhone 14 128GB',14999),('Samsung Galaxy A35 128GB',5999),
            ('Oppo Reno11 F 5G',7999),('Xiaomi Redmi Note 13',4499),
            ('Apple iPhone 15 Pro 256GB',27999),('Samsung Galaxy Z Flip5',24999)]
CTYPE    = ['Upgrade','Upgrade','Upgrade','New','Migration']
CATEGORY = ['Consumer','Consumer','Consumer','Business']

AGENTS = ['SIMONE'] * 24 + ['THANDO'] * 18 + [''] * 14
random.shuffle(AGENTS)

SEEDED = {
    3:  ('Callback booked',  '2026-08-27', 'Wants to compare the A55 against the iPhone 14.'),
    7:  ('Quote sent',       '2026-08-26', 'Sent pricing on WhatsApp, waiting on wife.'),
    11: ('Successful - Won', '',           'Took the S24 on Sky M. Collected in store.'),
    16: ('No answer',        '2026-08-26', 'Rang twice, straight to voicemail.'),
    22: ('Coming to store',  '2026-08-28', 'Saturday morning, bringing trade-in.'),
    29: ('Not interested',   '',           'Says contract runs to March, call back then.'),
    34: ('Contacted',        '2026-08-29', 'Interested but wants a bigger data bundle.'),
    41: ('Already upgraded', '',           'Did it online last month.'),
    47: ('Wrong number',     '',           'Number belongs to a school, not the customer.'),
    52: ('Callback booked',  '2026-08-30', 'Asked for a call after 5pm.'),
}

HEAD = ['CSR','CustomerName','CustomerSurname','AccountNumber','PrimaryMSISDN','Package',
        'ActivationDate','ProductDescription','HandsetRSP','ContractType','InvoiceStatus',
        'CustomerCategory','Offer','Email','Outcome','NextActionDate','CallNotes']

rows, used = [], set()
for i in range(len(AGENTS)):
    while True:
        nm = (random.choice(FIRST), random.choice(LAST))
        if nm not in used:
            used.add(nm); break
    first, last = nm
    dev, rsp = random.choice(DEVICES)
    out, nxt, note = SEEDED.get(i, ('', '', ''))
    status = 'Out of Contract' if random.random() < 0.72 else 'In Contract'
    rows.append([
        AGENTS[i], first, last, 'SB%05d' % (10230 + i * 7),
        '27%d%07d' % (random.choice([82, 83, 71, 63, 76]), random.randint(1000000, 9999999)),
        random.choice(PACKAGES),
        '%04d-%02d-%02d' % (random.choice([2022, 2023, 2023, 2024]), random.randint(1, 12), random.randint(1, 28)),
        dev, rsp, random.choice(CTYPE), status, random.choice(CATEGORY),
        'R%d once-off + R%d pm' % (random.randint(0, 1500), random.randint(199, 899)),
        '%s.%s@example.co.za' % (first.lower(), last.lower().replace(' ', '')),
        out, nxt, note,
    ])

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
out_path = os.path.join(out_dir, 'DEMO-shelly-beach-fake-base.csv')
with open(out_path, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(HEAD)
    w.writerows(rows)

from collections import Counter
print('wrote', len(rows), 'pretend customers ->', out_path)
for k, v in Counter(r[0] or '(unassigned)' for r in rows).most_common():
    print('  %-14s %d' % (k, v))
print('  pre-worked outcomes:', len(SEEDED))
