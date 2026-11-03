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


-- Shared dashboard links (#solo=<id>): a board snapshot anyone with the
-- link can read; only the holder of edit_token (kept in the creator's
-- browser, never shown) can republish it. Direct table writes are blocked
-- by RLS: all writes go through the two functions below, which check the
-- token themselves.

create table if not exists public.shared_boards (
  id         text primary key,
  edit_token text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shared_boards enable row level security;

drop policy if exists "shared board: public read" on public.shared_boards;
create policy "shared board: public read" on public.shared_boards
  for select using (true);

-- No insert/update/delete policies: default-deny for direct table access.

create or replace function public.create_shared_board(p_data jsonb)
returns table (id text, edit_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id text;
  new_token text;
begin
  loop
    new_id := encode(extensions.gen_random_bytes(7), 'hex');
    exit when not exists (select 1 from public.shared_boards s where s.id = new_id);
  end loop;
  new_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.shared_boards (id, edit_token, data) values (new_id, new_token, p_data);
  return query select new_id, new_token;
end;
$$;

create or replace function public.update_shared_board(p_id text, p_token text, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_boards
    set data = p_data, updated_at = now()
    where id = p_id and edit_token = p_token;
  return found;
end;
$$;

revoke all on function public.create_shared_board(jsonb) from public;
revoke all on function public.update_shared_board(text, text, jsonb) from public;
grant execute on function public.create_shared_board(jsonb) to anon, authenticated;
grant execute on function public.update_shared_board(text, text, jsonb) to anon, authenticated;


-- Alerts (rules and sent alerts): see warehouse/migrations/010_alerts.sql,
-- applied automatically by the warehouse sync (GitHub Actions).
