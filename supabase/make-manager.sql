-- ============================================================
--  Chase — turn a signed-up account into the head-office manager.
--
--  1. Supabase → Authentication → Users → "Add user" → "Create new user"
--       Email:    bradley@chase.local      (any address; it is only a login)
--       Password: pick a strong one
--       Tick "Auto Confirm User"
--  2. Change the email below if you used a different one, then Run.
--
--  store_id = NULL means head office: you see all seven stores.
--  For a store-only manager, set store_id to 's1' … 's7' instead.
-- ============================================================

insert into public.profiles (id, username, name, role, agent, store_id)
select id, 'bradley', 'Bradley', 'manager', '', null
from auth.users
where email = 'bradley@chase.local'
on conflict (id) do update
  set role = 'manager', store_id = null, name = excluded.name;

-- check it worked — should return one row, role 'manager'
select p.username, p.name, p.role, coalesce(p.store_id,'ALL STORES') as store
from public.profiles p
join auth.users u on u.id = p.id
where u.email = 'bradley@chase.local';
