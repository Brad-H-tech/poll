-- ============================================================
--  Chase — Supabase schema + security rules   (fresh project)
--  Run this ONCE in Supabase -> SQL Editor -> New query -> Run.
--  Safe to re-run: everything is create-if-not-exists / replace.
--
--  Five tables, nothing more:
--    stores    the six shops + Admin, and each shop's settings
--    profiles  one row per person who can sign in
--    bases     each monthly upload (the customer list)
--    tracking  the working state of each customer, incl. who owns it
--    claims    "can I have this customer?" requests
--
--  Already have the older 7-table layout? Run migrations/2026-09-26_simplify.sql instead.
-- ============================================================

-- ---------- tables ----------

create table if not exists public.stores (
  id        text primary key,               -- 's1' … 's7'
  name      text not null,
  sort      int  not null default 0,
  wa_tpl    text not null default '',       -- WhatsApp message template
  quotes    text not null default '',       -- mission quotes, one per line
  report_to text not null default '',       -- number the daily report goes to
  verify_at text                            -- last MTN activations check ('YYYY-MM-DD')
);

-- one row per person who can sign in. Linked to Supabase's own auth users.
-- store_id NULL + role 'manager'  =  head office: sees every store.
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text unique not null,
  name       text not null,
  role       text not null default 'consultant',   -- 'manager' | 'consultant'
  agent      text default '',                      -- their name as it appears in the base file
  store_id   text references public.stores(id) on delete set null,
  created_at timestamptz default now()
);

-- each monthly upload
create table if not exists public.bases (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null references public.stores(id) on delete cascade,
  label      text not null default 'Uploaded base',
  rows       jsonb not null default '[]'::jsonb,
  active     boolean not null default false,
  created_at timestamptz default now()
);

-- the working state of each customer: outcome, callback, notes, history, owner
create table if not exists public.tracking (
  store_id   text not null references public.stores(id) on delete cascade,
  acct       text not null,
  st         text not null default '',      -- outcome code
  next       text not null default '',      -- callback 'YYYY-MM-DD'
  note       text not null default '',
  by_name    text not null default '',
  at         text not null default '',
  ver        text,                          -- date confirmed by the MTN activations file (manager only)
  agent      text,                          -- owner override (manager only): null = base decides, '' = nobody
  acts       jsonb not null default '[]'::jsonb,
  hist       jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (store_id, acct)
);

create table if not exists public.claims (
  id         uuid primary key default gen_random_uuid(),
  store_id   text not null references public.stores(id) on delete cascade,
  acct       text not null,
  customer   text not null default '',
  by_name    text not null default '',
  agent      text not null default '',
  status     text not null default 'pending',   -- pending | approved | rejected
  at         text not null default '',
  decided    text,
  created_at timestamptz default now()
);

-- ---------- the six stores + Admin ----------
insert into public.stores (id, name, sort) values
  ('s1','Montrose',1), ('s2','Kokstad',2), ('s3','Scottburgh',3),
  ('s4','Shelly Beach',4), ('s5','Howick',5), ('s6','Vryheid',6),
  ('s7','Admin',7)
on conflict (id) do update set name = excluded.name, sort = excluded.sort;

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

-- ---------- walk-ins: a consultant may ADD one customer, never rewrite a base ----------
-- Writing to `bases` is manager-only (see bases_update), but adding a walk-in customer is
-- everyday consultant work. This function appends exactly one row to the store's active base,
-- server-side, so the phone never has to download or upload the whole base to do it.
-- (Supabase's advisor will list it as a SECURITY DEFINER function callable by signed-in users:
-- that is the intent; anonymous callers cannot run it.)
create or replace function public.add_walkin(p_store text, p_row jsonb) returns text
  language plpgsql security definer set search_path = public as $$
declare v_base uuid; v_acct text;
begin
  if not chase.can_see(p_store) then raise exception 'Not your store' using errcode = '42501'; end if;
  if jsonb_typeof(p_row) <> 'array' or jsonb_array_length(p_row) > 20
     or exists (select 1 from jsonb_array_elements(p_row) e where jsonb_typeof(e) in ('object', 'array')) then
    raise exception 'A walk-in is one row of plain cells' using errcode = '22023';
  end if;
  v_acct := coalesce(p_row->>3, '');
  if v_acct = '' or char_length(v_acct) > 40 then raise exception 'Bad account number' using errcode = '22023'; end if;
  select id into v_base from public.bases where store_id = p_store and active order by created_at desc limit 1;
  if v_base is null then raise exception 'Load a base first' using errcode = '22023'; end if;
  update public.bases set rows = rows || jsonb_build_array(p_row) where id = v_base;
  return v_acct;
end $$;
revoke execute on function public.add_walkin(text, jsonb) from public, anon;
grant  execute on function public.add_walkin(text, jsonb) to authenticated, service_role;

-- ---------- live sync ----------
-- every phone sees a change the moment it happens
do $$ begin alter publication supabase_realtime add table public.tracking; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.claims;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bases;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.stores;   exception when duplicate_object then null; end $$;

-- ---------- housekeeping: old bases go after 12 months ----------
-- A base is personal information (POPIA) and the biggest thing in the database.
-- Inactive bases older than 12 months are removed every night at 02:17 UTC.
-- rows_count lets the app list bases without downloading their rows.
alter table public.bases add column if not exists rows_count int
  generated always as (jsonb_array_length(rows)) stored;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('chase-prune-old-bases', '17 2 * * *',
    $job$ delete from public.bases where not active and created_at < now() - interval '12 months' $job$);
exception when others then
  raise notice 'pg_cron not available (%). Enable it under Database -> Extensions and re-run this file.', sqlerrm;
end $$;

-- ============================================================
--  Done. Next: create your first manager in Authentication -> Users,
--  then run make-manager.sql to give that person head-office access.
-- ============================================================
