-- The reader's subjects (public.news_profile.interests) accept « support » (renewable support: CfDs, tenders, negative
-- prices), offered by the site's subject lists (js/news.js › PK_INTERESTS) and the first sign-in wizard but missing from
-- the check (the owner hit « news_profile_interests_check » on 25 Nov. 2026). Applied the same day.
alter table public.news_profile drop constraint if exists news_profile_interests_check;
alter table public.news_profile add constraint news_profile_interests_check
  check (interests <@ array['power', 'renewables', 'support', 'markets', 'regulation', 'gas', 'carbon', 'deal', 'build', 'geopolitics', 'report', 'assoc']);
