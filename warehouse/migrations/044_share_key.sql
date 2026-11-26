-- requires: 022_account_access.sql (is_approved(), user_access), 023_news_posts.sql (news_post), pgcrypto (schema extensions)
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 044 · the send key: a LinkedIn post sent without leaving LinkedIn
-- The owner's wish (26 Nov. 2026): from the phone's share sheet (an iPhone shortcut, an Android app), a LinkedIn post
-- reaches News › LinkedIn posts in the background. The shortcut sends the post's link and a note with a personal key to
-- the Ask Worker (workers/ask, POST /share), which calls share_post() with the publishable key.
-- The key is made here and shown once; only its SHA-256 is kept. It can do one thing: add a LinkedIn post (link, author
-- taken from the link, note; never the post's text) in its owner's name, 50 a day. A new key replaces the old one; the
-- key stops when the account is closed or deleted.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.share_key (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  key_hash   text not null unique,
  created_at timestamptz not null default now(),
  day        date,
  sent       integer not null default 0
);
alter table public.share_key enable row level security;   -- no policy: read and written only by the functions below
comment on table public.share_key is 'Personal send keys (LinkedIn post from the phone''s share sheet): SHA-256 of the key only, posts sent today.';

-- a new key for the signed-in approved account (returned once, never stored in clear)
create or replace function public.share_key_new() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'not approved'; end if;
  t := 'pks_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into share_key (user_id, key_hash) values (auth.uid(), encode(extensions.digest(t, 'sha256'), 'hex'))
    on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now(), day = null, sent = 0;
  return t;
end $$;

-- whether the signed-in account has a key (to show « active since … » without the key)
create or replace function public.share_key_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('active', true, 'created_at', created_at) from share_key where user_id = auth.uid()), jsonb_build_object('active', false))
$$;

-- remove the signed-in account's key
create or replace function public.share_key_revoke() returns void
language sql security definer set search_path = public as $$
  delete from share_key where user_id = auth.uid()
$$;

-- the Worker's call: a valid key of an approved account, under 50 posts a day; adds the post in the key owner's name
create or replace function public.share_post(p_key text, p_url text, p_author text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r share_key; d date := (now() at time zone 'Europe/Paris')::date; u text;
begin
  select * into r from share_key where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown key'); end if;
  if not exists (select 1 from user_access where user_id = r.user_id and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not approved');
  end if;
  if r.day = d and r.sent >= 50 then return jsonb_build_object('ok', false, 'reason', 'quota'); end if;
  u := split_part(split_part(trim(coalesce(p_url, '')), '?', 1), '#', 1);   -- the link without its tracking parameters
  if u !~ '^https://([a-z]+\.)?linkedin\.com/' or length(u) > 600 then return jsonb_build_object('ok', false, 'reason', 'not a linkedin link'); end if;
  update share_key set day = d, sent = case when r.day = d then r.sent + 1 else 1 end where user_id = r.user_id;
  if exists (select 1 from news_post where url = u) then return jsonb_build_object('ok', true, 'already', true); end if;
  insert into news_post (url, author, note, added_by)
    values (u, nullif(left(trim(coalesce(p_author, '')), 80), ''), nullif(left(trim(coalesce(p_note, '')), 200), ''), r.user_id);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.share_key_new() from public, anon;
revoke all on function public.share_key_status() from public, anon;
revoke all on function public.share_key_revoke() from public, anon;
grant execute on function public.share_key_new() to authenticated;
grant execute on function public.share_key_status() to authenticated;
grant execute on function public.share_key_revoke() to authenticated;
revoke all on function public.share_post(text, text, text, text) from public;
grant execute on function public.share_post(text, text, text, text) to anon, authenticated;   -- the Worker calls it with the publishable key
