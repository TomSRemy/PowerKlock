-- requires: 022 (user_access, is_news_admin), 024 (site_note)
-- « Delete my account » (Account dialog, js/dashboard.js): an account removes itself and everything it holds. Deleting
-- the auth.users row cascades to every table that keeps a user's data (dashboards, alerts, newsletter settings,
-- keywords, votes, sources and posts it added, pins, Ask usage, the Claude connector link); site visits keep no link to
-- it (set null); the notes it sent lose its e-mail address. The site's administrators cannot delete themselves this way
-- (their pins and sources serve everyone): they write to the site's address instead.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); mail text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'signed out'); end if;
  if public.is_news_admin() then return jsonb_build_object('ok', false, 'reason', 'admin'); end if;
  select email into mail from auth.users where id = uid;
  update public.site_note set author_email = null where author_email is not null and lower(author_email) = lower(mail);
  delete from auth.users where id = uid;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
