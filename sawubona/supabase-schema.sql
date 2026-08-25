-- ============================================================
--  Sawubona — shared leaderboard database
-- ============================================================
--  HOW TO USE:
--  1. Open your Supabase project
--  2. Click "SQL Editor" in the left menu
--  3. Click "New query"
--  4. Copy EVERYTHING in this file, paste it in, click "Run"
--  5. You should see "Success. No rows returned" — that's correct!
--
--  Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- The scores table — one row per game played, by anyone
-- ------------------------------------------------------------
create table if not exists public.sawubona_scores (
  id          bigint generated always as identity primary key,
  player      text        not null,
  score       integer     not null,
  correct     integer     not null,
  total       integer     not null,
  day         integer     not null,   -- day number, so we can show "today only"
  created_at  timestamptz not null default now(),

  -- Sanity limits so nobody can post a silly score
  constraint player_length  check (char_length(trim(player)) between 1 and 20),
  constraint score_range    check (score   between 0 and 500),
  constraint correct_range  check (correct between 0 and 50),
  constraint total_range    check (total   between 1 and 50),
  constraint correct_sane   check (correct <= total)
);

-- Makes the leaderboard fast even with thousands of games
create index if not exists sawubona_scores_score_idx
  on public.sawubona_scores (score desc);
create index if not exists sawubona_scores_day_idx
  on public.sawubona_scores (day desc, score desc);

-- ------------------------------------------------------------
-- Security: anyone can read the board and add their own score,
-- but NOBODY can edit or delete somebody else's score.
-- ------------------------------------------------------------
alter table public.sawubona_scores enable row level security;

drop policy if exists "anyone can read the leaderboard" on public.sawubona_scores;
create policy "anyone can read the leaderboard"
  on public.sawubona_scores for select
  using (true);

drop policy if exists "anyone can add their score" on public.sawubona_scores;
create policy "anyone can add their score"
  on public.sawubona_scores for insert
  with check (true);

-- No update or delete policy exists on purpose.
-- That means scores can never be changed or removed from the app,
-- only by you, from inside the Supabase dashboard.

-- ------------------------------------------------------------
-- Done! Now copy your project URL and anon key into config.js
-- (Supabase: Project Settings -> API)
-- ------------------------------------------------------------
