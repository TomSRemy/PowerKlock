-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 007 · French regions (RTE éCO2mix régional, ODRÉ)
-- Hourly averages per region and Paris day: consumption, production per
-- technology, physical exchanges and wind / solar load factors (TCH).
-- Consolidated history since 2013 (dataset eco2mix-regional-cons-def),
-- recent weeks from the real-time dataset until consolidated data replace
-- them. Etalab open licence.
-- ════════════════════════════════════════════════════════════════════
create table if not exists market.fr_region_day (
  region          text not null,           -- libellé RTE (Bretagne, Grand Est…)
  delivery_date   date not null,           -- Paris day
  dataset         text not null,           -- consolidated | real-time
  consumption_mw  real[] not null,         -- 24 hourly averages
  nuclear_mw      real[],
  wind_mw         real[],
  solar_mw        real[],
  hydro_mw        real[],
  thermal_mw      real[],
  bio_mw          real[],
  exchanges_mw    real[],                  -- + = import into the region
  wind_lf_pct     real[],                  -- load factor = output ÷ installed capacity (%)
  solar_lf_pct    real[],
  loaded_at       timestamptz not null default now(),
  primary key (region, delivery_date)
);
create index if not exists fr_region_day_date on market.fr_region_day (delivery_date);

create or replace view analytics.fr_region_daily as
select region, delivery_date, dataset,
  (select avg(v) from unnest(consumption_mw) v)::real as consumption_mw,
  (select avg(v) from unnest(nuclear_mw) v)::real     as nuclear_mw,
  (select avg(v) from unnest(wind_mw) v)::real        as wind_mw,
  (select avg(v) from unnest(solar_mw) v)::real       as solar_mw,
  (select avg(v) from unnest(hydro_mw) v)::real       as hydro_mw,
  (select avg(v) from unnest(thermal_mw) v)::real     as thermal_mw,
  (select avg(v) from unnest(exchanges_mw) v)::real   as exchanges_mw,
  (select avg(v) from unnest(wind_lf_pct) v)::real    as wind_lf_pct,
  (select avg(v) from unnest(solar_lf_pct) v)::real   as solar_lf_pct
from market.fr_region_day;

create or replace view analytics.fr_region_load_factor_monthly as
select region, date_trunc('month', delivery_date)::date as month,
       avg(wind_lf_pct)::real as wind_lf_pct, avg(solar_lf_pct)::real as solar_lf_pct,
       count(*) as days
from analytics.fr_region_daily
group by region, date_trunc('month', delivery_date);

comment on table market.fr_region_day is 'French regions (RTE éCO2mix régional via ODRÉ, Etalab licence): 24 hourly averages per region and Paris day of consumption, production per technology, physical exchanges (+ = import) and wind / solar load factors (%). Consolidated since 2013; recent weeks real-time until consolidated.';
comment on view analytics.fr_region_daily is 'Daily averages per French region (MW, load factors in %).';
comment on view analytics.fr_region_load_factor_monthly is 'Monthly average wind and solar load factor per French region (%): the basis for regional PPA yield comparisons.';
