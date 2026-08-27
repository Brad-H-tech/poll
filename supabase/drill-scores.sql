-- ============================================================
--  iLula Docs Drill — shared store board
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  (Same project the Chase app uses — this just adds one table.)
--  Safe to re-run: everything is create-if-not-exists / replace.
-- ============================================================

create table if not exists public.drill_scores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 22),
  mode        text not null default '' check (char_length(mode) <= 20),
  score       int  not null default 0 check (score between 0 and 100000),
  accuracy    int  not null default 0 check (accuracy between 0 and 100),
  rounds      int  not null default 0 check (rounds between 0 and 50),
  perfect     int  not null default 0 check (perfect between 0 and 50),
  best_streak int  not null default 0 check (best_streak between 0 and 50),
  created_at  timestamptz not null default now()
);

create index if not exists drill_scores_score_idx on public.drill_scores (score desc);

-- Anyone with the public key may read the board and post a score.
-- Nobody may edit or delete rows from the app (clean up in the
-- dashboard / SQL editor if ever needed).
alter table public.drill_scores enable row level security;

drop policy if exists drill_scores_read   on public.drill_scores;
create policy drill_scores_read   on public.drill_scores for select using (true);

drop policy if exists drill_scores_insert on public.drill_scores;
create policy drill_scores_insert on public.drill_scores for insert with check (true);
