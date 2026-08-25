#!/usr/bin/env python3
"""Build the deployable Chase site: the tested app + supabase-js + the adapter,
all inlined into one self-contained index.html, plus the PWA files.

  python3 build_site.py            -> real build into /home/user/poll/site/
  python3 build_site.py --mock     -> test build using a fake Supabase, into scratchpad
"""
import sys, shutil, os, json

SC = '/tmp/claude-0/-home-user-poll/9568d26a-bb99-556f-bb65-a5bb50270263/scratchpad'
APP = '/home/user/poll/shelly-app/public'
OUT = '/home/user/poll/site'
SBJS = SC + '/sbjs/node_modules/@supabase/supabase-js/dist/umd/supabase.js'

SB_URL = 'https://dzmqogwggompkwasiglq.supabase.co'
SB_KEY = 'sb_publishable_fu6yXakyx-Egk6Jcb_9BMg_cwh2dZTX'

mock = '--mock' in sys.argv
if mock:
    OUT = SC + '/site-mock'

app = open(APP + '/index.html', encoding='utf-8').read()
adapter = open('/home/user/poll/supabase/chase-supabase.js', encoding='utf-8').read()
adapter = adapter.replace('__SB_URL__', SB_URL).replace('__SB_KEY__', SB_KEY)

if mock:
    lib = open('/home/user/poll/supabase/mock-supabase.js', encoding='utf-8').read()
    lib_note = '/* MOCK Supabase — test builds only */'
else:
    lib = open(SBJS, encoding='utf-8').read()
    lib_note = '/* supabase-js v2 (bundled: no CDN dependency) */'

# the app's own <script> starts with this banner; inject ahead of it
anchor = "<script>\n/* ========================================================="
assert anchor in app, 'could not find the app script anchor'

inject = (
    '<script>' + lib_note + '\n' + lib + '\n</script>\n'
    '<script>\n' + adapter + '\n</script>\n'
)
site = app.replace(anchor, inject + anchor, 1)

os.makedirs(OUT, exist_ok=True)
open(OUT + '/index.html', 'w', encoding='utf-8').write(site)

# PWA companions
for f in ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png',
          'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png']:
    src = os.path.join(APP, f)
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(OUT, f))

print(('MOCK ' if mock else '') + 'build -> ' + OUT + '/index.html  (%s KB)' % (len(site) // 1024))
