-- ============================================================
--  Chase — close the self-registration gap.
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--
--  Why: "Allow new users to sign up" has to stay ON, because the
--  Team tab creates consultants by signing them up. But the original
--  rule also let anyone who signed up write their OWN profile row —
--  including role 'manager'. Only a manager should ever create a
--  profile, so that is all we allow now.
--
--  The first manager (bradley) was created straight from the SQL
--  editor, which is not affected by these rules, so nothing breaks.
-- ============================================================

-- ---------- who may create a person ----------
-- before: (id = auth.uid() or is_manager())   <- the gap
-- after : a manager, creating someone in a store they are allowed to see
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert to authenticated
  with check (public.is_manager() and public.can_see(store_id));

-- ---------- who may change a person ----------
-- you may still edit yourself, but you may not change your own role
-- or move yourself to another store: only a manager can do that.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_manager() and public.can_see(store_id));

-- ---------- sanity check ----------
-- Should list exactly the four policies below, and nothing else.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by policyname;
-- expected:
--   profiles_delete  DELETE
--   profiles_read    SELECT
--   profiles_update  UPDATE
--   profiles_write   INSERT

-- ============================================================
--  Done. Add user in the Team tab still works exactly as before,
--  but a stranger who signs up now lands with no profile at all:
--  no store, no customers, nothing to see.
-- ============================================================
