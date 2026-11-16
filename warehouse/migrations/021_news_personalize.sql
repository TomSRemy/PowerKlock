-- requires: auth, 017_team_access.sql (is_team())
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 021 · personalised News: keywords synced to the account,
-- curated sections, and a per-person view the owner controls
-- ────────────────────────────────────────────────────────────────────
-- news_keyword   · "★ My keywords" synced to the account instead of this
--                  browser only; a keyword can be marked "team" to boost
--                  the ranking for every team member, not just its author.
-- news_section   · named presets ("Marchés FR/EU", "Régulation"…) built
--                  from the same tags the News page already filters on.
--                  Written by the admin only; read by everyone (a user
--                  with no restriction still sees the plain filter bar).
-- news_user_config · per person: which sections they see instead of the
--                  full filter bar, and whether the advanced bits (add a
--                  source, country/source filters) show at all. No row
--                  for someone = unrestricted, today's behaviour.
-- Both news_section and news_user_config are written by the admin only
-- (public.news_admin, seeded below with the earliest account — the
-- owner's), so showing a simpler tool to someone is a SQL insert, not a
-- new page to build.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.news_admin (
  email    text primary key,
  added_at timestamptz not null default now()
);
alter table public.news_admin enable row level security;   -- no policy: invisible to the site's clients
revoke all on public.news_admin from anon, authenticated;

create or replace function public.is_news_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.news_admin where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_news_admin() from public, anon;
grant execute on function public.is_news_admin() to authenticated;

insert into public.news_admin (email)
  select lower(email) from auth.users where email is not null order by created_at limit 1
  on conflict do nothing;

-- ── keywords, synced to the account ───────────────────────────────────
create table if not exists public.news_keyword (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword    text not null check (length(keyword) between 1 and 60),
  team       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, keyword)
);
alter table public.news_keyword enable row level security;
drop policy if exists "news keywords: read own and team" on public.news_keyword;
create policy "news keywords: read own and team" on public.news_keyword
  for select to authenticated using (user_id = auth.uid() or (team and public.is_team()));
drop policy if exists "news keywords: write own" on public.news_keyword;
create policy "news keywords: write own" on public.news_keyword
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.news_keyword to authenticated;
comment on table public.news_keyword is '"My keywords" on the News page, synced to the account; team = true boosts it for every team member.';

-- ── curated sections (admin-defined presets of the existing tags) ─────
create table if not exists public.news_section (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name       text not null check (length(name) between 1 and 60),
  tags       text[] not null default '{}',   -- any of js/news.js's filter tags (power, gas, deal, build…)
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.news_section enable row level security;
drop policy if exists "news sections: read" on public.news_section;
create policy "news sections: read" on public.news_section for select using (true);
drop policy if exists "news sections: admin write" on public.news_section;
create policy "news sections: admin write" on public.news_section
  for all to authenticated using (public.is_news_admin()) with check (public.is_news_admin());
grant select on public.news_section to anon, authenticated;
grant insert, update, delete on public.news_section to authenticated;
comment on table public.news_section is 'Admin-defined News presets (name + tags) offered instead of the full filter bar to a restricted user.';

-- ── per-person view, admin-controlled ──────────────────────────────────
create table if not exists public.news_user_config (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  visible_sections text[],             -- null = unrestricted (today's full filter bar); else section slugs, plus 'all'/'mine'/'movers'
  show_add_source  boolean not null default true,
  show_advanced    boolean not null default true,   -- country/source filters, France focus
  updated_at       timestamptz not null default now()
);
alter table public.news_user_config enable row level security;
drop policy if exists "news user config: read own or admin" on public.news_user_config;
create policy "news user config: read own or admin" on public.news_user_config
  for select to authenticated using (user_id = auth.uid() or public.is_news_admin());
drop policy if exists "news user config: admin write" on public.news_user_config;
create policy "news user config: admin write" on public.news_user_config
  for all to authenticated using (public.is_news_admin()) with check (public.is_news_admin());
grant select on public.news_user_config to authenticated;
grant insert, update, delete on public.news_user_config to authenticated;
comment on table public.news_user_config is 'Per-person News view set by the admin: which sections show instead of the full filter bar, and which advanced controls appear.';
