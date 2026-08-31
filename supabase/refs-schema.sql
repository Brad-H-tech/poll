-- ============================================================
--  Sales Reference Number System — Supabase schema
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  Safe to re-run: everything is create-if-not-exists / replace.
--
--  The app itself is served from /refs on the Cloudflare site
--  and talks to these tables directly with the publishable key.
-- ============================================================

-- ---------- tables ----------

-- consultants who can be picked per store; staff add/remove in the app
create table if not exists public.ref_consultants (
  store      text not null,            -- 'CAS' | 'HOW' | 'KOK' | 'SCO' | 'SHB' | 'VRY'
  name       text not null,
  created_at timestamptz default now(),
  primary key (store, name)
);

-- per-store per-day sequence, bumped atomically by next_ref_seq() below.
-- Not readable/writable by the app directly.
create table if not exists public.ref_counters (
  store text not null,
  day   text not null,                 -- 'YYMMDD'
  seq   int  not null default 0,
  primary key (store, day)
);

-- one row per issued reference
create table if not exists public.ref_transactions (
  ref            text primary key,     -- CL-STORE-YYMMDD-SEQ
  store          text not null,
  reason         text default '',      -- 'Staff discount' | 'Other'
  consultant     text default '',
  customer       text default '',
  cost_price     numeric,
  discount_total numeric,
  sales_price    numeric,
  tx_date        date,
  notes          text default '',
  created_at     timestamptz default now()
);
create index if not exists ref_txn_store_idx
  on public.ref_transactions (store, created_at desc);

-- ---------- atomic sequence ----------
-- SECURITY DEFINER so the app can get the next number without any
-- direct access to ref_counters. Two tills generating at the same
-- moment can never receive the same number.

create or replace function public.next_ref_seq(p_store text, p_day text)
returns int
language sql
security definer
set search_path = public
as $$
  insert into public.ref_counters (store, day, seq)
  values (p_store, p_day, 1)
  on conflict (store, day)
  do update set seq = ref_counters.seq + 1
  returning seq;
$$;

grant execute on function public.next_ref_seq(text, text) to anon, authenticated;

-- ---------- security rules ----------
-- The refs app has no login (store gate only), so the publishable key
-- may read consultants + transactions, add consultants, and log new
-- transactions. Issued references can never be edited or deleted from
-- the app — the log is append-only. The counters table is reachable
-- only through next_ref_seq().

alter table public.ref_consultants  enable row level security;
alter table public.ref_counters     enable row level security;
alter table public.ref_transactions enable row level security;

drop policy if exists ref_consultants_read   on public.ref_consultants;
drop policy if exists ref_consultants_add    on public.ref_consultants;
drop policy if exists ref_consultants_remove on public.ref_consultants;
create policy ref_consultants_read   on public.ref_consultants for select using (true);
create policy ref_consultants_add    on public.ref_consultants for insert with check (true);
create policy ref_consultants_remove on public.ref_consultants for delete using (true);

drop policy if exists ref_transactions_read on public.ref_transactions;
drop policy if exists ref_transactions_add  on public.ref_transactions;
create policy ref_transactions_read on public.ref_transactions for select using (true);
create policy ref_transactions_add  on public.ref_transactions for insert with check (true);

-- no policies on ref_counters: nobody but next_ref_seq() touches it
revoke all on public.ref_counters from anon, authenticated;

-- ---------- starter consultants ----------
-- Known names on file; staff add the rest in the app.
-- Re-running never duplicates or resurrects removed names' entries
-- beyond re-adding these starters.

insert into public.ref_consultants (store, name) values
  ('HOW','Freeman'), ('HOW','Nomusa'), ('HOW','Siphesihle'), ('HOW','Cynthia'),
  ('KOK','Amanda'), ('KOK','Lungisa'), ('KOK','Paula'), ('KOK','Yonela'),
  ('KOK','Tammy'), ('KOK','Lesley'), ('KOK','Malwande'),
  ('SCO','Werner'), ('SCO','Samantha'), ('SCO','Sonto'), ('SCO','Preshnee'),
  ('SCO','Kiashan'), ('SCO','Shaun'),
  ('SHB','Carey'), ('SHB','Joash'), ('SHB','Nontuthuko'), ('SHB','Roxanne'),
  ('SHB','Simone'), ('SHB','Amahle'),
  ('VRY','Nokwethemba'), ('VRY','Pinkie'), ('VRY','Graham'),
  ('VRY','Christopher'), ('VRY','Nozipho')
on conflict (store, name) do nothing;
