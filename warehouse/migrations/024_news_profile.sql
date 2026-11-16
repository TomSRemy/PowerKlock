-- requires: auth, 017_team_access.sql, 021_news_personalize.sql, 022_account_access.sql
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 024 · Each reader's newsletter profile
-- The reading profiles, one or several (config/news_profiles.json:
-- regulatory, legal, origination, markets, commercial), words to leave out, and whether the morning newsletter is e-mailed: every
-- weekday, on Monday only, or never; to the account's address or to
-- another one. Each reader reads and writes only their own row; the
-- news admin reads all of them. scripts/morning_mail.py sends each
-- reader the edition of their profile (scripts/news_letter.py), with the
-- articles matching their own keywords (public.news_keyword, 021).
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.news_profile (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  profiles   text[] not null default '{origination}'
             check (cardinality(profiles) between 1 and 5 and profiles <@ array['regulatory', 'legal', 'origination', 'markets', 'commercial']),
  exclude    text[] not null default '{}' check (cardinality(exclude) <= 25),
  email_freq text not null default 'never' check (email_freq in ('daily', 'monday', 'never')),
  email_to   text check (email_to is null or (length(email_to) <= 200 and email_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  updated_at timestamptz not null default now()
);
alter table public.news_profile enable row level security;
drop policy if exists "news profile: own read" on public.news_profile;
create policy "news profile: own read" on public.news_profile
  for select to authenticated using (user_id = auth.uid() or public.is_news_admin());
drop policy if exists "news profile: own write" on public.news_profile;
create policy "news profile: own write" on public.news_profile
  for insert to authenticated with check (user_id = auth.uid() and (public.is_approved() or public.is_team()));
drop policy if exists "news profile: own update" on public.news_profile;
create policy "news profile: own update" on public.news_profile
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "news profile: own delete" on public.news_profile;
create policy "news profile: own delete" on public.news_profile
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.news_profile to authenticated;
comment on table public.news_profile is 'Each reader''s newsletter profile, words to leave out and e-mail choice (scripts/morning_mail.py).';
