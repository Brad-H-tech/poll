-- ============================================================
--  Chase API — database side
--  Run ONCE in Supabase -> SQL Editor -> New query -> Run, AFTER the
--  five-table schema (supabase/schema.sql or migrations/2026-09-26_simplify.sql).
--  Safe to re-run.
--
--  Everything the API needs lives in its own schema, `api`, so the five
--  Chase tables in `public` stay exactly five:
--
--    api.keys    who may call the API, with what rights and what daily budget
--    api.usage   how many calls each key made per day  (the "credits" meter)
--    api.audit   who changed what, when, from where
--    api.*()     the operations, as SQL functions: the worker calls these, so the
--                heavy lifting (searching a 50 000-row base, counting KPIs) happens
--                inside Postgres and only the small answer travels over the wire.
--
--  ONE manual step: Supabase -> Project Settings -> Data API -> "Exposed schemas"
--  -> add `api`. Without it the worker's calls to this schema return 404.
--
--  Nobody but the worker (service role) can touch this schema: the anonymous
--  and signed-in roles get no USAGE on it at all.
-- ============================================================

create schema if not exists api;
revoke all on schema api from public, anon, authenticated;
grant usage on schema api to service_role;

-- ---------- tables ----------

create table if not exists api.keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  key_hash     text not null unique,                     -- sha-256 of the secret; the secret itself is never stored
  store_id     text references public.stores(id) on delete cascade,   -- null = head office: every store
  scopes       text[] not null default '{read}' check (scopes <@ array['read', 'write', 'manage']),
  daily_limit  int  not null default 2000 check (daily_limit between 1 and 1000000),
  active       boolean not null default true,
  expires_at   timestamptz,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists api.usage (
  key_id  uuid not null references api.keys(id) on delete cascade,
  day     date not null,
  calls   int  not null default 0,
  writes  int  not null default 0,
  denied  int  not null default 0,
  primary key (key_id, day)
);

create table if not exists api.audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  key_id   uuid,
  actor    text not null default '',
  method   text not null,
  path     text not null,
  store_id text,
  status   int  not null,
  ms       int  not null default 0,
  ip       text not null default '',
  detail   text not null default '' check (char_length(detail) <= 400)
);
create index if not exists audit_at_idx on api.audit (at desc);

-- belt and braces: RLS on, no policies -> only the service role (which bypasses RLS) can read
alter table api.keys  enable row level security;
alter table api.usage enable row level security;
alter table api.audit enable row level security;
grant all on all tables in schema api to service_role;

-- ---------- keys & metering ----------

-- Mint a key. Returns the full secret ONCE; only its hash is kept.
-- From the SQL editor:  select * from api.mint_key('Excel report', null, '{read}', 500, 365, 'bradley');
create or replace function api.mint_key(
  p_name text, p_store text default null, p_scopes text[] default '{read}',
  p_daily_limit int default 2000, p_expires_days int default 365, p_created_by text default 'sql')
returns table (id uuid, key text)
language plpgsql security definer set search_path = api, public, extensions as $$
declare v_secret text; v_id uuid;
begin
  v_secret := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');   -- 43 url-safe chars
  insert into api.keys (name, key_hash, store_id, scopes, daily_limit, expires_at, created_by)
  values (left(p_name, 60), encode(digest(v_secret, 'sha256'), 'hex'), p_store, p_scopes, p_daily_limit,
          case when p_expires_days is null then null else now() + make_interval(days => p_expires_days) end,
          left(coalesce(p_created_by, ''), 60))
  returning keys.id into v_id;
  return query select v_id, 'chk_' || replace(v_id::text, '-', '') || '.' || v_secret;
end $$;

