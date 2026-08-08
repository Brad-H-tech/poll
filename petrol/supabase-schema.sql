-- ============================================================
--  SlipStream — Supabase setup (paste ALL of this into the
--  SQL Editor in your Supabase project and click "Run")
--
--  !! BEFORE RUNNING: change the admin code on the line marked
--     "CHANGE ME" below. Safe to re-run any time (it updates
--     policies and the admin code in place).
-- ============================================================

-- 1. The fill-ups table -------------------------------------
create table if not exists public.fillups (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  fill_date     date not null,
  rand_total    numeric(10,2) not null default 0 check (rand_total >= 0),
  litres        numeric(8,2)  not null default 0 check (litres >= 0),
  odometer      integer,
  station       text,
  vehicle       text,
  notes         text,
  slip_path     text,
  created_at    timestamptz not null default now()
);

-- 2. Admins -------------------------------------------------
--    Anyone who enters the admin code in the app gets added to
--    this table (server-side check — the code never appears in
--    the app's source). Admins can see EVERYONE's entries and
--    slip photos; normal users only ever see their own.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table if not exists public.admin_config (
  id   int primary key check (id = 1),
  code text not null
);

insert into public.admin_config (id, code)
values (1, 'FUEL-BOSS-2468')          -- <<<<<<<<<< CHANGE ME
on conflict (id) do update set code = excluded.code;

-- Locked down: no policies means nobody can read these tables
-- directly — only through the two functions below.
alter table public.admins enable row level security;
alter table public.admin_config enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.claim_admin(claim_code text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from admin_config where code = claim_code) then
    insert into admins (user_id) values (auth.uid())
    on conflict do nothing;
    return true;
  end if;
  return false;
end;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.claim_admin(text) to authenticated;

-- 3. Row-level security on fill-ups -------------------------
--    See your own; admins see all; only add/change/delete your own.
alter table public.fillups enable row level security;

drop policy if exists "team can read all fillups" on public.fillups;
drop policy if exists "read own or admin" on public.fillups;
create policy "read own or admin"
  on public.fillups for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "insert own fillups" on public.fillups;
create policy "insert own fillups"
  on public.fillups for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own fillups" on public.fillups;
create policy "update own fillups"
  on public.fillups for update
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "delete own fillups" on public.fillups;
create policy "delete own fillups"
  on public.fillups for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Private storage bucket for slip photos ------------------
insert into storage.buckets (id, name, public)
values ('slips', 'slips', false)
on conflict (id) do nothing;

-- Photos live at slips/<user-id>/<entry-id>.jpg. You can view
-- your own; admins can view all; you can only upload/delete yours.
drop policy if exists "team can read slips" on storage.objects;
drop policy if exists "read own slips or admin" on storage.objects;
create policy "read own slips or admin"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'slips'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "upload own slips" on storage.objects;
create policy "upload own slips"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete own slips" on storage.objects;
create policy "delete own slips"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);
