-- requires: auth, 021_news_personalize.sql, 022_account_access.sql
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 030 · « Mettre à la une »: the admin pins a story
-- The newsletter (scripts/news_letter.py) and the News page lead with the
-- story the admin pinned in the last 36 hours, for every profile; without
-- a pin, the lead story is chosen automatically. Only the news admin pins
-- and unpins; approved accounts see which story is pinned.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_pin (
  link       text primary key check (link ~ '^https?://' and length(link) <= 1000),
  title      text check (title is null or length(title) <= 400),
  pinned_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pinned_at  timestamptz not null default now()
);
alter table public.news_pin enable row level security;
drop policy if exists "news pin: read" on public.news_pin;
create policy "news pin: read" on public.news_pin
  for select to authenticated using (public.is_approved() or public.is_team() or public.is_news_admin());
drop policy if exists "news pin: admin pins" on public.news_pin;
create policy "news pin: admin pins" on public.news_pin
  for insert to authenticated with check (public.is_news_admin() and pinned_by = auth.uid());
drop policy if exists "news pin: admin unpins" on public.news_pin;
create policy "news pin: admin unpins" on public.news_pin
  for delete to authenticated using (public.is_news_admin());
grant select, insert, delete on public.news_pin to authenticated;
comment on table public.news_pin is 'Stories the admin put at the top (« Mettre à la une »), read by the newsletter and the News page.';
