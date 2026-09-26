-- ============================================================
--  Chase — simplify the database
--  7 tables -> 5, 4 helper functions -> 2, plus database-side guards.
--  Run ONCE in Supabase -> SQL Editor -> New query -> Run.
--  Safe to re-run. Keeps every row:
--    settings  -> four columns on the store row
--    assign    -> the `agent` column on the tracking row
-- ============================================================

-- ---------- 1. a store's settings live on the store row ----------
alter table public.stores
  add column if not exists wa_tpl    text not null default '',   -- WhatsApp template
  add column if not exists quotes    text not null default '',   -- mission quotes, one per line
  add column if not exists report_to text not null default '',   -- number the daily report goes to
  add column if not exists verify_at text;                       -- last MTN activations check
do $$ begin
  if to_regclass('public.settings') is not null then
    update public.stores s
       set wa_tpl = coalesce(x.wa_tpl, ''), quotes = coalesce(x.quotes, ''),
           report_to = coalesce(x.report_to, ''), verify_at = x.verify_at
      from public.settings x where x.store_id = s.id;
    drop table public.settings;
  end if;
end $$;

-- ---------- 2. who owns a customer lives on the tracking row ----------
-- null = the base file decides, '' = deliberately nobody, 'SIMONE' = a manager override
alter table public.tracking add column if not exists agent text;
do $$ begin
  if to_regclass('public.assign') is not null then
    insert into public.tracking (store_id, acct, agent)
      select store_id, acct, coalesce(agent, '') from public.assign
      on conflict (store_id, acct) do update set agent = excluded.agent;
    drop table public.assign;
  end if;
end $$;

-- ---------- 3. the old public helpers go (policies that used them are recreated below) ----------
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop function if exists public.my_role();
drop function if exists public.my_store();
drop function if exists public.is_manager();
drop function if exists public.can_see(text);

-- ---------- helpers: live in a private schema, not the public API ----------
-- Supabase exposes every function in `public` at /rest/v1/rpc/…; these two
-- are only meant for the rules below, so they live in `chase` instead.
create schema if not exists chase;
revoke all on schema chase from public;
grant usage on schema chase to authenticated, service_role;

create or replace function chase.is_manager() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from public.profiles where id = (select auth.uid())), false)
$$;

-- true if the signed-in person may touch this store.
-- head office (a manager with no store_id) may touch all of them.
create or replace function chase.can_see(target text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.store_id = target or (p.store_id is null and p.role = 'manager'))
  )
$$;
revoke execute on function chase.is_manager(), chase.can_see(text) from public, anon;
grant  execute on function chase.is_manager(), chase.can_see(text) to authenticated, service_role;

-- ---------- row level security ----------
-- start clean so this file can be re-run: every old rule goes, then the set below is created.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('stores','profiles','bases','tracking','claims') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.stores   enable row level security;
alter table public.profiles enable row level security;
alter table public.bases    enable row level security;
alter table public.tracking enable row level security;
alter table public.claims   enable row level security;

-- stores: the NAMES are public (the login screen lists them before anyone signs in).
-- The message template, quotes and report number are only for signed-in people,
-- so the anonymous key is limited to exactly three columns.
revoke select on public.stores from anon;
grant  select (id, name, sort) on public.stores to anon;
create policy stores_read   on public.stores for select to anon, authenticated using (true);
create policy stores_update on public.stores for update to authenticated
  using (chase.is_manager() and chase.can_see(id))
  with check (chase.is_manager() and chase.can_see(id));

-- profiles: you always see yourself; managers see (and manage) their store's people.
-- Only a manager creates people, so nobody can sign up and make themselves manager.
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (chase.is_manager() and chase.can_see(store_id)));
create policy profiles_write on public.profiles for insert to authenticated
  with check (chase.is_manager() and chase.can_see(store_id));
create policy profiles_update on public.profiles for update to authenticated
  using (chase.is_manager() and chase.can_see(store_id))
  with check (chase.is_manager() and chase.can_see(store_id));
create policy profiles_delete on public.profiles for delete to authenticated
  using (chase.is_manager() and chase.can_see(store_id) and id <> (select auth.uid()));

-- bases: everyone in the store reads; only managers load, switch or remove them
create policy bases_read on public.bases for select to authenticated
  using (chase.can_see(store_id));
create policy bases_write on public.bases for insert to authenticated
  with check (chase.is_manager() and chase.can_see(store_id));
create policy bases_update on public.bases for update to authenticated
  using (chase.is_manager() and chase.can_see(store_id))
  with check (chase.is_manager() and chase.can_see(store_id));
create policy bases_delete on public.bases for delete to authenticated
  using (chase.is_manager() and chase.can_see(store_id));

