-- 018 · a ceiling on anonymous page-view rows (public.site_visit accepts inserts from anyone):
-- at most 300 rows per visitor id per day and 20,000 rows a day in all, so a script cannot fill
-- the free database. Extra rows are dropped silently.

create or replace function public.site_visit_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.site_visit where visitor = new.visitor and at > now() - interval '1 day') >= 300
     or (select count(*) from public.site_visit where at > now() - interval '1 day') >= 20000 then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.site_visit_limit() from public, anon, authenticated;

drop trigger if exists site_visit_limit on public.site_visit;
create trigger site_visit_limit before insert on public.site_visit for each row execute function public.site_visit_limit();
create index if not exists site_visit_visitor_at on public.site_visit (visitor, at);
