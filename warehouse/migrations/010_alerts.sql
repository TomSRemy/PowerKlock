-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 010 · user alerts (site accounts, public schema)
-- Each signed-in user owns their rules; row-level security restricts
-- reads and writes to the owner. The evaluator (scripts/alerts.py, run by
-- GitHub Actions with the database owner role) records each alert sent in
-- public.alert_event so it is never sent twice.
-- Needs Supabase's auth schema: skipped by sync.py on a plain PostgreSQL.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.alert_rule (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('neg_price', 'pp1', 'pp2', 'base_above', 'base_below')),
  zones       text[] not null default '{}',   -- bidding zones (FR, DE_LU…); PP alerts are France only
  min_hours   real,                           -- neg_price: at least this many negative hours (default 1)
  threshold   real,                           -- base_above / base_below: €/MWh
  email       boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists alert_rule_user on public.alert_rule (user_id);

create table if not exists public.alert_event (
  id          bigserial primary key,
  rule_id     uuid not null references public.alert_rule (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null,                  -- delivery day the alert is about
  zone        text not null default '',
  detail      text not null,
  sent_at     timestamptz,                    -- null = recorded, e-mail not sent (no mail server configured)
  created_at  timestamptz not null default now(),
  unique (rule_id, day, zone)
);

alter table public.alert_rule enable row level security;
alter table public.alert_event enable row level security;

drop policy if exists "own rules" on public.alert_rule;
create policy "own rules" on public.alert_rule
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own events: read" on public.alert_event;
create policy "own events: read" on public.alert_event
  for select using (auth.uid() = user_id);

grant select, insert, update, delete on public.alert_rule to authenticated;
grant select on public.alert_event to authenticated;

comment on table public.alert_rule is 'Site users'' alert rules (negative prices, PP1/PP2 days, baseload thresholds) — owner-only (RLS).';
comment on table public.alert_event is 'Alerts triggered per rule, delivery day and zone; sent_at set when the e-mail went out.';