-- One round trip per request: check the key, count the call, report the budget.
create or replace function api.authenticate(p_key_id uuid, p_hash text, p_write boolean default false)
returns json language plpgsql security definer set search_path = api, public as $$
declare k api.keys; u api.usage; v_total int;
begin
  select * into k from api.keys where keys.id = p_key_id;
  if k.id is null or k.key_hash <> p_hash then
    return json_build_object('ok', false, 'reason', 'bad_key');
  end if;
  if not k.active then return json_build_object('ok', false, 'reason', 'revoked'); end if;
  if k.expires_at is not null and k.expires_at < now() then
    return json_build_object('ok', false, 'reason', 'expired');
  end if;
  insert into api.usage (key_id, day, calls, writes)
  values (k.id, current_date, 1, case when p_write then 1 else 0 end)
  on conflict (key_id, day) do update
    set calls = usage.calls + 1, writes = usage.writes + (case when p_write then 1 else 0 end)
  returning * into u;
  if u.calls > k.daily_limit then
    update api.usage set denied = denied + 1 where key_id = k.id and day = current_date;
  end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '5 minutes' then
    update api.keys set last_used_at = now() where keys.id = k.id;
  end if;
  select coalesce(sum(calls), 0) into v_total from api.usage where day = current_date;
  return json_build_object(
    'ok', u.calls <= k.daily_limit,
    'reason', case when u.calls > k.daily_limit then 'daily_limit' else null end,
    'key', json_build_object('id', k.id, 'name', k.name, 'store_id', k.store_id,
                             'scopes', k.scopes, 'daily_limit', k.daily_limit),
    'calls_today', u.calls, 'total_today', v_total);
end $$;

create or replace function api.usage_report(p_key uuid default null, p_days int default 30)
returns json language sql stable security definer set search_path = api, public as $$
  select coalesce(json_agg(json_build_object('key_id', u.key_id, 'name', k.name, 'day', u.day,
                                             'calls', u.calls, 'writes', u.writes, 'denied', u.denied)
                           order by u.day desc, k.name), '[]'::json)
  from api.usage u join api.keys k on k.id = u.key_id
  where (p_key is null or u.key_id = p_key)
    and u.day >= current_date - least(greatest(coalesce(p_days, 30), 1), 365);
$$;

-- ---------- helpers ----------

create or replace function api.today() returns text language sql stable as $$
  select to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')
$$;
create or replace function api.stamp() returns text language sql stable as $$
  select to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
$$;

-- keep only the first n elements of a json array
create or replace function api.head(p jsonb, n int) returns jsonb language sql immutable as $$
  select coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(p) with ordinality x(e, i) where i <= n), '[]'::jsonb)
$$;

create or replace function api.tracking_json(t public.tracking) returns json language sql immutable as $$
  select json_build_object(
    'acct', t.acct, 'outcome', coalesce(t.st, ''), 'next_action', coalesce(t.next, ''),
    'note', coalesce(t.note, ''), 'updated_by', coalesce(t.by_name, ''), 'updated_on', coalesce(t.at, ''),
    'verified_on', t.ver, 'owner_override', t.agent,
    'activities', coalesce(t.acts, '[]'::jsonb), 'history', coalesce(t.hist, '[]'::jsonb))
$$;

-- ---------- the book: one row per customer in the store's active base ----------
-- Base rows are stored as arrays in this order (set by the app's importer):
--   0 csr, 1 name, 2 surname, 3 acct, 4 msisdn, 5 package, 6 activation date,
--   7 product, 8 offer value (R p/m), 9 contract type, 10 status, 11 category, 12 offer, 13 email
create or replace function api.book(p_store text)
returns table (
  acct text, name text, msisdn text, email text, category text, product text, package text, offer text,
  rsp numeric, lines bigint, owner text, owner_overridden boolean,
  outcome text, next_action text, note text, updated_by text, updated_on text, verified_on text)
language sql stable security definer set search_path = api, public as $$
  with base as (
    select rows from public.bases where store_id = p_store and active order by created_at desc limit 1
  ),
  line as (select e.value as r from base, jsonb_array_elements(base.rows) as e),
  cust as (
    select r->>3 as acct,
           max(trim(coalesce(r->>1, '') || ' ' || coalesce(r->>2, ''))) as name,
           max(nullif(r->>4, '')) as msisdn,
           max(nullif(upper(r->>0), '')) as csr,
           sum(case when (r->>8) ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>8)::numeric else 0 end) as rsp,
           max(nullif(r->>7, '')) as product,
           max(nullif(r->>5, '')) as package,
           max(nullif(r->>12, '')) as offer,
           max(nullif(r->>11, '')) as category,
           max(nullif(r->>13, '')) as email,
           count(*) as lines
    from line where coalesce(r->>3, '') <> ''
    group by r->>3
  )
  select c.acct, c.name, c.msisdn, c.email, c.category, c.product, c.package, c.offer,
         round(c.rsp, 2), c.lines,
         coalesce(t.agent, c.csr, ''), (t.agent is not null),
         coalesce(t.st, ''), coalesce(t.next, ''), coalesce(t.note, ''),
         coalesce(t.by_name, ''), coalesce(t.at, ''), t.ver
  from cust c
  left join public.tracking t on t.store_id = p_store and t.acct = c.acct
