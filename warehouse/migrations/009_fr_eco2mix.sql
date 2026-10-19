-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 009 · France national generation (RTE éCO2mix)
-- and monthly M0 reference prices (complément de rémunération).
-- Source files: data/history/rte/YYYY-MM.json (scripts/fetch_rte_eco2mix.py)
-- and data/m0.json (scripts/fetch_rte_m0.py). Etalab open licence.
-- For France, prefer these tables over market.generation_day (ENTSO-E):
-- RTE publishes the whole day, ENTSO-E's per-type data arrive late.
-- ════════════════════════════════════════════════════════════════════
create table if not exists market.fr_eco2mix_day (
  delivery_date     date primary key,        -- Paris day
  dataset           text not null,           -- consolidated | real-time
  resolution_min    smallint not null,       -- 30 (consolidated history) or 15
  nuclear_mw        real[] not null,         -- 96 Paris quarter-hours; half-hourly values held over two slots
  wind_mw           real[],
  wind_onshore_mw   real[],                  -- real-time dataset only
  wind_offshore_mw  real[],
  solar_mw          real[],
  hydro_mw          real[],                  -- run-of-river + lakes + pumped-storage turbining
  hydro_ps_mw       real[],                  -- pumped-storage turbining
  pumping_mw        real[],                  -- negative = consumption
  gas_mw            real[],
  coal_mw           real[],
  oil_mw            real[],
  bio_mw            real[],
  battery_net_mw    real[],                  -- discharge + charge (charge negative), real-time only
  load_mw           real[],
  exchanges_mw      real[],                  -- RTE sign: negative = net export
  co2_g_kwh         real[],
  loaded_at         timestamptz not null default now()
);

create table if not exists market.fr_m0_month (
  month             date primary key,        -- first day of the month
  base_eur_mwh      real not null,
  wind_m0_eur_mwh   real,
  solar_m0_eur_mwh  real,
  wind_avg_mw       real,
  solar_avg_mw      real,
  wind_neg_share    real,                    -- share of the month's output produced at negative prices
  solar_neg_share   real,
  complete          boolean not null,
  loaded_at         timestamptz not null default now()
);

create or replace view analytics.fr_generation_daily as
select delivery_date, dataset,
  (select avg(v) from unnest(nuclear_mw) v)::real   as nuclear_mw,
  (select avg(v) from unnest(wind_mw) v)::real      as wind_mw,
  (select avg(v) from unnest(solar_mw) v)::real     as solar_mw,
  (select avg(v) from unnest(hydro_mw) v)::real     as hydro_mw,
  (select avg(v) from unnest(gas_mw) v)::real       as gas_mw,
  (select avg(v) from unnest(coal_mw) v)::real      as coal_mw,
  (select avg(v) from unnest(oil_mw) v)::real       as oil_mw,
  (select avg(v) from unnest(bio_mw) v)::real       as bio_mw,
  (select avg(v) from unnest(pumping_mw) v)::real   as pumping_mw,
  (select avg(v) from unnest(load_mw) v)::real      as load_mw,
  (select avg(v) from unnest(exchanges_mw) v)::real as exchanges_mw,
  (select avg(v) from unnest(co2_g_kwh) v)::real    as co2_g_kwh
from market.fr_eco2mix_day;

-- Quarter-hour France generation next to the day-ahead price (same Paris slots).
create or replace view analytics.fr_generation_qh as
select g.delivery_date, s.slot,
       g.delivery_date + make_interval(mins => 15 * (s.slot - 1)) as slot_start_local,
       case when array_length(p.prices, 1) = 96 then p.prices[s.slot]
            when array_length(p.prices, 1) = 24 then p.prices[(s.slot - 1) / 4 + 1] end as price_eur_mwh,
       g.nuclear_mw[s.slot] as nuclear_mw, g.wind_mw[s.slot] as wind_mw, g.solar_mw[s.slot] as solar_mw,
       g.hydro_mw[s.slot] as hydro_mw, g.gas_mw[s.slot] as gas_mw, g.load_mw[s.slot] as load_mw,
       g.exchanges_mw[s.slot] as exchanges_mw
from market.fr_eco2mix_day g
cross join generate_series(1, 96) as s(slot)
left join market.da_price_day p on p.zone = 'FR' and p.delivery_date = g.delivery_date;

