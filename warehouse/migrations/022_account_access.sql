-- requires: auth, 017_team_access.sql, 021_news_personalize.sql (is_news_admin())
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 022 · accounts are validated by the owner, alerts can go
-- to any address
-- ────────────────────────────────────────────────────────────────────
-- user_access · one row per account, created by a trigger when someone
--   signs in for the first time (the e-mail link creates the account).
--   'pending' until the admin approves it; only an approved account sees
--   the full site, the others see the public Today page. Accounts that
--   existed before this migration are approved.
--   scripts/notify_signups.py e-mails the admins about each new pending
--   account once (notified_at).
--   Approve someone: update public.user_access set status = 'approved',
--   decided_at = now() where email = 'name@company.com';
-- alert_rule.email_to · where a rule's e-mails go; null = the account's
--   own address, as before.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.user_access (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  requested_at timestamptz not null default now(),
  decided_at  timestamptz,
  notified_at timestamptz
);
alter table public.user_access enable row level security;
drop policy if exists "user access: read own or admin" on public.user_access;
create policy "user access: read own or admin" on public.user_access
  for select to authenticated using (user_id = auth.uid() or public.is_news_admin());
drop policy if exists "user access: admin decides" on public.user_access;
create policy "user access: admin decides" on public.user_access
  for update to authenticated using (public.is_news_admin()) with check (public.is_news_admin());
grant select, update on public.user_access to authenticated;
comment on table public.user_access is 'Site accounts and whether the owner approved them (pending / approved / refused).';

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_access where user_id = auth.uid() and status = 'approved')
$$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

create or replace function public.user_access_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_access (user_id, email) values (new.id, lower(coalesce(new.email, '')))
    on conflict (user_id) do nothing;
  return new;
end
$$;
drop trigger if exists user_access_on_signup on auth.users;
create trigger user_access_on_signup after insert on auth.users
  for each row execute function public.user_access_on_signup();

insert into public.user_access (user_id, email, status, decided_at, notified_at)
  select id, lower(coalesce(email, '')), 'approved', now(), now() from auth.users
  on conflict (user_id) do nothing;

alter table public.alert_rule add column if not exists email_to text
  check (email_to is null or email_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
comment on column public.alert_rule.email_to is 'Address the alert e-mails go to; null = the account''s own address.';
