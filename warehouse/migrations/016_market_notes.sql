-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 016 · market notes received by e-mail (ENGIE Energy Market News…)
-- scripts/fetch_market_notes.py reads them from the team mailbox (IMAP) and
-- writes one row per note: date, subject and its sections (headline + points).
-- Third-party text: readable by signed-in users only, never in the public
-- repository or the public site files.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.market_note (
  id          bigserial primary key,
  source      text not null,
  note_date   date not null,
  subject     text not null,
  sections    jsonb not null default '[]',
  received_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (source, note_date, subject)
);
create index if not exists market_note_date on public.market_note (note_date desc);
alter table public.market_note enable row level security;
drop policy if exists "market notes: signed-in read" on public.market_note;
create policy "market notes: signed-in read" on public.market_note for select to authenticated using (true);
grant select on public.market_note to authenticated;
revoke all on public.market_note from anon;
comment on table public.market_note is 'Market notes received by e-mail (ENGIE Energy Market News), parsed by scripts/fetch_market_notes.py; signed-in users only.';
