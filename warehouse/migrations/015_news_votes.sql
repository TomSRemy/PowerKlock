-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 015 · what readers think of each news article
-- js/news.js writes one row per article and reader (👍 = 1, 👎 = -1, the
-- latest vote wins). scripts/fetch_news.py reads them all at each run and
-- turns them into weights (sources, categories, title words) written to
-- data/news_prefs.json (no reader identity), which rank the next articles.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_vote (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  link       text not null check (length(link) between 8 and 600),
  title      text not null check (length(title) <= 300),
  source     text check (source is null or length(source) <= 120),
  tags       text[] not null default '{}',
  vote       smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (user_id, link)
);
alter table public.news_vote enable row level security;
drop policy if exists "news votes: own" on public.news_vote;
create policy "news votes: own" on public.news_vote
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.news_vote to authenticated;
grant usage, select on sequence public.news_vote_id_seq to authenticated;
comment on table public.news_vote is 'Reader feedback on news articles (+1 / -1), learnt into data/news_prefs.json by scripts/fetch_news.py.';
