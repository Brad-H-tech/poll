-- ============================================================
--  SlipStream — Supabase setup (paste ALL of this into the
--  SQL Editor in your Supabase project and click "Run")
-- ============================================================

-- 1. The fill-ups table -------------------------------------
create table if not exists public.fillups (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  fill_date     date not null,
  rand_total    numeric(10,2) not null check (rand_total >= 0),
  litres        numeric(8,2)  not null default 0 check (litres >= 0),
  odometer      integer,
  station       text,
  vehicle       text,
  notes         text,
  slip_path     text,
  created_at    timestamptz not null default now()
);

-- 2. Row-level security: everyone on the team can SEE all
--    entries, but you can only add/change/delete YOUR OWN.
alter table public.fillups enable row level security;

create policy "team can read all fillups"
  on public.fillups for select
  to authenticated
  using (true);

create policy "insert own fillups"
  on public.fillups for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "update own fillups"
  on public.fillups for update
  to authenticated
  using (auth.uid() = user_id);

create policy "delete own fillups"
  on public.fillups for delete
  to authenticated
  using (auth.uid() = user_id);

-- 3. Private storage bucket for the slip photos --------------
insert into storage.buckets (id, name, public)
values ('slips', 'slips', false)
on conflict (id) do nothing;

-- Team can view every slip photo; you can only upload/delete
-- photos inside your own folder (slips/<your-user-id>/...).
create policy "team can read slips"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'slips');

create policy "upload own slips"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own slips"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = auth.uid()::text);
