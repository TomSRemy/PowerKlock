-- requires: 023_news_posts.sql (news_post), 044_share_key.sql (share_key, share_post)
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 045 · a LinkedIn post's public text
-- The owner's wish (27 Nov. 2026): a post sent from the phone shows its text, with no AI and no quota. The iPhone
-- shortcut opens the post while sharing (as a link preview does) and sends the page; the Worker keeps only its public
-- description (og:description, what LinkedIn gives link previews) and the author's name from its title. The server
-- never opens LinkedIn itself.
-- ════════════════════════════════════════════════════════════════════
alter table public.news_post add column if not exists description text check (description is null or length(description) <= 1500);
comment on table public.news_post is 'LinkedIn posts shared by readers: link, author, note, and the public description LinkedIn gives link previews (sent by the owner''s phone when sharing).';

drop function if exists public.share_post(text, text, text, text);
create or replace function public.share_post(p_key text, p_url text, p_author text default null, p_note text default null, p_desc text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r share_key; d date := (now() at time zone 'Europe/Paris')::date; u text; n integer;
begin
  select * into r from share_key where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown key'); end if;
  if not exists (select 1 from user_access where user_id = r.user_id and status = 'approved') then
    return jsonb_build_object('ok', false, 'reason', 'not approved');
  end if;
  if r.day = d and r.sent >= 50 then return jsonb_build_object('ok', false, 'reason', 'quota'); end if;
  u := split_part(split_part(trim(coalesce(p_url, '')), '?', 1), '#', 1);   -- the link without its tracking parameters
  if u !~ '^https://([a-z]+\.)?linkedin\.com/' or length(u) > 600 then return jsonb_build_object('ok', false, 'reason', 'not a linkedin link'); end if;
  update share_key set day = d, sent = case when r.day = d then r.sent + 1 else 1 end where user_id = r.user_id;
  if exists (select 1 from news_post where url = u) then
    -- shared again: fill what was missing (the text, a better author name, a note)
    update news_post set description = coalesce(description, nullif(left(trim(coalesce(p_desc, '')), 1500), '')),
        author = coalesce(nullif(left(trim(coalesce(p_author, '')), 80), ''), author),
        note = coalesce(note, nullif(left(trim(coalesce(p_note, '')), 200), ''))
      where url = u and (description is null and nullif(trim(coalesce(p_desc, '')), '') is not null
                         or note is null and nullif(trim(coalesce(p_note, '')), '') is not null);
    get diagnostics n = row_count;
    return jsonb_build_object('ok', true, 'already', true, 'updated', n > 0);
  end if;
  insert into news_post (url, author, note, description, added_by)
    values (u, nullif(left(trim(coalesce(p_author, '')), 80), ''), nullif(left(trim(coalesce(p_note, '')), 200), ''),
            nullif(left(trim(coalesce(p_desc, '')), 1500), ''), r.user_id);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.share_post(text, text, text, text, text) from public;
grant execute on function public.share_post(text, text, text, text, text) to anon, authenticated;   -- the Worker calls it with the publishable key
