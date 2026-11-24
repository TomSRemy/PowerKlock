-- requires: 033_mcp_token.sql, pk_reader (warehouse), 021_news_personalize.sql (news_admin)
-- SQL for the connector for Claude (workers/mcp, tools sql_query and warehouse_schema), with two levels of access:
--   members (any approved account): the market data of analytics, market and meta, without the forward contracts
--     (exchange settlements under licence, from a third-party cockpit: only the latest, through the forwards tool);
--   the owner (news admin): everything in analytics, market, meta and ops, forwards included.
-- Never the accounts' data: the queries run as two NOLOGIN roles that can read nothing in public, auth or storage.
-- One SELECT (or WITH) query, 5 seconds, 2,000 rows at most.

create schema if not exists mcp;
do $$ begin
  if not exists (select from pg_roles where rolname = 'pk_mcp_member') then create role pk_mcp_member nologin; end if;
  if not exists (select from pg_roles where rolname = 'pk_mcp_admin') then create role pk_mcp_admin nologin; end if;
end $$;
grant pk_mcp_member, pk_mcp_admin to postgres;   -- so the functions below can be given to them

grant usage on schema analytics, market, meta to pk_mcp_member, pk_mcp_admin;
grant usage on schema ops to pk_mcp_admin;
grant select on all tables in schema analytics, market, meta to pk_mcp_member;
revoke select on market.forward_contract_close, market.forward_month, market.forward_settlement,
  analytics.forward_curve, analytics.forward_curve_latest from pk_mcp_member;
grant select on all tables in schema analytics, market, meta, ops to pk_mcp_admin;
grant usage, create on schema mcp to pk_mcp_member, pk_mcp_admin;

-- the query itself, run with the rights of the restricted role that owns each function
create or replace function mcp.run_member(q text) returns jsonb
language plpgsql security definer set search_path = analytics, market, meta as $$
declare r jsonb;
begin
  set local statement_timeout = '5s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 2000) t', q) into r;
  return r;
end $$;
create or replace function mcp.run_admin(q text) returns jsonb
language plpgsql security definer set search_path = analytics, market, meta, ops as $$
declare r jsonb;
begin
  set local statement_timeout = '5s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 2000) t', q) into r;
  return r;
end $$;
alter function mcp.run_member(text) owner to pk_mcp_member;
alter function mcp.run_admin(text) owner to pk_mcp_admin;
revoke all on function mcp.run_member(text) from public;
revoke all on function mcp.run_admin(text) from public;
grant execute on function mcp.run_member(text), mcp.run_admin(text) to postgres;

-- the owner (news admin) gets everything; any other approved account, the members' access
create or replace function mcp.level(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from news_admin a join auth.users u on lower(u.email) = lower(a.email) where u.id = p_user) then 'admin' else 'member' end
$$;
revoke all on function mcp.level(uuid) from public;

-- the Worker's entry: a personal link, one SELECT query
create or replace function public.mcp_sql(p_token text, p_query text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r mcp_token; lvl text; q text := btrim(coalesce(p_query, ''));
begin
  select * into r from mcp_token where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('error', 'PowerKlock link not valid'); end if;
  if not exists (select 1 from user_access where user_id = r.user_id and status = 'approved') then return jsonb_build_object('error', 'account not approved'); end if;
  q := regexp_replace(q, ';\s*$', '');
  if q !~* '^\s*(select|with)\s' or position(';' in q) > 0 or length(q) > 6000 then
    return jsonb_build_object('error', 'one SELECT (or WITH) query only, without ;');
  end if;
  if q ~* '(pg_|information_schema|\mpublic\.|\mauth\.|\mstorage\.|\mvault\.|\mextensions\.|\mnet\.|\mcron\.|\mmcp\.|graphql|realtime|supabase|dblink|\mcopy\M|lo_)' then
    return jsonb_build_object('error', 'only the tables and views of analytics, market and meta (see warehouse_schema)');
  end if;
  lvl := mcp.level(r.user_id);
  begin
    if lvl = 'admin' then return jsonb_build_object('access', 'full', 'rows', mcp.run_admin(q));
    else return jsonb_build_object('access', 'members (forward contracts excluded)', 'rows', mcp.run_member(q)); end if;
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

-- what the link may read: tables and views with their columns and, where the dictionary has it, what they mean
create or replace function public.mcp_schema(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r mcp_token; who text;
begin
  select * into r from mcp_token where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('error', 'PowerKlock link not valid'); end if;
  who := case when mcp.level(r.user_id) = 'admin' then 'pk_mcp_admin' else 'pk_mcp_member' end;
  return (select jsonb_build_object('access', case when who = 'pk_mcp_admin' then 'full' else 'members (forward contracts excluded)' end,
    'tables', jsonb_agg(jsonb_build_object('table', t.s || '.' || t.n, 'kind', t.k, 'columns', t.cols) order by t.s, t.n))
    from (select c.table_schema s, c.table_name n, max(tb.table_type) k,
                 jsonb_agg(c.column_name || ' ' || c.data_type order by c.ordinal_position) cols
          from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
          where c.table_schema in ('analytics', 'market', 'meta', 'ops')
            and has_table_privilege(who, quote_ident(c.table_schema) || '.' || quote_ident(c.table_name), 'SELECT')
          group by 1, 2) t);
end $$;

revoke all on function public.mcp_sql(text, text) from public;
revoke all on function public.mcp_schema(text) from public;
grant execute on function public.mcp_sql(text, text), public.mcp_schema(text) to anon, authenticated;