$$;

create or replace function api.customers(
  p_store text, p_q text default '', p_agent text default '', p_status text default '',
  p_offset int default 0, p_limit int default 50)
returns json language sql stable security definer set search_path = api, public as $$
  with f as (
    select * from api.book(p_store) b
    where (coalesce(p_q, '') = '' or b.name ilike '%' || p_q || '%' or b.acct ilike '%' || p_q || '%'
           or coalesce(b.msisdn, '') like '%' || p_q || '%')
      and (coalesce(p_agent, '') = '' or b.owner = upper(p_agent) or (p_agent = 'none' and b.owner = ''))
      and (coalesce(p_status, '') = '' or b.outcome = p_status or (p_status = 'none' and b.outcome = ''))
  )
  select json_build_object(
    'total',  (select count(*) from f),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'limit',  least(greatest(coalesce(p_limit, 50), 1), 200),
    'items',  coalesce((select json_agg(x) from (
                select * from f order by rsp desc, acct
                offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::json))
$$;

create or replace function api.customer(p_store text, p_acct text)
returns json language sql stable security definer set search_path = api, public as $$
  select (select row_to_json(b) from api.book(p_store) b where b.acct = p_acct)::jsonb
         || coalesce((select jsonb_build_object('activities', t.acts, 'history', t.hist)
                      from public.tracking t where t.store_id = p_store and t.acct = p_acct),
                     '{"activities": [], "history": []}'::jsonb)
$$;

-- ---------- writes ----------

create or replace function api.set_outcome(
  p_store text, p_acct text, p_st text, p_next text, p_note text, p_by text)
returns json language plpgsql security definer set search_path = api, public as $$
declare prev public.tracking; rec public.tracking; v_hist jsonb;
begin
  if p_st not in ('', 'fu', 'cb', 'quote', 'visit', 'won', 'lost', 'na', 'nowa', 'upg', 'wrong') then
    raise exception 'Unknown outcome code' using errcode = '22023';
  end if;
  select * into prev from public.tracking where store_id = p_store and acct = p_acct;
  v_hist := coalesce(prev.hist, '[]'::jsonb);
  if coalesce(prev.st, '') <> p_st then
    v_hist := api.head(jsonb_build_array(jsonb_build_object('from', coalesce(prev.st, ''), 'to', p_st,
                                                            'by', left(p_by, 80), 'at', api.stamp())) || v_hist, 25);
  end if;
  insert into public.tracking (store_id, acct, st, next, note, by_name, at, hist)
  values (p_store, left(p_acct, 40), p_st, left(coalesce(p_next, ''), 10), left(coalesce(p_note, ''), 5000),
          left(coalesce(p_by, ''), 80), api.today(), v_hist)
  on conflict (store_id, acct) do update
    set st = excluded.st, next = excluded.next, note = excluded.note,
        by_name = excluded.by_name, at = excluded.at, hist = excluded.hist
  returning * into rec;
  return api.tracking_json(rec);
end $$;

create or replace function api.log_activity(p_store text, p_acct text, p_t text, p_by text)
returns json language plpgsql security definer set search_path = api, public as $$
declare rec public.tracking; v_act jsonb;
begin
  if p_t not in ('wa', 'call', 'na', 'sms', 'em') then
    raise exception 'Unknown activity type' using errcode = '22023';
  end if;
  v_act := jsonb_build_array(jsonb_build_object('t', p_t, 'by', left(coalesce(p_by, ''), 80), 'at', api.stamp()));
  insert into public.tracking (store_id, acct, acts)
  values (p_store, left(p_acct, 40), v_act)
  on conflict (store_id, acct) do update
    set acts = api.head(excluded.acts || coalesce(public.tracking.acts, '[]'::jsonb), 30)
  returning * into rec;
  return api.tracking_json(rec);
end $$;

create or replace function api.add_walkin(
  p_store text, p_name text, p_msisdn text, p_email text, p_note text, p_agent text, p_by text)
returns json language plpgsql security definer set search_path = api, public as $$
declare v_acct text; v_base uuid; v_ms text; v_email text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'A name is required' using errcode = '22023'; end if;
  v_acct := 'WI' || upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
  v_ms := regexp_replace(coalesce(p_msisdn, ''), '[^0-9]', '', 'g');
  if length(v_ms) = 10 and left(v_ms, 1) = '0' then v_ms := '27' || substr(v_ms, 2); end if;
  v_email := case when coalesce(p_email, '') like '%@%' then left(trim(p_email), 120) else '' end;
  select id into v_base from public.bases where store_id = p_store and active order by created_at desc limit 1;
  if v_base is null then raise exception 'Load a base first' using errcode = '22023'; end if;
  update public.bases
     set rows = rows || jsonb_build_array(jsonb_build_array(
           upper(coalesce(p_agent, '')), left(trim(p_name), 60), '', v_acct, v_ms, '', api.today(),
           'Walk-in / manual lead', 0, 'New / Add Sim', '', 'Consumer', '', v_email))
   where id = v_base;
  if coalesce(p_note, '') <> '' then
    insert into public.tracking (store_id, acct, note, by_name, at)
    values (p_store, v_acct, left(p_note, 5000), left(coalesce(p_by, ''), 80), api.today());
  end if;
  return json_build_object('acct', v_acct, 'base_id', v_base);
end $$;

-- Who owns which customers. p_agent '' = deliberately nobody, null = let the base decide again.
create or replace function api.assign(p_store text, p_accts text[], p_agent text)
returns int language plpgsql security definer set search_path = api, public as $$
declare n int;
begin
  insert into public.tracking (store_id, acct, agent)
  select p_store, left(a, 40), upper(trim(p_agent)) from unnest(p_accts) a where coalesce(a, '') <> ''
  on conflict (store_id, acct) do update set agent = excluded.agent;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function api.raise_claim(p_store text, p_acct text, p_customer text, p_by text, p_agent text)
returns json language plpgsql security definer set search_path = api, public as $$
declare c public.claims;
begin
  if exists (select 1 from public.tracking where store_id = p_store and acct = p_acct and coalesce(agent, '') <> '') then
    raise exception 'Already assigned' using errcode = '23505';
  end if;
  insert into public.claims (store_id, acct, customer, by_name, agent, status, at)
  values (p_store, left(p_acct, 40), left(coalesce(p_customer, ''), 60), left(coalesce(p_by, ''), 80),
          upper(left(coalesce(p_agent, ''), 40)), 'pending', api.today())
  returning * into c;
  return row_to_json(c);
end $$;

create or replace function api.decide_claim(p_store text, p_claim uuid, p_verdict text)
returns json language plpgsql security definer set search_path = api, public as $$
declare c public.claims; v_owner text;
begin
  if p_verdict not in ('approved', 'rejected') then raise exception 'verdict must be approved or rejected' using errcode = '22023'; end if;
  select * into c from public.claims where id = p_claim and store_id = p_store and status = 'pending';
  if c.id is null then raise exception 'No pending claim' using errcode = 'P0002'; end if;
  update public.claims set status = p_verdict, decided = api.today() where id = c.id;
  if p_verdict = 'approved' then
    v_owner := coalesce(nullif(c.agent, ''), upper(c.by_name));
    insert into public.tracking (store_id, acct, agent) values (p_store, c.acct, v_owner)
    on conflict (store_id, acct) do update set agent = excluded.agent;
  end if;
  return json_build_object('id', c.id, 'acct', c.acct, 'status', p_verdict, 'owner', v_owner);
end $$;

-- ---------- bases: metadata cheap, rows paged ----------

create or replace function api.bases(p_store text)
returns json language sql stable security definer set search_path = api, public as $$
  select coalesce(json_agg(json_build_object('id', id, 'label', label, 'active', active,
                                             'rows', jsonb_array_length(rows), 'created_at', created_at)
                           order by created_at), '[]'::json)
  from public.bases where store_id = p_store
$$;

create or replace function api.base_rows(p_store text, p_base uuid, p_offset int default 0, p_limit int default 200)
returns json language sql stable security definer set search_path = api, public as $$
  select json_build_object(
    'id', b.id, 'label', b.label, 'total', jsonb_array_length(b.rows),
    'offset', greatest(coalesce(p_offset, 0), 0), 'limit', least(greatest(coalesce(p_limit, 200), 1), 500),
    'columns', json_build_array('csr', 'name', 'surname', 'acct', 'msisdn', 'package', 'activated',
                                'product', 'offer_value', 'contract_type', 'status', 'category', 'offer', 'email'),
    'rows', coalesce((select json_agg(e order by i) from jsonb_array_elements(b.rows) with ordinality x(e, i)
                      where i > greatest(coalesce(p_offset, 0), 0)
                        and i <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 200), 1), 500)),
                     '[]'::json))
  from public.bases b where b.id = p_base and b.store_id = p_store