comment on table market.fr_eco2mix_day is 'France national generation, load, exchanges and CO2 intensity from RTE éCO2mix (ODRÉ, Etalab licence): 96 Paris quarter-hours per day. Consolidated history since 2015 is half-hourly (each value held over its two quarter-hours); recent weeks are real-time 15-min data until consolidated. Preferred over ENTSO-E for France.';
comment on table market.fr_m0_month is 'Monthly M0 reference prices of the French complément de rémunération (wind, solar): Σ(day-ahead × RTE national production curve) ÷ Σ production. Recomputed by PowerKlock; may differ marginally from CRE publications.';
comment on view analytics.fr_generation_daily is 'Daily averages of France generation per technology from RTE éCO2mix (MW).';
comment on view analytics.fr_generation_qh is 'France quarter-hour generation from RTE éCO2mix next to the FR day-ahead price: base for capture prices and residual-load analyses.';

-- Quality checks: same as 005 plus the France ENTSO-E vs RTE comparison.
create or replace function ops.run_quality_checks() returns int
language plpgsql as $$
declare n int;
begin
  create temp table _qi (dataset text, zone text, day date, severity text, check_name text, detail text) on commit drop;

  -- Days the loader excluded (kept in market.da_price_day with a flag).
  insert into _qi select 'da_price', zone, delivery_date, 'error', flag, 'excluded from analytics views'
  from market.da_price_day where flag is not null;

  -- Whole day at exactly 0.00 that was not excluded: check it.
  insert into _qi select 'da_price', zone, delivery_date, 'warning', 'flat_zero_day', 'all 96 slots at 0.00'
  from market.da_price_day where flag is null and min = 0 and max = 0;

  -- Prices outside the harmonised SDAC limits (−500 / +4000 EUR/MWh).
  insert into _qi select 'da_price', zone, delivery_date, 'error', 'price_out_of_range', format('min %s, max %s', min, max)
  from market.da_price_day where min < -500 or max > 4000;

  -- Identical to the previous day in every slot: stale copy.
  insert into _qi select 'da_price', d.zone, d.delivery_date, 'warning', 'same_as_previous_day', 'prices identical to the day before'
  from market.da_price_day d join market.da_price_day p
    on p.zone = d.zone and p.delivery_date = d.delivery_date - 1 and p.prices = d.prices
  where d.min <> d.max;

  -- Missing delivery days inside each zone's covered span (last 2 years).
  insert into _qi
  select 'da_price', z.zone, g::date, 'warning', 'missing_day', 'no price file for this day'
  from (select zone, greatest(min(delivery_date), current_date - 730) as a, max(delivery_date) as b from market.da_price_day group by zone) z
  cross join lateral generate_series(z.a, z.b, interval '1 day') g
  where not exists (select 1 from market.da_price_day d where d.zone = z.zone and d.delivery_date = g::date);

  -- Generation day with nothing published.
  insert into _qi select 'generation', zone, delivery_date, 'warning', 'no_generation_published', 'every slot null for ' || fuel
  from market.generation_day where fuel in ('nuclear', 'solar', 'wind') and array_position(mw, null) is not null
    and not exists (select 1 from unnest(mw) v where v is not null);

  -- France: ENTSO-E vs RTE éCO2mix daily averages over common slots (> 10 % and > 300 MW apart).
  insert into _qi
  select 'generation', 'FR', g.delivery_date, 'info', 'entsoe_vs_rte_' || g.fuel,
         format('ENTSO-E %s MW vs RTE %s MW over %s common quarter-hours', round(c.e), round(c.t), c.n)
  from market.generation_day g
  join market.fr_eco2mix_day r on r.delivery_date = g.delivery_date
  cross join lateral (
    select avg(g.mw[i]) as e, avg(x.rr[i]) as t, count(*) as n
    from (select case g.fuel when 'nuclear' then r.nuclear_mw when 'wind' then r.wind_mw when 'solar' then r.solar_mw end as rr) x
    cross join generate_series(1, least(array_length(g.mw, 1), 96)) i
    where g.mw[i] is not null and x.rr[i] is not null
  ) c
  where g.zone = 'FR' and g.fuel in ('nuclear', 'wind', 'solar') and array_length(g.mw, 1) = 96
    and c.n >= 48 and abs(c.e - c.t) > greatest(0.1 * c.t, 300);

  -- Commodity series not updated for more than 5 days.
  insert into _qi select 'commodity', key, max(trade_date), 'warning', 'stale_series', 'last close ' || max(trade_date)
  from market.commodity_close group by key having max(trade_date) < current_date - 5;

  delete from ops.quality_issue q
  where not exists (select 1 from _qi i where i.dataset = q.dataset and i.zone is not distinct from q.zone
                    and i.day is not distinct from q.day and i.check_name = q.check_name);
  insert into ops.quality_issue (dataset, zone, day, severity, check_name, detail)
  select dataset, zone, day, severity, check_name, detail from _qi
  on conflict (dataset, zone, day, check_name) do update set detail = excluded.detail, severity = excluded.severity;
  select count(*) into n from ops.quality_issue;
  return n;
end $$;
