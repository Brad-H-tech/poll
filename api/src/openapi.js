/* Chase API — OpenAPI 3.1 document and the docs page, both generated from ROUTES. */
import { ROUTES, VERSION } from './routes.js';

const scopeText = { read: 'read', write: 'write', manage: 'manage' };

export function openapi(origin) {
  const paths = {};
  for (const r of ROUTES) {
    const p = paths[r.path.replace(/:(\w+)/g, '{$1}')] ||= {};
    const op = {
      tags: [r.tag || 'Other'], summary: r.summary,
      description: [r.description, r.auth === false ? 'No authentication.' : `Needs the **${scopeText[r.scope]}** scope.`,
        r.store === 'required' ? 'Store-scoped: a head-office key must say which store (`?store=s1`).' : ''].filter(Boolean).join(' '),
      security: r.auth === false ? [] : [{ bearerAuth: [] }],
      parameters: [
        ...r.keys.map(k => ({ name: k, in: 'path', required: true, schema: { type: 'string' } })),
        ...(r.params || []).map(q => ({ name: q.name, in: 'query', required: false, description: q.description,
          schema: { type: typeof q.example === 'number' ? 'integer' : 'string' }, example: q.example })),
      ],
      responses: {
        '200': { description: 'OK', content: { 'application/json': { example: r.example === undefined ? { ok: true } : r.example } } },
        '400': { $ref: '#/components/responses/Error' }, '401': { $ref: '#/components/responses/Error' },
        '403': { $ref: '#/components/responses/Error' }, '429': { $ref: '#/components/responses/RateLimited' },
      },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { example: r.body } } };
    p[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Chase API', version: VERSION,
      description: 'The Chase CRM data, for other systems: spreadsheets, bots, reporting tools and the Chase app itself. '
        + 'Every call is authenticated, scoped to a store, rate-limited and metered against a daily budget.',
    },
    servers: [{ url: origin || 'https://chase-api.example.workers.dev' }],
    tags: [...new Set(ROUTES.map(r => r.tag || 'Other'))].map(name => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer',
          description: 'Either a Chase API key (`chk_<id>.<secret>`, also accepted as `X-Api-Key`) or a Supabase user token from the Chase app.' },
      },
      responses: {
        Error: { description: 'Problem', content: { 'application/json': { example: { error: { code: 'invalid', message: 'outcome must be one of: fu, cb, …', request_id: 'a1b2c3d4e5f60718' } } } } },
        RateLimited: { description: 'Slow down / budget used', headers: { 'Retry-After': { schema: { type: 'integer' } } },
          content: { 'application/json': { example: { error: { code: 'rate_limited', message: 'Too many requests', request_id: '…' } } } } },
      },
    },
  };
}

/* ---- the human page: server-rendered, no scripts, no external assets ---- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function docsHtml(origin) {
  const base = origin || 'https://chase-api.example.workers.dev';
  const groups = new Map();
  for (const r of ROUTES) { const g = groups.get(r.tag || 'Other') || []; g.push(r); groups.set(r.tag || 'Other', g); }
  const curl = r => {
    const path = r.path.replace(/:(\w+)/g, (_, k) => k === 'acct' ? 'SB10251' : '00000000-0000-4000-8000-000000000000');
    const store = r.store === 'required' ? '?store=s1' : '';
    const lines = [`curl -s ${r.method !== 'GET' ? '-X ' + r.method + ' ' : ''}"${base}${path}${store}"`];
    if (r.auth !== false) lines.push(`  -H "Authorization: Bearer $CHASE_KEY"`);
    if (r.body) lines.push(`  -H "Content-Type: application/json"`, `  -d '${JSON.stringify(r.body)}'`);
    return lines.join(' \\\n');
  };
  const section = ([tag, rs]) => `
  <section><h2 id="${esc(tag.toLowerCase())}">${esc(tag)}</h2>
  ${rs.map(r => `
    <article>
      <h3><code class="m ${r.method.toLowerCase()}">${r.method}</code> <code>${esc(r.path)}</code></h3>
      <p>${esc(r.summary)}${r.description ? ' ' + esc(r.description) : ''}</p>
      <p class="meta">${r.auth === false ? 'No key needed' : 'Scope: <b>' + esc(r.scope) + '</b>'}${r.store === 'required' ? ' · store-scoped' : ''}${r.maxBody > 262144 ? ' · body up to ' + Math.round(r.maxBody / 1048576) + ' MB' : ''}</p>
      ${(r.params || []).length ? `<table><tr><th>Query</th><th>Meaning</th><th>Example</th></tr>${r.params.map(q => `<tr><td><code>${esc(q.name)}</code></td><td>${esc(q.description)}</td><td><code>${esc(q.example)}</code></td></tr>`).join('')}</table>` : ''}
      ${r.body ? `<details><summary>Request body</summary><pre>${esc(JSON.stringify(r.body, null, 2))}</pre></details>` : ''}
      ${r.example !== undefined ? `<details><summary>Example reply</summary><pre>${esc(JSON.stringify(r.example, null, 2))}</pre></details>` : ''}
      <details><summary>Try it (curl)</summary><pre>${esc(curl(r))}</pre></details>
    </article>`).join('')}
  </section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chase API v${VERSION}</title>
<style>
:root{--ink:#14202b;--ink2:#4c5b68;--line:#dfe5ea;--bg:#f7f9fb;--card:#fff;--get:#0b7a5b;--post:#1f5fbf;--put:#a35d00;--del:#b32d2e}
@media(prefers-color-scheme:dark){:root{--ink:#e8eef3;--ink2:#a4b1bd;--line:#2b3440;--bg:#0f151b;--card:#161e26;--get:#4dd4a8;--post:#7fb0ff;--put:#ffb85c;--del:#ff8a8a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:36px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;margin:0 0 6px;word-break:break-all}article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
p{margin:6px 0}.meta{color:var(--ink2);font-size:13px}code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.12);padding:1px 5px;border-radius:5px}
code.m{font-weight:700;color:#fff}code.get{background:var(--get)}code.post{background:var(--post)}code.put{background:var(--put)}code.delete{background:var(--del)}
pre{overflow:auto;background:rgba(127,127,127,.1);padding:10px 12px;border-radius:8px;font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0 0}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink2);font-weight:600}
details{margin-top:6px}summary{cursor:pointer;color:var(--ink2);font-size:13px}nav a{margin-right:12px;color:inherit}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:16px 0}
</style></head><body><main>
<h1>Chase API <small style="color:var(--ink2);font-weight:400">v${VERSION}</small></h1>
<p class="meta">Base URL <code>${esc(base)}</code> · machine-readable spec at <a href="${esc(base)}/v1/openapi.json">/v1/openapi.json</a></p>
<nav>${[...groups.keys()].map(t => `<a href="#${esc(t.toLowerCase())}">${esc(t)}</a>`).join('')}</nav>
<div class="box"><b>How to call it.</b> Send your key in every request: <code>Authorization: Bearer chk_…</code>. A key belongs to one store (or to head office),
has scopes (<b>read</b> sees, <b>write</b> logs outcomes and activities, <b>manage</b> does manager things) and a daily call budget.
Replies are JSON. Problems come back as <code>{"error":{"code","message","request_id"}}</code> with the right HTTP status
(400 bad input · 401 no/bad key · 403 not allowed · 404 not found · 409 conflict · 413 too big · 422 database refused · 429 slow down or budget used).</div>
${[...groups.entries()].map(section).join('')}
</main></body></html>`;
}