$$;

create or replace function api.load_base(p_store text, p_label text, p_rows jsonb)
returns json language plpgsql security definer set search_path = api, public as $$
declare v_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty array of rows' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) <> 'array') then
    raise exception 'every row must be an array' using errcode = '22023';
  end if;
  update public.bases set active = false where store_id = p_store and active;
  insert into public.bases (store_id, label, rows, active)
  values (p_store, left(coalesce(nullif(trim(p_label), ''), 'Uploaded base'), 40), p_rows, true)
  returning id into v_id;
  return json_build_object('id', v_id, 'rows', jsonb_array_length(p_rows));
end $$;

-- ---------- KPIs, computed in the database ----------

create or replace function api.summary(p_store text)
returns json language sql stable security definer set search_path = api, public as $$
  with b as (select * from api.book(p_store))
  select json_build_object(
    'store', p_store,
    'store_name', (select name from public.stores where id = p_store),
    'customers', (select count(*) from b),
    'offer_value', (select coalesce(sum(rsp), 0) from b),
    'by_outcome', (select coalesce(json_object_agg(k, n), '{}'::json)
                   from (select coalesce(nullif(outcome, ''), 'none') k, count(*) n from b group by 1) x),
    'by_owner', (select coalesce(json_agg(json_build_object('owner', owner, 'customers', n, 'won', w,
                                                            'contacted', c, 'offer_value', v) order by v desc), '[]'::json)
                 from (select coalesce(nullif(owner, ''), '(unassigned)') owner, count(*) n,
                              count(*) filter (where outcome = 'won') w,
                              count(*) filter (where outcome <> '') c, sum(rsp) v
                       from b group by 1) x),
    'callbacks_due', (select count(*) from b where next_action <> '' and next_action <= api.today()),
    'won', (select count(*) from b where outcome = 'won'),
    'won_verified', (select count(*) from b where outcome = 'won' and verified_on is not null),
    'pending_claims', (select count(*) from public.claims where store_id = p_store and status = 'pending'),
    'verified_at', (select verify_at from public.stores where id = p_store),
    'as_of', now())
$$;

-- ---------- only the worker may call any of this ----------
do $$ declare r record; begin
  for r in select p.oid::regprocedure as fn from pg_proc p where p.pronamespace = 'api'::regnamespace loop
    execute 'revoke all on function ' || r.fn || ' from public, anon, authenticated';
    execute 'grant execute on function ' || r.fn || ' to service_role';
  end loop;
end $$;

-- ---------- sanity check ----------
select 'api tables' as what, string_agg(tablename, ', ' order by tablename) as detail
  from pg_tables where schemaname = 'api'
union all
select 'api functions', string_agg(proname, ', ' order by proname)
  from pg_proc where pronamespace = 'api'::regnamespace
union all
select 'public tables (should still be 5)', string_agg(tablename, ', ' order by tablename)
  from pg_tables where schemaname = 'public';
