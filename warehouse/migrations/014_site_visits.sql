-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 014 · who visits the site (audience measurement)
-- js/visits.js writes one row per page opened: a random visitor id kept
-- in the browser (no cookie, nothing shared with a third party), the page,
-- the referring site, phone or desktop, and the account when signed in.
-- Nobody reads the rows from the site: signed-in users see aggregates
-- through site_visit_stats(); the detail (who, when) is read in SQL.
-- Rows older than 13 months are deleted by site_visit_purge() (CNIL rule
-- for audience measurement exempt from consent).
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.site_visit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  visitor   text not null check (visitor ~ '^[0-9a-f]{16}$'),
  session   text not null check (session ~ '^[0-9a-f]{8}$'),
  page      text not null check (length(page) between 1 and 60),
  ref       text check (ref is null or length(ref) <= 120),
  device    text check (device in ('phone', 'tablet', 'desktop')),
  lang      text check (lang is null or length(lang) <= 12),
  user_id   uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists site_visit_at on public.site_visit (at);

alter table public.site_visit enable row level security;
drop policy if exists "visits: write" on public.site_visit;
create policy "visits: write" on public.site_visit
  for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());
grant insert on public.site_visit to anon, authenticated;
grant usage, select on sequence public.site_visit_id_seq to anon, authenticated;

-- aggregates for the Data status page (signed-in users only)
create or replace function public.site_visit_stats(days int default 30)
returns table (day date, visitors bigint, sessions bigint, views bigint, signed_in bigint)
language sql stable security definer set search_path = public as $$
  select (at at time zone 'Europe/Paris')::date, count(distinct visitor), count(distinct session), count(*), count(distinct user_id)
  from public.site_visit where at > now() - make_interval(days => least(greatest(days, 1), 400))
  group by 1 order by 1
$$;
create or replace function public.site_visit_pages(days int default 30)
returns table (page text, views bigint, visitors bigint)
language sql stable security definer set search_path = public as $$
  select page, count(*), count(distinct visitor) from public.site_visit
  where at > now() - make_interval(days => least(greatest(days, 1), 400)) group by 1 order by 2 desc limit 40
$$;
create or replace function public.site_visit_refs(days int default 30)
returns table (ref text, visitors bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(ref, '(direct)'), count(distinct visitor) from public.site_visit
  where at > now() - make_interval(days => least(greatest(days, 1), 400)) group by 1 order by 2 desc limit 15
$$;
revoke all on function public.site_visit_stats(int), public.site_visit_pages(int), public.site_visit_refs(int) from public, anon;
grant execute on function public.site_visit_stats(int), public.site_visit_pages(int), public.site_visit_refs(int) to authenticated;

create or replace function public.site_visit_purge() returns void
language sql security definer set search_path = public as $$
  delete from public.site_visit where at < now() - interval '13 months'
$$;
revoke all on function public.site_visit_purge() from public, anon, authenticated;

comment on table public.site_visit is 'Audience: one row per page opened (random browser id, page, referring site, device, account if signed in); kept 13 months.';
