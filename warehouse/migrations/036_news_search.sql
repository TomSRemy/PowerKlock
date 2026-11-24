-- requires: 035_news_article.sql, 031_ask_usage.sql
-- News › Archives: the search engine on the whole archive (news.article), for approved accounts, without AI so without
-- a limit; Ask PowerKlock (workers/ask) uses it too, so its answers reach past articles. 30 questions a day per account
-- for Ask (the day's total stays 220, the free AI allocation).

-- the words of a query as a prefix search (« négatif » finds « négatifs »), any accent as typed
create or replace function news.query(q text) returns tsquery
language sql immutable as $$
  select nullif(string_agg(quote_literal(w) || ':*', ' & '), '')::tsquery
  from (select lower(w) w from regexp_split_to_table(coalesce(q, ''), '[^[:alnum:]]+') w where length(w) > 1) x
$$;

create or replace function public.news_search(p_query text default null, p_kind text default null, p_topic text default null,
  p_theme text default null, p_source text default null, p_since date default null, p_until date default null,
  p_order text default 'relevance', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = news, public as $$
declare tq tsquery := news.query(p_query); res jsonb; n int;
begin
  if not public.is_approved() then return jsonb_build_object('error', 'not approved'); end if;
  with f as (
    select a.*, case when tq is null then 0 else ts_rank(a.tsv, tq) end as rk from news.article a
    where (tq is null or a.tsv @@ tq) and (p_kind is null or a.kind = p_kind) and (p_topic is null or p_topic = any(a.topics))
      and (p_theme is null or a.theme = p_theme) and (p_source is null or a.source = p_source)
      and (p_since is null or a.published >= p_since) and (p_until is null or a.published < p_until + 1))
  select (select count(*) from f), coalesce(jsonb_agg(jsonb_build_object('title', title, 'source', source, 'date', to_char(published at time zone 'Europe/Paris', 'YYYY-MM-DD'),
           'kind', kind, 'topics', topics, 'theme', theme, 'summary', summary, 'link', link, 'n_outlets', n_outlets)), '[]')
    into n, res
    from (select * from f order by case when p_order = 'date' then 0 else rk end desc, published desc nulls last
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) s;
  return jsonb_build_object('total', n, 'items', res);
end $$;
revoke all on function public.news_search(text, text, text, text, text, date, date, text, int, int) from public, anon;
grant execute on function public.news_search(text, text, text, text, text, date, date, text, int, int) to authenticated;

-- Ask PowerKlock: 30 questions a day per account (was 15), 220 in all
create or replace function public.ask_take() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Europe/Paris')::date;
  mine integer; total integer;
begin
  if auth.uid() is null or not public.is_approved() then
    return jsonb_build_object('ok', false, 'reason', 'not approved');
  end if;
  select coalesce(sum(n), 0) into total from ask_usage where day = d;
  if total >= 220 then return jsonb_build_object('ok', false, 'reason', 'day', 'left', 0); end if;
  select coalesce(max(n), 0) into mine from ask_usage where day = d and user_id = auth.uid();
  if mine >= 30 then return jsonb_build_object('ok', false, 'reason', 'quota', 'left', 0); end if;
  insert into ask_usage (day, user_id, n) values (d, auth.uid(), 1)
    on conflict (day, user_id) do update set n = ask_usage.n + 1 returning n into mine;
  return jsonb_build_object('ok', true, 'left', 30 - mine, 'total', total + 1);
end $$;
create or replace function public.ask_left() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', public.is_approved(), 'left',
    greatest(0, 30 - coalesce((select n from ask_usage where day = (now() at time zone 'Europe/Paris')::date and user_id = auth.uid()), 0)))
$$;

-- « any word » for Ask PowerKlock, which ranks the candidates itself
create or replace function news.query(q text, any_word boolean default false) returns tsquery
language sql immutable as $$
  select nullif(string_agg(quote_literal(w) || ':*', case when any_word then ' | ' else ' & ' end), '')::tsquery
  from (select lower(w) w from regexp_split_to_table(coalesce(q, ''), '[^[:alnum:]]+') w where length(w) > 1) x
$$;
-- (public.news_search gains p_any boolean default false: same body with news.query(p_query, p_any); applied as 036b)

-- the one-argument news.query(text) is dropped (applied as 036c): news.query(q, any_word) alone, no ambiguity
drop function if exists news.query(text);
