-- requires: 030_news_pin.sql
-- The line shown under the pinned title: the admin pastes the article's public summary or writes one when pinning
-- (paid papers such as Les Echos refuse automated reading, so this is the only way to have a text under their title).
alter table public.news_pin add column if not exists note text check (note is null or length(note) <= 600);
comment on column public.news_pin.note is 'The line shown under the pinned title (the admin pastes the public summary or writes one), site and newsletter.';
drop policy if exists "news pin: admin edits" on public.news_pin;
create policy "news pin: admin edits" on public.news_pin
  for update to authenticated using (public.is_news_admin()) with check (public.is_news_admin());
-- a story pinned again after 36 hours: its row is refreshed (upsert)
grant update (note, title, pinned_at, link) on public.news_pin to authenticated;
