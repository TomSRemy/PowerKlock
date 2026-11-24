-- requires: 022_account_access.sql (is_approved()), pgcrypto (schema extensions)
-- The PowerKlock connector for Claude (workers/mcp): each approved account gets a personal link
-- https://powerklock-mcp.<…>.workers.dev/mcp/<token>, made here and shown once; only its SHA-256 is kept.
-- A new link replaces the old one (revoked); the account's link stops when the account is closed.
-- mcp_check() (called by the Worker with the publishable key) answers whether a token is valid and counts its calls:
-- 400 tool calls a day per account.

create table if not exists public.mcp_token (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  day        date,
  calls      integer not null default 0
);
alter table public.mcp_token enable row level security;   -- no policy: read and written only by the functions below
comment on table public.mcp_token is 'Personal links of the PowerKlock connector for Claude: SHA-256 of the token only, calls of the day.';

-- a new personal link for the signed-in approved account (the token is returned once, never stored in clear)
create or replace function public.mcp_new() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'not approved'; end if;
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into mcp_token (user_id, token_hash) values (auth.uid(), encode(extensions.digest(t, 'sha256'), 'hex'))
    on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), day = null, calls = 0;
  return t;
end $$;

-- whether the signed-in account has a link (to show « active since … » without the token)
create or replace function public.mcp_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('active', true, 'created_at', created_at) from mcp_token where user_id = auth.uid()), jsonb_build_object('active', false))
$$;

-- remove the signed-in account's link
create or replace function public.mcp_revoke() returns void
language sql security definer set search_path = public as $$
  delete from mcp_token where user_id = auth.uid()
$$;

-- the Worker's check: a valid token of an approved account, under its daily calls; counts the call
create or replace function public.mcp_check(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r mcp_token; d date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into r from mcp_token where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if not exists (select 1 from user_access where user_id = r.user_id and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not approved');
  end if;
  if r.day = d and r.calls >= 400 then return jsonb_build_object('ok', false, 'reason', 'quota'); end if;
  update mcp_token set day = d, calls = case when r.day = d then r.calls + 1 else 1 end where user_id = r.user_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.mcp_new() from public, anon;
revoke all on function public.mcp_status() from public, anon;
revoke all on function public.mcp_revoke() from public, anon;
grant execute on function public.mcp_new() to authenticated;
grant execute on function public.mcp_status() to authenticated;
grant execute on function public.mcp_revoke() to authenticated;
revoke all on function public.mcp_check(text) from public;
grant execute on function public.mcp_check(text) to anon, authenticated;   -- the Worker holds no session, only the token
