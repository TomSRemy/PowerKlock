-- requires: auth, 017_team_access.sql, 021_news_personalize.sql, 022_account_access.sql
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 023 · "Posts à lire": LinkedIn posts pasted by hand
-- LinkedIn has no public feed and forbids automated collection, so a
-- reader pastes the link of a post worth reading (share › copy link),
-- with its author and a one-line note. Only the link, the author's name
-- and the note are kept, never the post's text. Approved accounts read
-- and add; a post is removed by whoever added it or by the admin.
-- The team's votes (public.news_vote, by link) pick the week's best
-- posts for the Monday digest (scripts/news_digest.py).
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_post (
  id         uuid primary key default gen_random_uuid(),
  url        text not null unique check (url ~ '^https://([a-z]+\.)?linkedin\.com/' and length(url) <= 600),
  author     text check (author is null or length(author) <= 80),
  note       text check (note is null or length(note) <= 200),
  added_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.news_post enable row level security;
drop policy if exists "news posts: approved read" on public.news_post;
create policy "news posts: approved read" on public.news_post
  for select to authenticated using (public.is_approved() or public.is_team());
drop policy if exists "news posts: approved add" on public.news_post;
create policy "news posts: approved add" on public.news_post
  for insert to authenticated with check ((public.is_approved() or public.is_team()) and added_by = auth.uid());
drop policy if exists "news posts: remove own or admin" on public.news_post;
create policy "news posts: remove own or admin" on public.news_post
  for delete to authenticated using (added_by = auth.uid() or public.is_news_admin());
grant select, insert, delete on public.news_post to authenticated;
comment on table public.news_post is 'LinkedIn posts pasted by readers (link, author, note; never the text), voted through public.news_vote.';
