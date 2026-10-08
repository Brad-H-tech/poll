-- A per-store email template (subject + body), with who changed it last. Safe to re-run.
alter table public.stores
  add column if not exists email_subj   text not null default '',
  add column if not exists email_tpl    text not null default '',
  add column if not exists email_tpl_by text not null default '',
  add column if not exists email_tpl_at timestamptz;
