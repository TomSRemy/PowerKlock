-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 004 · read-only access
-- pk_reader: SELECT on market / analytics / meta / ops, nothing else.
-- Grant it to a login role per person or tool, e.g.
--   create role analyst_jane login password '…' in role pk_reader;
-- The warehouse schemas are not exposed by the Supabase REST API unless
-- added under Settings → API → Exposed schemas.
-- ════════════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'pk_reader') then
    create role pk_reader nologin;
  end if;
end $$;

grant usage on schema market, analytics, meta, ops to pk_reader;
grant select on all tables in schema market, analytics, meta, ops to pk_reader;
grant execute on all functions in schema analytics to pk_reader;
alter default privileges in schema market, analytics, meta, ops grant select on tables to pk_reader;
alter default privileges in schema analytics grant execute on functions to pk_reader;
