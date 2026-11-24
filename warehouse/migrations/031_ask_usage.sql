-- requires: 022_account_access.sql (is_approved())
-- « Ask PowerKlock » (News › Ask, workers/ask): how many questions each approved account asked today (Paris day).
-- Only counts, never the questions. The Worker calls ask_take() with the reader's own token: an account that is not
-- approved, or that already asked 15 questions today, is refused; 220 questions a day in all (the free AI allocation).

create table if not exists public.ask_usage (
  day     date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  n       integer not null default 0,
  primary key (day, user_id)
);
alter table public.ask_usage enable row level security;   -- no policy: read and written only by the functions below
comment on table public.ask_usage is 'Questions asked to Ask PowerKlock per account and Paris day (counts only).';

create or replace function public.ask_take() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Europe/Paris')::date;
  mine integer; total integer;
begin
  if auth.uid() is null or not public.is_approved() then
    return jsonb_build_object('ok', false, 'reason', 'not approved');
  end if;
  select coalesce(sum(n), 0) into total from ask_usage where day = d;
  if total >= 220 then return jsonb_build_object('ok', false, 'reason', 'day', 'left', 0); end if;
  select coalesce(max(n), 0) into mine from ask_usage where day = d and user_id = auth.uid();
  if mine >= 15 then return jsonb_build_object('ok', false, 'reason', 'quota', 'left', 0); end if;
  insert into ask_usage (day, user_id, n) values (d, auth.uid(), 1)
    on conflict (day, user_id) do update set n = ask_usage.n + 1 returning n into mine;
  return jsonb_build_object('ok', true, 'left', 15 - mine, 'total', total + 1);
end $$;

create or replace function public.ask_left() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', public.is_approved(), 'left',
    greatest(0, 15 - coalesce((select n from ask_usage where day = (now() at time zone 'Europe/Paris')::date and user_id = auth.uid()), 0)))
$$;

revoke all on function public.ask_take() from public, anon;
revoke all on function public.ask_left() from public, anon;
grant execute on function public.ask_take() to authenticated;
grant execute on function public.ask_left() to authenticated;
