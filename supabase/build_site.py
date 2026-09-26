#!/usr/bin/env python3
"""Build the deployable Chase site: the tested app + supabase-js + the adapter,
all inlined into one self-contained index.html, plus the PWA files.

  python3 supabase/build_site.py            -> real build into ./site/
  python3 supabase/build_site.py --mock     -> test build with a fake Supabase, into ./.build/site-mock/
                                               (or $CHASE_BUILD_DIR if set)

Everything the build needs is in the repo: supabase-js is vendored under
supabase/vendor/, so no network and no node_modules are required.
"""
import sys, shutil, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP  = os.path.join(ROOT, 'shelly-app', 'public')
OUT  = os.path.join(ROOT, 'site')
SBJS = os.path.join(ROOT, 'supabase', 'vendor', 'supabase-js.umd.js')

SB_URL = 'https://dzmqogwggompkwasiglq.supabase.co'
SB_KEY = 'sb_publishable_fu6yXakyx-Egk6Jcb_9BMg_cwh2dZTX'   # publishable: safe in the page, RLS does the guarding

mock = '--mock' in sys.argv
if mock:
    OUT = os.path.join(os.environ.get('CHASE_BUILD_DIR') or os.path.join(ROOT, '.build'), 'site-mock')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

app = read(os.path.join(APP, 'index.html'))
adapter = read(os.path.join(ROOT, 'supabase', 'chase-supabase.js'))
adapter = adapter.replace('__SB_URL__', SB_URL).replace('__SB_KEY__', SB_KEY)

if mock:
    lib = read(os.path.join(ROOT, 'supabase', 'mock-supabase.js'))
    lib_note = '/* MOCK Supabase — test builds only */'
else:
    lib = read(SBJS)
    lib_note = '/* supabase-js v2 (bundled: no CDN dependency) */'

# the app's own <script> starts with this banner; inject ahead of it
anchor = "<script>\n/* ========================================================="
assert anchor in app, 'could not find the app script anchor'

inject = (
    '<script>' + lib_note + '\n' + lib.rstrip('\n') + '\n</script>\n'
    '<script>\n' + adapter + '\n</script>\n'
)
site = app.replace(anchor, inject + anchor, 1)

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(site)

# PWA companions + the Cloudflare security headers file
for name in ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png',
             'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png', '_headers']:
    src = os.path.join(APP, name)
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(OUT, name))

print(('MOCK ' if mock else '') + 'build -> ' + os.path.join(OUT, 'index.html') + '  (%s KB)' % (len(site) // 1024))
