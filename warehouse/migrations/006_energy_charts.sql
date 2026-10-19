-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 006 · Energy-Charts datasets
-- Installed capacity and physical cross-border flows from Energy-Charts
-- (Fraunhofer ISE, CC BY 4.0 — attribution "Energy-Charts.info").
-- Country codes are ISO-like (FR, DE, IT, …), not bidding zones.
-- ════════════════════════════════════════════════════════════════════
create table if not exists market.installed_capacity (
  country          text not null,
  year             int  not null,
  production_type  text not null,          -- Energy-Charts names: Nuclear, Wind onshore, Solar, Fossil gas…
  gw               real not null,
  source           text not null default 'Energy-Charts installed_power',
  primary key (country, year, production_type)
);

create table if not exists market.crossborder_flow_day (
  country        text not null,            -- reporting country
  neighbour      text not null,
  delivery_date  date not null,            -- Paris clock
  mw             real[] not null,          -- 24 hourly averages; + = import into country, − = export
  source         text not null default 'Energy-Charts cbpf',
  primary key (country, neighbour, delivery_date)
);
create index if not exists crossborder_flow_day_date on market.crossborder_flow_day (delivery_date);

create or replace view analytics.crossborder_flow_hourly as
select f.country, f.neighbour, f.delivery_date, (s.h - 1)::smallint as hour, s.mw
from market.crossborder_flow_day f
cross join lateral unnest(f.mw) with ordinality as s(mw, h);

create or replace view analytics.net_position_daily as
select country, delivery_date,
       sum(v)::real / nullif(count(distinct h), 0)  as net_import_mw,     -- average over the day, + = net importer
       count(distinct neighbour)                    as neighbours
from (select country, neighbour, delivery_date, s.v, s.h
      from market.crossborder_flow_day cross join lateral unnest(mw) with ordinality as s(v, h)
      where s.v is not null) x
group by country, delivery_date;

-- Rows that may be summed into a country's installed generating capacity:
-- not planning targets, not storage energy (GWh), not the DC duplicate of solar.
create or replace function analytics.capacity_counts(p_type text) returns boolean language sql immutable as $$
  select not (p_type ilike '%planned%' or p_type ilike '%(capacity)%' or p_type = 'Solar DC')
$$;

create or replace view analytics.installed_capacity as
select country, year, production_type, gw, analytics.capacity_counts(production_type) as counts_in_total
from market.installed_capacity;

create or replace view analytics.installed_capacity_latest as
select distinct on (country, production_type) country, production_type, year, gw,
       analytics.capacity_counts(production_type) as counts_in_total
from market.installed_capacity
order by country, production_type, year desc;

comment on table market.installed_capacity is 'Installed net capacity per country, production type and year (GW). Source Energy-Charts (Fraunhofer ISE), CC BY 4.0.';
comment on table market.crossborder_flow_day is 'Physical cross-border flows per country and neighbour, hourly averages (MW) on the Paris delivery day; + = import into the country. Source Energy-Charts (Fraunhofer ISE), CC BY 4.0.';
comment on view analytics.crossborder_flow_hourly is 'One row per country, neighbour, day and hour (MW, + = import).';
comment on view analytics.net_position_daily is 'Daily average net import (MW) per country across all reported borders; negative = net exporter.';
comment on view analytics.installed_capacity is 'Installed capacity per country, year and type. counts_in_total = false for planning targets, storage energy (GWh) and the DC duplicate of solar: never sum those.';
comment on view analytics.installed_capacity_latest is 'Latest year of installed capacity per country and production type (GW), with counts_in_total.';
