-- requires: auth, 022_account_access.sql
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 026 · What each approved account sees
-- The admin chooses, per account, the menu sections it gets (null = the
-- whole site). Today stays for everyone. The site hides the other
-- sections and sends their addresses back to Today (js/gate.js). It keeps
-- the site simple for each reader; it is not a lock: the data files stay
-- public, as before (they are the site's API).
-- ════════════════════════════════════════════════════════════════════
alter table public.user_access add column if not exists sections text[];
alter table public.user_access drop constraint if exists user_access_sections_check;
alter table public.user_access add constraint user_access_sections_check
  check (sections is null or sections <@ array['dashboards', 'markets', 'renewables', 'power-system', 'tools', 'intelligence', 'games']);
comment on column public.user_access.sections is 'Menu sections this account sees (null = all); Today is always shown.';
