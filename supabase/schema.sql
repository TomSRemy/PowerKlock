-- PowerKlock · My Dashboard storage
-- Run once in Supabase → SQL Editor.
-- One row per user holding all their dashboards (JSON). Row-level security
-- restricts every read and write to the signed-in owner.

create table if not exists public.user_dashboards (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.user_dashboards enable row level security;

drop policy if exists "own row: select" on public.user_dashboards;
drop policy if exists "own row: insert" on public.user_dashboards;
drop policy if exists "own row: update" on public.user_dashboards;
drop policy if exists "own row: delete" on public.user_dashboards;

create policy "own row: select" on public.user_dashboards
  for select using (auth.uid() = user_id);
create policy "own row: insert" on public.user_dashboards
  for insert with check (auth.uid() = user_id);
create policy "own row: update" on public.user_dashboards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own row: delete" on public.user_dashboards
  for delete using (auth.uid() = user_id);
