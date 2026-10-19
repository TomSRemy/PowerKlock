-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 003 · analytics views + data dictionary
-- Same formulas as the site (js/commodities.js, js/analysis.js,
-- js/overview-extra.js). Views only: nothing here stores data.
-- ════════════════════════════════════════════════════════════════════

-- Last close of a commodity on or before a date (weekends / holidays carry the last close).
create or replace function analytics.commodity_on(p_key text, p_date date)
returns double precision language sql stable as $$
  select value from market.commodity_close
  where key = p_key and trade_date <= p_date
  order by trade_date desc limit 1
$$;

create or replace function analytics.convention(p_key text)
returns double precision language sql stable as $$
  select value from meta.convention where key = p_key
$$;

-- ── Day-ahead prices ─────────────────────────────────────────────────
create or replace view analytics.da_price_15min as
select p.zone, p.delivery_date,
       s.slot::smallint                                   as slot,          -- 1..96
       (time '00:00' + (s.slot - 1) * interval '15 minutes') as slot_start, -- Paris clock
       ((s.slot - 1) / 4)::smallint                       as hour,          -- 0..23
       s.price,
       ((s.slot - 1) / 4) >= 8 and ((s.slot - 1) / 4) < 20 as is_peak,
       p.resolution_min
from market.da_price_day p
cross join lateral unnest(p.prices) with ordinality as s(price, slot)
where p.flag is null;

create or replace view analytics.da_price_hourly as
select zone, delivery_date, hour, avg(price)::real as price, bool_or(is_peak) as is_peak
from analytics.da_price_15min
group by zone, delivery_date, hour;

create or replace view analytics.da_price_daily as
select zone, delivery_date,
       extract(isodow from delivery_date)::smallint as iso_weekday,       -- 1 = Monday
       date_trunc('month', delivery_date)::date      as month,
       avg as base, peak_avg as peak, offpeak_avg as offpeak, min, max,
       max - min as intraday_spread, neg_hours, resolution_min
from market.da_price_day where flag is null;

create or replace view analytics.negative_hours_monthly as
select zone, date_trunc('month', delivery_date)::date as month,
       sum(neg_hours)::real                         as neg_hours,
       count(*) filter (where neg_hours > 0)        as days_with_negative,
       count(*)                                     as days,
       min(min)                                     as lowest_price
from market.da_price_day where flag is null
group by zone, date_trunc('month', delivery_date);

-- Battery arbitrage on hourly averages: TBn = mean of the n highest hours − mean of the n lowest.
create or replace view analytics.bess_spread_daily as
with h as (
  select zone, delivery_date, price,
         row_number() over (partition by zone, delivery_date order by price desc) as r_hi,
         row_number() over (partition by zone, delivery_date order by price asc)  as r_lo,
         count(*)     over (partition by zone, delivery_date)                      as n
  from analytics.da_price_hourly where price is not null
)
select zone, delivery_date,
       (avg(price) filter (where r_hi <= 1) - avg(price) filter (where r_lo <= 1))::real as tb1,
       (avg(price) filter (where r_hi <= 2) - avg(price) filter (where r_lo <= 2))::real as tb2,
       (avg(price) filter (where r_hi <= 4) - avg(price) filter (where r_lo <= 4))::real as tb4
from h group by zone, delivery_date having max(n) >= 20;

-- ── Generation ───────────────────────────────────────────────────────
create or replace view analytics.generation_slot as
select g.zone, g.delivery_date, g.fuel, g.slots,
       s.slot::smallint as slot,
       (time '00:00' + (s.slot - 1) * (interval '1 day' / g.slots)) as slot_start,
       s.mw
from market.generation_day g
cross join lateral unnest(g.mw) with ordinality as s(mw, slot);

create or replace view analytics.generation_daily as
select zone, delivery_date, fuel, slots,
       count(mw)                         as published_slots,
       avg(mw)::real                     as avg_mw,
       (avg(mw) * 24)::real              as energy_mwh_if_full_day,   -- average × 24 h; check published_slots for partial days
       max(mw)::real                     as max_mw
from analytics.generation_slot
group by zone, delivery_date, fuel, slots;

-- Generation-weighted price per technology. The baseload compared against
-- is the average price of the slots where that technology was published,
-- so a partial day does not distort the rate.
create or replace view analytics.capture_price_daily as
with j as (
  select g.zone, g.delivery_date, g.fuel, g.mw, p.price
  from analytics.generation_slot g
  join analytics.da_price_15min p
    on p.zone = g.zone and p.delivery_date = g.delivery_date
   and ceil(p.slot * g.slots / 96.0) = g.slot          -- 96 price slots onto 96 or 24 generation slots
  where g.mw is not null and p.price is not null
)
select zone, delivery_date, fuel,
       (sum(mw * price) / nullif(sum(mw), 0))::real                       as capture_price,
       avg(price)::real                                                    as baseload_published,
       ((sum(mw * price) / nullif(sum(mw), 0)) / nullif(avg(price), 0))::real as capture_rate,
       count(*)                                                            as slots_used
