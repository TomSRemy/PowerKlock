-- requires: 024_news_profile.sql
-- Reading profiles (public.news_profile.profiles) are optional: since the owner's choice of 24 Nov. 2026 the reader picks
-- subjects (interests), and the site saves an empty list of profiles (js/onboarding.js, js/news.js › _nlSave). The check
-- still asked for at least one, so the first sign-in card and the newsletter settings failed with
-- « news_profile_profiles_check » (the owner, 26 Nov. 2026). scripts/morning_mail.py already handles an empty list
-- (every profile's stories, the reader's subjects first). Applied the same day.
alter table public.news_profile drop constraint if exists news_profile_profiles_check;
alter table public.news_profile add constraint news_profile_profiles_check
  check (cardinality(profiles) <= 6 and profiles <@ array['regulatory', 'legal', 'supplier', 'origination', 'markets', 'commercial']);
