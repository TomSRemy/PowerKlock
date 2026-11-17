-- requires: auth, 024_news_profile.sql
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 025 · « Électricité » among the subjects a reader ticks
-- The interests of public.news_profile (024) had renewables, markets,
-- regulation, gas… but not electricity itself (prices, grid, nuclear).
-- ════════════════════════════════════════════════════════════════════
alter table public.news_profile drop constraint if exists news_profile_interests_check;
alter table public.news_profile add constraint news_profile_interests_check
  check (interests <@ array['power', 'renewables', 'markets', 'regulation', 'gas', 'carbon', 'deal', 'build', 'geopolitics', 'report', 'assoc']);