from j where mw > 0
group by zone, delivery_date, fuel;

-- ── Fuels, carbon and spreads ────────────────────────────────────────
create or replace view analytics.commodity_daily as
select c.key, m.name, m.unit, m.contract, c.trade_date, c.value,
       c.value - lag(c.value) over (partition by c.key order by c.trade_date) as change
from market.commodity_close c join market.commodity m using (key);

-- Gas day-ahead traded the day before delivery; EUA, coal and EUR/USD of the delivery day (last close).
create or replace view analytics.clean_spread_daily as
with r as (
  select d.zone, d.delivery_date, d.avg as base, d.peak_avg as peak,
         coalesce(analytics.commodity_on('ttf', d.delivery_date - 1), analytics.commodity_on('ttf', d.delivery_date)) as ttf,
         analytics.commodity_on('eua', d.delivery_date)    as eua,
         analytics.commodity_on('coal', d.delivery_date)   as coal_usd,
         analytics.commodity_on('eurusd', d.delivery_date) as eurusd
  from market.da_price_day d where d.flag is null
), k as (
  select analytics.convention('ccgt_efficiency') as ge, analytics.convention('gas_ef') as gf,
         analytics.convention('coal_efficiency') as ce, analytics.convention('coal_mwh_per_t') as cm, analytics.convention('coal_ef') as cf
)
select r.zone, r.delivery_date, r.base, r.peak, r.ttf, r.eua, r.coal_usd, r.eurusd,
       (r.base - r.ttf / k.ge - r.eua * k.gf / k.ge)::real                                          as css_base,
       (r.peak - r.ttf / k.ge - r.eua * k.gf / k.ge)::real                                          as css_peak,
       (r.base - (r.coal_usd / r.eurusd) / (k.cm * k.ce) - r.eua * k.cf / k.ce)::real               as cds_base,
       (((r.ttf / k.ge) - (r.coal_usd / r.eurusd) / (k.cm * k.ce)) / (k.cf / k.ce - k.gf / k.ge))::real as coal_gas_switch_eua
from r cross join k;

-- ── Forwards ─────────────────────────────────────────────────────────
create or replace view analytics.forward_curve as
select f.market, f.trade_date, f.tenor, f.value, f.currency,
       case when f.currency = 'GBP'
            then (f.value * analytics.commodity_on('gbpusd', f.trade_date) / nullif(analytics.commodity_on('eurusd', f.trade_date), 0))
            else f.value end as value_eur
from market.forward_settlement f;

create or replace view analytics.forward_curve_latest as
select distinct on (market, tenor) market, tenor, trade_date, value, currency, value_eur
from analytics.forward_curve
order by market, tenor, trade_date desc;

-- ── Coverage: what history exists, per dataset and zone ─────────────
create or replace view analytics.coverage as
select 'da_price'::text as dataset, zone, min(delivery_date) as first_day, max(delivery_date) as last_day,
       count(*) as days, (max(delivery_date) - min(delivery_date) + 1) as calendar_days
from market.da_price_day where flag is null group by zone
union all
select 'generation:' || fuel, zone, min(delivery_date), max(delivery_date), count(*), (max(delivery_date) - min(delivery_date) + 1)
from market.generation_day where fuel not like 'psr:%' group by zone, fuel
union all
select 'commodity:' || key, null, min(trade_date), max(trade_date), count(*), (max(trade_date) - min(trade_date) + 1)
from market.commodity_close group by key
union all
select 'forward:' || market, null, min(trade_date), max(trade_date), count(distinct trade_date), (max(trade_date) - min(trade_date) + 1)
from market.forward_settlement group by market;

-- ── Data dictionary (reads the COMMENTs below) ───────────────────────
create or replace view meta.dictionary as
select n.nspname as schema, c.relname as object,
       case c.relkind when 'r' then 'table' when 'v' then 'view' else c.relkind::text end as kind,
       null::text as column_name, null::text as data_type,
       obj_description(c.oid, 'pg_class') as description
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('market', 'analytics', 'meta', 'ops') and c.relkind in ('r', 'v')
union all
select n.nspname, c.relname, 'column', a.attname, format_type(a.atttypid, a.atttypmod),
       col_description(c.oid, a.attnum)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname in ('market', 'analytics', 'meta', 'ops') and c.relkind in ('r', 'v');

-- ── Comments: the dictionary Claude reads first ──────────────────────
comment on schema market    is 'PowerKlock raw market facts, one row per zone and day; intraday values as arrays on the Paris clock.';
comment on schema analytics is 'Analysis views built on market.*: 15-min, hourly, daily, capture prices, spreads, forwards, coverage. Start here.';
comment on schema meta      is 'Reference data (zones, fuels, conventions) and meta.dictionary describing every table and column.';
comment on schema ops       is 'Sync runs, loaded file hashes, data-quality issues, applied migrations.';

