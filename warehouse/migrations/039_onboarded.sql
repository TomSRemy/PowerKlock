-- requires: 024 (news_profile)
-- The first sign-in (js/onboarding.js): its date once the reader has gone through it (or chose « Later »), so it shows once.
alter table public.news_profile add column if not exists onboarded_at timestamptz;
