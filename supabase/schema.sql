-- ============================================================
--  Chase — Supabase schema + security rules
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  Safe to re-run: everything is create-if-not-exists / replace.
-- ============================================================

-- ---------- tables ----------

create table if not exists public.stores (
  id    text primary key,          -- 's1' … 's7'
  name  text not null,
  sort  int  default 0
);

-- one row per person who can sign in. Linked to Supabase's own auth users.
-- store_id NULL + role 'manager'  =  head office: sees every store.
create table if not exists public.profiles (
  id        uuid primary key references auth.users on delete cascade,
  username  text unique not null,
  name      text not null,
  role      text not null default 'consultant',   -- 'manager' | 'consultant'
  agent     text default '',                      -- their name as it appears in the base file
  store_id  text references public.stores(id) on delete set null,
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
create index if not exists bases_store_idx on public.bases(store_id);

-- the working state of each customer: outcome, callback, notes, history
create table if not exists public.tracking (
  store_id   text not null references public.stores(id) on delete cascade,
  acct       text not null,
  st         text default '',
  next       text default '',      -- 'YYYY-MM-DD'
  note       text default '',
  by_name    text default '',
  at         text default '',
  ver        text,                 -- date confirmed by the MTN activations file
  acts       jsonb default '[]'::jsonb,
  hist       jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  primary key (store_id, acct)
);

create table if not exists public.claims (
  id        uuid primary key default gen_random_uuid(),
  store_id  text not null references public.stores(id) on delete cascade,
  acct      text not null,
  customer  text default '',
  by_name   text default '',
  agent     text default '',
  status    text default 'pending',   -- pending | approved | rejected
  at        text default '',
  decided   text,
  created_at timestamptz default now()
);
create index if not exists claims_store_idx on public.claims(store_id, status);

-- manager overrides of who owns a customer ('' = deliberately unassigned)
create table if not exists public.assign (
  store_id text not null references public.stores(id) on delete cascade,
  acct     text not null,
  agent    text default '',
  primary key (store_id, acct)
);

create table if not exists public.settings (
  store_id   text primary key references public.stores(id) on delete cascade,
  wa_tpl     text default '',
  quotes     text default '',
  report_to  text default '',
  verify_at  text
);

-- ---------- the six stores + Admin ----------

insert into public.stores (id, name, sort) values
  ('s1','Montrose',1), ('s2','Kokstad',2), ('s3','Scottburgh',3),
  ('s4','Shelly Beach',4), ('s5','Howick',5), ('s6','Vryheid',6),
  ('s7','Admin',7)
on conflict (id) do update set name = excluded.name, sort = excluded.sort;

-- ---------- helpers ----------
-- SECURITY DEFINER so reading your own profile inside a policy
-- doesn't re-trigger the policy on profiles (infinite recursion).

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_store() returns text
  language sql stable security definer set search_path = public as $$
  select store_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from public.profiles where id = auth.uid()), false)
$$;

-- true if the signed-in person may touch this store.
-- head office (manager with no store_id) may touch all of them.
create or replace function public.can_see(target text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.store_id = target or (p.store_id is null and p.role = 'manager'))
  )
$$;

-- ---------- row level security ----------

alter table public.stores   enable row level security;
alter table public.profiles enable row level security;
alter table public.bases    enable row level security;
alter table public.tracking enable row level security;
alter table public.claims   enable row level security;
alter table public.assign   enable row level security;
alter table public.settings enable row level security;

-- stores: any signed-in person can read the list (needed for the login picker)
drop policy if exists stores_read on public.stores;
create policy stores_read on public.stores for select to authenticated using (true);

-- profiles: you always see yourself; managers see their store's people
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_manager() and public.can_see(store_id)));

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.is_manager());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or (public.is_manager() and public.can_see(store_id)));

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_manager() and public.can_see(store_id) and id <> auth.uid());

-- bases: everyone in the store reads; only managers load or remove them
drop policy if exists bases_read on public.bases;
create policy bases_read on public.bases for select to authenticated
  using (public.can_see(store_id));
drop policy if exists bases_write on public.bases;
create policy bases_write on public.bases for insert to authenticated
  with check (public.is_manager() and public.can_see(store_id));
drop policy if exists bases_update on public.bases;
create policy bases_update on public.bases for update to authenticated
  using (public.is_manager() and public.can_see(store_id));
drop policy if exists bases_delete on public.bases;
create policy bases_delete on public.bases for delete to authenticated
  using (public.is_manager() and public.can_see(store_id));

-- tracking: anyone in the store may log outcomes (that's the whole job)
drop policy if exists tracking_read on public.tracking;
create policy tracking_read on public.tracking for select to authenticated
  using (public.can_see(store_id));
drop policy if exists tracking_write on public.tracking;
create policy tracking_write on public.tracking for insert to authenticated
  with check (public.can_see(store_id));
drop policy if exists tracking_update on public.tracking;
create policy tracking_update on public.tracking for update to authenticated
  using (public.can_see(store_id));

-- claims: consultants raise them, managers decide them
drop policy if exists claims_read on public.claims;
create policy claims_read on public.claims for select to authenticated
  using (public.can_see(store_id));
drop policy if exists claims_write on public.claims;
create policy claims_write on public.claims for insert to authenticated
  with check (public.can_see(store_id));
drop policy if exists claims_update on public.claims;
create policy claims_update on public.claims for update to authenticated
  using (public.is_manager() and public.can_see(store_id));

-- assign: managers only — this is who owns which customer
drop policy if exists assign_read on public.assign;
create policy assign_read on public.assign for select to authenticated
  using (public.can_see(store_id));
drop policy if exists assign_write on public.assign;
create policy assign_write on public.assign for insert to authenticated
  with check (public.is_manager() and public.can_see(store_id));
drop policy if exists assign_update on public.assign;
create policy assign_update on public.assign for update to authenticated
  using (public.is_manager() and public.can_see(store_id));
drop policy if exists assign_delete on public.assign;
create policy assign_delete on public.assign for delete to authenticated
  using (public.is_manager() and public.can_see(store_id));

-- settings: everyone reads (consultants need the WhatsApp template), managers write
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated
  using (public.can_see(store_id));
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for insert to authenticated
  with check (public.is_manager() and public.can_see(store_id));
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.is_manager() and public.can_see(store_id));

-- ---------- live sync ----------
-- lets every phone see changes the moment they happen, replacing the old
-- server-sent events.
do $$
begin
  alter publication supabase_realtime add table public.tracking;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.claims;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.assign;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.bases;
exception when duplicate_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- ============================================================
--  Done. Next: create your first manager in Authentication → Users,
--  then run make-manager.sql to give that person head-office access.
-- ============================================================
