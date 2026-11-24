-- requires: 034_mcp_sql.sql (pk_mcp_member, pk_mcp_admin), pk_reader
-- The news watch's archive: every article, official text, report and paper the hourly collection found
-- (scripts/fetch_news.py writes data/news.json and upserts here), and the past ones taken back from the git history of
-- data/news.json. Title, outlet, date, link, subjects, theme and the outlet's public summary (300 characters) only:
-- never an article's text. Read by the connector for Claude (sql_query, both levels) and the warehouse readers.

create schema if not exists news;
create table if not exists news.article (
  link        text primary key,
  title       text not null,
  source      text,
  published   timestamptz,
  kind        text not null default 'article',   -- article, official, report, research
  tags        text[] not null default '{}',
  topics      text[] not null default '{}',      -- the article's own subjects (support, regulation, renewables, markets…)
  theme       text,                              -- official texts and reports: support, cee, tariffs, grid, renewables, market, gas, other
  countries   text[] not null default '{}',
  summary     text check (summary is null or length(summary) <= 300),
  n_outlets   integer not null default 1,        -- outlets covering the same story
  first_seen  timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(source, ''))) stored
);
create index if not exists news_article_published on news.article (published desc);
create index if not exists news_article_tsv on news.article using gin (tsv);
create index if not exists news_article_topics on news.article using gin (topics);
comment on table news.article is 'News watch archive: titles, links, subjects and public summaries of the collected articles (never their text).';

grant usage on schema news to pk_reader, pk_mcp_member, pk_mcp_admin;
grant select on news.article to pk_reader, pk_mcp_member, pk_mcp_admin;

-- the connector's SQL may now read the news schema too (mcp_schema lists it)
create or replace function mcp.run_member(q text) returns jsonb
language plpgsql security definer set search_path = analytics, market, meta, news as $$
declare r jsonb;
begin
  set local statement_timeout = '5s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 2000) t', q) into r;
  return r;
end $$;
create or replace function mcp.run_admin(q text) returns jsonb
language plpgsql security definer set search_path = analytics, market, meta, news, ops as $$
declare r jsonb;
begin
  set local statement_timeout = '5s';
  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) q limit 2000) t', q) into r;
  return r;
end $$;
alter function mcp.run_member(text) owner to pk_mcp_member;
alter function mcp.run_admin(text) owner to pk_mcp_admin;

create or replace function public.mcp_schema(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r mcp_token; who text;
begin
  select * into r from mcp_token where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('error', 'PowerKlock link not valid'); end if;
  who := case when mcp.level(r.user_id) = 'admin' then 'pk_mcp_admin' else 'pk_mcp_member' end;
  return (select jsonb_build_object('access', case when who = 'pk_mcp_admin' then 'full' else 'members (forward contracts excluded)' end,
    'note', 'news.article: the news archive (title, source, published, kind, topics, theme, summary, link); search it with tsv @@ plainto_tsquery(''simple'', ''words'') or title ilike',
    'tables', jsonb_agg(jsonb_build_object('table', t.s || '.' || t.n, 'kind', t.k, 'columns', t.cols) order by t.s, t.n))
    from (select c.table_schema s, c.table_name n, max(tb.table_type) k,
                 jsonb_agg(c.column_name || ' ' || c.data_type order by c.ordinal_position) cols
          from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
          where c.table_schema in ('analytics', 'market', 'meta', 'news', 'ops')
            and has_table_privilege(who, quote_ident(c.table_schema) || '.' || quote_ident(c.table_name), 'SELECT')
          group by 1, 2) t);
end $$;
revoke all on function public.mcp_schema(text) from public;
grant execute on function public.mcp_schema(text) to anon, authenticated;

-- the database's size, for the data watchdog (scripts/check_data_freshness.py warns above 85 % of the plan's 500 MB)
create or replace function public.db_size_mb() returns numeric
language sql stable security definer set search_path = public as $$ select round(pg_database_size(current_database()) / 1048576.0, 1) $$;
revoke all on function public.db_size_mb() from public, anon;
