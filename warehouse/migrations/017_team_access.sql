-- 017 · team-only access to the third-party market notes and the visit statistics
-- Signing in by e-mail link creates an account for any address, so "signed in" is not "in the team".
-- The ENGIE notes (third-party text) and the site's visit statistics are now read by the team only:
-- public.team_member lists the addresses (no client access to the table itself); is_team() checks
-- the signed-in user's e-mail against it.
-- Seeded with the accounts created before this migration; add someone with:
--   insert into public.team_member (email) values ('name@company.com');

create table if not exists public.team_member (
  email    text primary key,
  added_at timestamptz not null default now()
);
alter table public.team_member enable row level security;   -- no policy: invisible to the site's clients
revoke all on public.team_member from anon, authenticated;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_member where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_team() from public, anon;
grant execute on function public.is_team() to authenticated;

insert into public.team_member (email)
  select lower(email) from auth.users where email is not null and created_at < timestamptz '2026-10-24 08:00+00'
  on conflict do nothing;

-- market notes: team only
drop policy if exists "market notes: signed-in read" on public.market_note;
drop policy if exists "market notes: team read" on public.market_note;
create policy "market notes: team read" on public.market_note for select to authenticated using (public.is_team());

-- visit statistics: team only (the functions return nothing to anyone else)
create or replace function public.site_visit_stats(days int default 30)
returns table (day date, visitors bigint, sessions bigint, views bigint, signed_in bigint)
language sql stable security definer set search_path = public as $$
  select (at at time zone 'Europe/Paris')::date, count(distinct visitor), count(distinct session), count(*), count(distinct user_id)
  from public.site_visit where public.is_team() and at > now() - make_interval(days => least(greatest(days, 1), 400))
  group by 1 order by 1
$$;
create or replace function public.site_visit_pages(days int default 30)
returns table (page text, views bigint, visitors bigint)
language sql stable security definer set search_path = public as $$
  select page, count(*), count(distinct visitor) from public.site_visit
  where public.is_team() and at > now() - make_interval(days => least(greatest(days, 1), 400)) group by 1 order by 2 desc limit 40
$$;
create or replace function public.site_visit_refs(days int default 30)
returns table (ref text, visitors bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(ref, '(direct)'), count(distinct visitor) from public.site_visit
  where public.is_team() and at > now() - make_interval(days => least(greatest(days, 1), 400)) group by 1 order by 2 desc limit 15
$$;
