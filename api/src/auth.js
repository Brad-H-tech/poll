/* Chase API — who is calling?
   Two kinds of caller, one shape of answer (an "actor"):

   1. API key   Authorization: Bearer chk_<id>.<secret>   (or X-Api-Key)
      For other systems: a spreadsheet, a WhatsApp bot, a reporting tool.
      Checked and metered in ONE database round trip (api.authenticate).
      The secret is hashed here; the database only ever sees the hash.

   2. Supabase user token   Authorization: Bearer <jwt>
      For the Chase app itself. The token is verified by Supabase Auth and the
      profile is read UNDER THAT TOKEN, so row-level security decides what the
      person may see. Rights follow the role: consultants read+write, managers
      also manage. */
import { HttpError, sha256Hex, timingSafeEqual } from './security.js';

const KEY_RE = /^chk_([0-9a-f]{32})\.([A-Za-z0-9_-]{40,60})$/;
const uuidFromHex = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

/** a stable id for rate limiting BEFORE any database work: the key id is in the token itself */
export function callerHint(request) {
  const m = KEY_RE.exec(bearer(request));
  return m ? 'key:' + uuidFromHex(m[1]) : null;
}

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (m) return m[1].trim();
  const k = request.headers.get('X-Api-Key');
  return k ? k.trim() : '';
}

/** returns an actor or throws HttpError(401/429/503).
    `allowUserToken` is true only for the few routes the Chase app itself calls (see routes.js);
    everything else is API keys only, to keep the attack surface small. */
export async function authenticate(request, env, db, isWrite, allowUserToken) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'unauthenticated', 'Send an API key: Authorization: Bearer chk_…');

  const m = KEY_RE.exec(token);
  if (m) return keyActor(m[1], m[2], env, db, isWrite);
  if (token.split('.').length === 3) {
    if (!allowUserToken) throw new HttpError(401, 'keys_only', 'This endpoint accepts API keys only, not user logins');
    return userActor(token, db);
  }
  throw new HttpError(401, 'unauthenticated', 'That does not look like a Chase API key');
}

async function keyActor(idHex, secret, env, db, isWrite) {
  const hash = await sha256Hex(secret);
  const r = await db.rpc('authenticate', { p_key_id: uuidFromHex(idHex), p_hash: hash, p_write: !!isWrite });
  if (!r || typeof r !== 'object') throw new HttpError(502, 'upstream', 'Key check failed');
  // the database compared the hash; compare again here so a tampered reply can't say "ok" for a wrong key
  if (r.reason === 'bad_key' || (r.key && r.key_hash && !timingSafeEqual(r.key_hash, hash)))
    throw new HttpError(401, 'unauthenticated', 'Unknown or wrong API key');
  if (r.reason === 'revoked') throw new HttpError(401, 'revoked', 'This API key has been revoked');
  if (r.reason === 'expired') throw new HttpError(401, 'expired', 'This API key has expired');
  const cap = Number(env.CHASE_DAILY_CAP || 0);
  if (cap && Number(r.total_today) > cap)
    throw new HttpError(503, 'budget', 'The API has reached its daily budget for all keys; try again tomorrow', { retryAfter: 3600 });
  if (r.reason === 'daily_limit' || r.ok === false)
    throw new HttpError(429, 'daily_limit', `This key has used its ${r.key.daily_limit} calls for today`, { retryAfter: 3600 });
  return {
    type: 'key', id: 'key:' + r.key.id, key_id: r.key.id, name: r.key.name,
    store_id: r.key.store_id || null, scopes: new Set(r.key.scopes || []), agent: '',
    calls_today: r.calls_today, daily_limit: r.key.daily_limit,
  };
}

async function userActor(jwt, db) {
  let user;
  try { user = await db.userFromJwt(jwt); }
  catch (e) { throw new HttpError(401, 'unauthenticated', 'User token is invalid or expired'); }
  if (!user || !user.id) throw new HttpError(401, 'unauthenticated', 'User token is invalid or expired');
  let rows = [];
  try { rows = await db.profileFromJwt(jwt, user.id); } catch (e) { rows = []; }
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new HttpError(403, 'no_profile', 'This login has no Chase profile yet — ask a manager');
  const scopes = p.role === 'manager' ? ['read', 'write', 'manage'] : ['read', 'write'];
  return {
    type: 'user', id: 'user:' + p.id, key_id: null, name: p.name || p.username,
    store_id: p.store_id || null, scopes: new Set(scopes), agent: p.agent || '', role: p.role,
  };
}