comment on table market.da_price_day is 'Day-ahead auction prices per bidding zone and delivery day (Paris). prices[] = 96 quarter-hours in EUR/MWh; hourly auctions are repeated ×4. Source ENTSO-E A44.';
comment on column market.da_price_day.delivery_date is 'Delivery day in Europe/Paris.';
comment on column market.da_price_day.prices is '96 quarter-hour prices (EUR/MWh), slot 1 = 00:00–00:15 Paris.';
comment on column market.da_price_day.resolution_min is 'Native auction resolution: 15 (quarter-hour products) or 60 (hourly, repeated ×4 in prices[]).';
comment on column market.da_price_day.peak_avg is 'Average 08:00–20:00 Paris, all days.';
comment on column market.da_price_day.neg_hours is 'Hours with a strictly negative price.';
comment on column market.da_price_day.flag is 'Null when valid. Otherwise the reason the day is kept but excluded from every analytics view (flat_zero_feed: whole day at 0.00 while coupled zones were well above zero).';
comment on table market.generation_day is 'Actual generation per production type and day (ENTSO-E A75), realigned to the Paris clock. mw[] = average MW per slot; null = not published.';
comment on column market.generation_day.fuel is 'PowerKlock aggregate (nuclear, wind, solar, hydro, fossil, biomass, other, wind_onshore, wind_offshore) or ENTSO-E production type psr:Bxx (see meta.fuel). Do not add aggregates and psr:* rows together.';
comment on table market.load_day is 'Actual and day-ahead forecast total load (ENTSO-E A65), Paris clock.';
comment on table market.commodity_close is 'Daily closes of fuel, carbon, FX and fundamentals series (see market.commodity for unit and contract).';
comment on table market.commodity is 'Commodity series: ttf/peg/the (EUR/MWh), nbp (p/th), jkm ($/MMBtu), eua (EUR/t, front December), coal (API2 $/t, single benchmark contract), brent ($/bbl), eurusd/gbpusd, agsi (EU gas storage %), fr_nuc_avail / fr_nuc_avail_fc (French nuclear availability MW, actual / operator forecast).';
comment on table market.forward_settlement is 'Baseload power forward settlements by rolling tenor (M+1 … Y+3) per market. UK is in GBP.';
comment on table market.forward_contract_close is 'Settlement history of each calendar-year baseload contract (Cal2027 …).';
comment on table market.go_quote is 'Guarantees of origin, weekly broker bid/ask (EUR/MWh) per product and production year.';
comment on table market.go_auction is 'French state GO auctions: volumes and clearing price per technology and production month.';
comment on table meta.zone is 'Bidding zones used across PowerKlock.';
comment on table meta.fuel is 'Fuels / ENTSO-E production types with the CO2 factor used by PowerKlock (life-cycle, g/kWh).';
comment on table meta.convention is 'Fuel-cost and calculation conventions shared with the website.';

comment on view analytics.da_price_15min is 'One row per zone, delivery day and quarter-hour. hour = 0..23 Paris; is_peak = 08:00–20:00.';
comment on view analytics.da_price_hourly is 'Hourly average of the quarter-hour prices.';
comment on view analytics.da_price_daily is 'Daily base / peak / off-peak, min, max, intraday spread and negative hours.';
comment on view analytics.negative_hours_monthly is 'Negative-price hours and days per zone and month.';
comment on view analytics.bess_spread_daily is 'Battery arbitrage TB1 / TB2 / TB4: mean of the n most expensive hours − mean of the n cheapest (hourly averages, EUR/MWh).';
comment on view analytics.generation_slot is 'One row per zone, day, fuel and slot (MW).';
comment on view analytics.generation_daily is 'Daily average and max output per fuel; published_slots tells whether the day is complete.';
comment on view analytics.capture_price_daily is 'Capture price = Σ(MW × price) / Σ(MW) per fuel and day; capture_rate = capture / average price of the same published slots.';
comment on view analytics.commodity_daily is 'Commodity closes with name, unit, contract and day-on-day change.';
comment on view analytics.clean_spread_daily is 'Clean spark (CCGT 49.13 %, 0.411 tCO2/MWh) and clean dark (coal 36 %, 0.947 tCO2/MWh) spreads, and the coal-to-gas switch EUA price. Gas = TTF traded the day before delivery.';
comment on view analytics.forward_curve is 'Forward settlements with value_eur (GBP converted at the GBP/EUR cross of the trade date).';
comment on view analytics.forward_curve_latest is 'Latest settlement per market and tenor.';
comment on view analytics.coverage is 'First / last day and number of days per dataset and zone: check before comparing periods or zones.';
comment on view meta.dictionary is 'Every table, view and column of the warehouse with its description.';
