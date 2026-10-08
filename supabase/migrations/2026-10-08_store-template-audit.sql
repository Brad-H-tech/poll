-- Remember who last changed a store's WhatsApp message, and when, so head office
-- can see at a glance which stores have customised it. Safe to run more than once.
alter table public.stores
  add column if not exists wa_tpl_by text        not null default '',
  add column if not exists wa_tpl_at timestamptz;