-- tracking: anyone in the store logs outcomes (that is the job).
-- The `agent` (who owns the customer) and `ver` (confirmed by MTN) columns are
-- manager-only — enforced by the tracking_guard trigger below.
create policy tracking_read on public.tracking for select to authenticated
  using (chase.can_see(store_id));
create policy tracking_write on public.tracking for insert to authenticated
  with check (chase.can_see(store_id));
create policy tracking_update on public.tracking for update to authenticated
  using (chase.can_see(store_id))
  with check (chase.can_see(store_id));

-- claims: consultants raise them, managers decide them
create policy claims_read on public.claims for select to authenticated
  using (chase.can_see(store_id));
create policy claims_write on public.claims for insert to authenticated
  with check (chase.can_see(store_id));
create policy claims_update on public.claims for update to authenticated
  using (chase.is_manager() and chase.can_see(store_id))
  with check (chase.is_manager() and chase.can_see(store_id));

-- ---------- guards: the database refuses bad or oversized data itself ----------
-- These hold even if someone bypasses the app and talks to the API directly.
create or replace function chase.guard_tracking() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.store_id := old.store_id;          -- keys never move between stores
    new.acct     := old.acct;
  end if;
  if current_user = 'authenticated' and not chase.is_manager() then
    if tg_op = 'INSERT' and (new.agent is not null or new.ver is not null) then
      raise exception 'Only a manager may assign a customer or mark it verified' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.agent is distinct from old.agent or new.ver is distinct from old.ver) then
      raise exception 'Only a manager may assign a customer or mark it verified' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tracking_guard on public.tracking;
create trigger tracking_guard before insert or update on public.tracking
  for each row execute function chase.guard_tracking();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tracking_st_chk') then
    alter table public.tracking add constraint tracking_st_chk
      check (st in ('', 'fu', 'cb', 'quote', 'visit', 'won', 'lost', 'na', 'nowa', 'upg', 'wrong'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tracking_size_chk') then
    alter table public.tracking add constraint tracking_size_chk
      check (char_length(acct) between 1 and 40 and char_length(note) <= 5000
         and char_length(next) <= 10 and char_length(by_name) <= 80 and char_length(at) <= 20
         and coalesce(char_length(agent), 0) <= 40 and coalesce(char_length(ver), 0) <= 20
         and jsonb_typeof(acts) = 'array' and jsonb_array_length(acts) <= 30
         and jsonb_typeof(hist) = 'array' and jsonb_array_length(hist) <= 25);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claims_shape_chk') then
    alter table public.claims add constraint claims_shape_chk
      check (status in ('pending', 'approved', 'rejected')
         and char_length(acct) between 1 and 40 and char_length(customer) <= 60
         and char_length(by_name) <= 80 and char_length(agent) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bases_shape_chk') then
    alter table public.bases add constraint bases_shape_chk
      check (char_length(label) <= 40 and jsonb_typeof(rows) = 'array'
         and jsonb_array_length(rows) <= 50000 and pg_column_size(rows) <= 25 * 1024 * 1024);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_shape_chk') then
    alter table public.profiles add constraint profiles_shape_chk
      check (role in ('manager', 'consultant') and username ~ '^[a-z0-9._-]{1,40}$'
         and char_length(name) between 1 and 60 and char_length(coalesce(agent, '')) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stores_shape_chk') then
    alter table public.stores add constraint stores_shape_chk
      check (char_length(name) between 1 and 40 and char_length(wa_tpl) <= 8000
         and char_length(quotes) <= 8000 and char_length(report_to) <= 40
         and coalesce(char_length(verify_at), 0) <= 20);
  end if;
end $$;

-- one pending claim per customer, one active base per store, fast lookups
create unique index if not exists claims_one_pending_idx on public.claims (store_id, acct) where status = 'pending';
create unique index if not exists bases_one_active_idx   on public.bases (store_id) where active;
create index if not exists profiles_store_idx on public.profiles (store_id);
create index if not exists bases_store_idx    on public.bases (store_id);
create index if not exists claims_store_idx   on public.claims (store_id, status);

-- ---------- live sync ----------
-- every phone sees a change the moment it happens
do $$ begin alter publication supabase_realtime add table public.tracking; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.claims;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bases;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.stores;   exception when duplicate_object then null; end $$;

-- ---------- sanity check ----------
-- Expect 5 tables, 2 functions in `chase`, and no function left in `public`.
select 'tables' as what, string_agg(tablename, ', ' order by tablename) as detail
  from pg_tables where schemaname = 'public'
union all
select 'chase helpers', string_agg(proname, ', ' order by proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'chase'
union all
select 'public functions', coalesce(string_agg(proname, ', '), '(none)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
