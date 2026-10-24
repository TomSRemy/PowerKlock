-- 019 · notes taken on the site (js/notes.js): a team member writes a note on any page, attached to a chart,
-- table or text; scripts/notes_sync.py copies them for Claude and writes back its replies (status, reply).
-- Team only: read and write need is_team() (017); a note is deleted by its author only.

create table if not exists public.site_note (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  author       uuid default auth.uid(),
  author_email text default (auth.jwt() ->> 'email'),
  route        text,              -- address of the page (#renewables/capture)
  page         text,              -- page as shown (Renewables › Capture & cannibalisation)
  tab          text,              -- view tab open (Cannibalisation)
  target_id    text,              -- element the note is attached to (canvas or section id)
  target_label text,              -- its title as shown
  settings     jsonb,             -- selectors of the page (zone, year, window…)
  body         text not null check (char_length(body) between 1 and 4000),
  status       text not null default 'open' check (status in ('open', 'done', 'wontfix')),
  reply        text,
  done_at      timestamptz
);
alter table public.site_note enable row level security;
revoke all on public.site_note from anon;
grant select, insert, update, delete on public.site_note to authenticated;

drop policy if exists "site notes: team read" on public.site_note;
create policy "site notes: team read" on public.site_note for select to authenticated using (public.is_team());
drop policy if exists "site notes: team write" on public.site_note;
create policy "site notes: team write" on public.site_note for insert to authenticated with check (public.is_team() and author = auth.uid());
drop policy if exists "site notes: team update" on public.site_note;
create policy "site notes: team update" on public.site_note for update to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists "site notes: author delete" on public.site_note;
create policy "site notes: author delete" on public.site_note for delete to authenticated using (author = auth.uid());

create index if not exists site_note_route on public.site_note (route, created_at desc);
