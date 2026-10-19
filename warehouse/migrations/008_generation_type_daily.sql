-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 008 · ENTSO-E production types as daily figures
-- The per-type breakdown (psr:B01 … psr:B25) is kept as daily statistics,
-- not intraday arrays: it serves carbon-intensity and mix questions, and
-- intraday arrays for ~20 types × zones × years would fill the free tier.
-- Intraday shapes stay available for the aggregates (nuclear, wind, solar…)
-- in market.generation_day.
-- ════════════════════════════════════════════════════════════════════
create table if not exists market.generation_type_daily (
  zone             text not null references meta.zone(zone),
  delivery_date    date not null,
  production_type  text not null references meta.fuel(fuel),   -- psr:Bxx
  avg_mw           real not null,
  max_mw           real,
  published_slots  smallint not null,
  slots            smallint not null,
  primary key (zone, delivery_date, production_type)
);
create index if not exists generation_type_daily_date on market.generation_type_daily (delivery_date);

insert into market.generation_type_daily (zone, delivery_date, production_type, avg_mw, max_mw, published_slots, slots)
select zone, delivery_date, fuel,
       (select avg(v) from unnest(mw) v)::real, (select max(v) from unnest(mw) v)::real,
       (select count(v) from unnest(mw) v)::smallint, slots
from market.generation_day
where fuel like 'psr:%' and exists (select 1 from unnest(mw) v where v is not null)
on conflict do nothing;
delete from market.generation_day where fuel like 'psr:%';

comment on table market.generation_type_daily is 'Daily average and maximum output (MW) per ENTSO-E production type (psr:Bxx, see meta.fuel), Paris day; published_slots of slots tells whether the day is complete.';
comment on column market.generation_day.fuel is 'PowerKlock aggregate: nuclear, wind, wind_onshore, wind_offshore, solar, hydro, fossil, biomass, other. Per ENTSO-E production type: market.generation_type_daily.';
