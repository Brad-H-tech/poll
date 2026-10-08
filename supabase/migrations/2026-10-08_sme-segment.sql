-- Consumer and SME books live side by side: every base belongs to one segment, and
-- each store may have one ACTIVE base per segment. Walk-ins land in the segment's base.
alter table public.bases add column if not exists segment text not null default 'consumer';
alter table public.bases drop constraint if exists bases_segment_chk;
alter table public.bases add constraint bases_segment_chk check (segment in ('consumer', 'sme'));
drop index if exists public.bases_one_active_idx;
create unique index if not exists bases_one_active_idx on public.bases (store_id, segment) where active;

drop function if exists public.add_walkin(text, jsonb);
create or replace function public.add_walkin(p_store text, p_row jsonb, p_segment text default 'consumer') returns text
  language plpgsql security definer set search_path = public as $$
declare v_base uuid; v_acct text;
begin
  if not chase.can_see(p_store) then raise exception 'Not your store' using errcode = '42501'; end if;
  if p_segment not in ('consumer', 'sme') then raise exception 'Bad segment' using errcode = '22023'; end if;
  if jsonb_typeof(p_row) <> 'array' or jsonb_array_length(p_row) > 20
     or exists (select 1 from jsonb_array_elements(p_row) e where jsonb_typeof(e) in ('object', 'array')) then
    raise exception 'A walk-in is one row of plain cells' using errcode = '22023';
  end if;
  v_acct := coalesce(p_row->>3, '');
  if v_acct = '' or char_length(v_acct) > 40 then raise exception 'Bad account number' using errcode = '22023'; end if;
  select id into v_base from public.bases where store_id = p_store and segment = p_segment and active order by created_at desc limit 1;
  if v_base is null then raise exception 'Load a base first' using errcode = '22023'; end if;
  update public.bases set rows = rows || jsonb_build_array(p_row) where id = v_base;
  return v_acct;
end $$;
revoke execute on function public.add_walkin(text, jsonb, text) from public, anon;
grant  execute on function public.add_walkin(text, jsonb, text) to authenticated, service_role;
