-- requires: 045_news_post_text.sql (news_post.description, share_post)
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 046 · a LinkedIn post's preview image
-- The owner's wish (27 Nov. 2026): a post sent from the phone shows its image, as a link preview does (and the post
-- gets the click). Only the address LinkedIn gives link previews (og:image on media.licdn.com) is kept, not the image:
-- LinkedIn's addresses expire after some weeks, and the site then hides the picture.
-- ════════════════════════════════════════════════════════════════════
alter table public.news_post add column if not exists image text check (image is null or (image ~ '^https://(media|static)\.licdn\.com/' and length(image) <= 1000));

drop function if exists public.share_post(text, text, text, text, text);
create or replace function public.share_post(p_key text, p_url text, p_author text default null, p_note text default null, p_desc text default null, p_image text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r share_key; d date := (now() at time zone 'Europe/Paris')::date; u text; n integer;
  img text := case when p_image ~ '^https://(media|static)\.licdn\.com/' and length(p_image) <= 1000 then p_image end;
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
    -- shared again: fill what was missing (the text, a better author name, a note, a fresh image address)
    update news_post set description = coalesce(description, nullif(left(trim(coalesce(p_desc, '')), 1500), '')),
        author = coalesce(nullif(left(trim(coalesce(p_author, '')), 80), ''), author),
        note = coalesce(note, nullif(left(trim(coalesce(p_note, '')), 200), '')),
        image = coalesce(img, image)
      where url = u and (description is null and nullif(trim(coalesce(p_desc, '')), '') is not null
                         or note is null and nullif(trim(coalesce(p_note, '')), '') is not null
                         or img is not null and img is distinct from image);
    get diagnostics n = row_count;
    return jsonb_build_object('ok', true, 'already', true, 'updated', n > 0);
  end if;
  insert into news_post (url, author, note, description, image, added_by)
    values (u, nullif(left(trim(coalesce(p_author, '')), 80), ''), nullif(left(trim(coalesce(p_note, '')), 200), ''),
            nullif(left(trim(coalesce(p_desc, '')), 1500), ''), img, r.user_id);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.share_post(text, text, text, text, text, text) from public;
grant execute on function public.share_post(text, text, text, text, text, text) to anon, authenticated;   -- the Worker calls it with the publishable key
