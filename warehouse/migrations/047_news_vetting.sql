-- requires: auth, 021_news_personalize.sql (is_news_admin())
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 047 · the owner's level for a news outlet (Veille › Sources)
-- The morning task sorts the new outlets of the press searches from their
-- name and address (data/news_vetting.json); the news admin can change any
-- of them on the site. scripts/fetch_news.py reads these rows first: the
-- owner's choice is never changed by the task.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_vetting (
  outlet  text primary key check (length(outlet) between 1 and 120),
  level   text not null check (level in ('press', 'state', 'activist', 'commercial', 'association', 'unverified')),
  set_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  set_at  timestamptz not null default now()
);
alter table public.news_vetting enable row level security;
drop policy if exists "news vetting: admin reads" on public.news_vetting;
create policy "news vetting: admin reads" on public.news_vetting
  for select to authenticated using (public.is_news_admin());
drop policy if exists "news vetting: admin sets" on public.news_vetting;
create policy "news vetting: admin sets" on public.news_vetting
  for insert to authenticated with check (public.is_news_admin() and set_by = auth.uid());
drop policy if exists "news vetting: admin changes" on public.news_vetting;
create policy "news vetting: admin changes" on public.news_vetting
  for update to authenticated using (public.is_news_admin()) with check (public.is_news_admin() and set_by = auth.uid());
drop policy if exists "news vetting: admin removes" on public.news_vetting;
create policy "news vetting: admin removes" on public.news_vetting
  for delete to authenticated using (public.is_news_admin());
grant select, insert, update, delete on public.news_vetting to authenticated;
comment on table public.news_vetting is 'The news admin''s level for an outlet of the press searches, read first by scripts/fetch_news.py.';
