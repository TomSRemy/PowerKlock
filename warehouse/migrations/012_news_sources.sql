-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 012 · news sources added from the site (Intelligence › News)
-- A signed-in user adds an RSS / Atom feed or a press search; every
-- signed-in user sees the list, only its author can remove a row.
-- scripts/fetch_news.py (GitHub Actions, database owner role) reads the
-- active rows next to config/news_sources.json at each news run.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_source (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('feed', 'search')),
  name        text not null check (length(name) between 1 and 80),
  url         text check (url is null or url ~ '^https?://'),     -- feed only
  query       text check (query is null or length(query) <= 200),  -- search only
  tags        text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check ((kind = 'feed' and url is not null) or (kind = 'search' and query is not null))
);

alter table public.news_source enable row level security;

drop policy if exists "news sources: read" on public.news_source;
create policy "news sources: read" on public.news_source
  for select to authenticated using (true);
drop policy if exists "news sources: add" on public.news_source;
create policy "news sources: add" on public.news_source
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "news sources: remove own" on public.news_source;
create policy "news sources: remove own" on public.news_source
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, delete on public.news_source to authenticated;

comment on table public.news_source is 'News sources added from the site (feeds and press searches), read by scripts/fetch_news.py at each run.';
