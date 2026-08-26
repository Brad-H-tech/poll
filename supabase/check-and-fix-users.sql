-- ============================================================
--  Chase — see who really exists, and repair half-created people.
--
--  Symptom this fixes: the Team tab says "Username already exists"
--  but that person is not in the list. It means the login was made
--  but the profile record was not — usually because an earlier
--  attempt was cut short by the email rate limit.
--
--  Run in Supabase → SQL Editor → New query.
-- ============================================================


-- ---------- STEP 1: look. Run this on its own first. ----------
-- 'NO PROFILE — half created' is the row to repair in step 2.

select
  u.email,
  coalesce(p.username, '— none —')                as username,
  coalesce(p.name, '')                            as name,
  coalesce(p.role, '')                            as role,
  coalesce(p.store_id, case when p.id is null then '' else 'ALL STORES' end) as store,
  coalesce(p.agent, '')                           as agent_code,
  case when p.id is null then 'NO PROFILE — half created' else 'ok' end as state
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at;


-- ---------- STEP 2: repair one person. ----------
-- Edit the five values, then run just this statement.
--   email     — as shown in step 1 (username + @chase.local)
--   username  — what they type to sign in. LOWERCASE, no spaces.
--   name      — how it reads on screen
--   agent     — must match the CSR/agent column in the base file, UPPERCASE
--   store     — 's1' Montrose · 's2' Kokstad · 's3' Scottburgh
--               's4' Shelly Beach · 's5' Howick · 's6' Vryheid · 's7' Admin

insert into public.profiles (id, username, name, role, agent, store_id)
select id, 'simone', 'Simone', 'consultant', 'SIMONE', 's4'
from auth.users
where email = 'simone@chase.local'
on conflict (id) do update
  set username = excluded.username,
      name     = excluded.name,
      role     = excluded.role,
      agent    = excluded.agent,
      store_id = excluded.store_id;


-- ---------- STEP 3: check it took ----------
-- Re-run step 1. Simone should now read: consultant · s4 · SIMONE


-- ---------- If you would rather start her over ----------
-- Deletes the login AND the profile, so the Team tab can add her fresh.
-- Uncomment the line, run it, then use Add user in the app again.
--
-- delete from auth.users where email = 'simone@chase.local';
