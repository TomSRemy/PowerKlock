# Asking Claude about PowerKlock data

Once the Supabase connector is added in claude.ai and pointed at the
PowerKlock project, Claude can query the warehouse directly. This page is
for the team: how to ask, and what Claude should check first.

## Paste this at the start of an analysis conversation

> You have read-only SQL access to the PowerKlock warehouse (Supabase,
> PostgreSQL). Before answering: read `meta.dictionary` for the tables and
> columns, and `analytics.coverage` for how much history each zone and
> dataset has. Use the `analytics` views first. Conventions: delivery day and
> intraday slots on the Europe/Paris clock, prices in EUR/MWh, power in MW.
> Days with a `flag` in `market.da_price_day` are excluded from the views on
> purpose; open data problems are listed in `ops.quality_issue`. State the
> period and zones actually covered in every answer, and show the SQL you ran.

## Good questions

- "Monthly base and peak FR prices this year, with negative hours."
- "Average hourly FR price shape over the last 30 days vs the same 30 days a year earlier."
- "French solar capture rate by month since 2015 (RTE generation), and the M0 solar against baseload."
- "FR − DE baseload spread per day since September: when does France decouple?"
- "TB2 battery spread by month in FR, DE and BE: which market pays most for 2-hour storage?"
- "Clean spark and clean dark spreads in DE this quarter: how often is gas in the money?"
- "How did the FR forward curve move over the last month, tenor by tenor?"
- "Correlation between French nuclear availability and day-ahead base price."
- "Which French regions have the best solar load factor, month by month, over the last five years?"
- "Germany's net cross-border position by month since 2020, and its relation to the FR − DE spread."
- "Installed solar and wind in Spain vs France since 2015."

## Example queries (tested)

```sql
-- France monthly solar and wind capture rates from RTE generation (since 2015)
select date_trunc('month', delivery_date)::date as month,
       round((sum(price_eur_mwh * solar_mw) / nullif(sum(solar_mw), 0) / avg(price_eur_mwh) * 100)::numeric, 1) as solar_cr_pct,
       round((sum(price_eur_mwh * wind_mw) / nullif(sum(wind_mw), 0) / avg(price_eur_mwh) * 100)::numeric, 1) as wind_cr_pct
from analytics.fr_generation_qh where price_eur_mwh is not null
group by 1 order by 1 desc;

-- M0 vs baseload, last 12 months
select month, base_eur_mwh, wind_m0_eur_mwh, solar_m0_eur_mwh, round((solar_m0_eur_mwh / base_eur_mwh)::numeric, 2) as solar_ratio
from market.fr_m0_month order by month desc limit 12;

-- Monthly base / peak and negative hours, France
select month, round(avg(base)::numeric, 2) as base, round(avg(peak)::numeric, 2) as peak, sum(neg_hours) as neg_hours
from analytics.da_price_daily
where zone = 'FR' and delivery_date >= date '2026-01-01'
group by month order by month;

-- Average hourly shape over the last 30 days
select hour, round(avg(price)::numeric, 1) as eur_mwh
from analytics.da_price_hourly
where zone = 'FR' and delivery_date > current_date - 30
group by hour order by hour;

-- Solar capture price and rate by month (output-weighted)
select date_trunc('month', delivery_date)::date as month,
       round((sum(capture_price * slots_used) / sum(slots_used))::numeric, 2) as capture_price,
       round(avg(capture_rate)::numeric * 100, 1) as capture_rate_pct
from analytics.capture_price_daily
where zone = 'FR' and fuel = 'solar'
group by 1 order by 1;

-- FR − DE baseload spread
select f.delivery_date, round((f.base - d.base)::numeric, 2) as fr_minus_de
from analytics.da_price_daily f
join analytics.da_price_daily d on d.delivery_date = f.delivery_date and d.zone = 'DE_LU'
where f.zone = 'FR' order by 1 desc;

-- Battery TB2 by month
select date_trunc('month', delivery_date)::date as month, round(avg(tb2)::numeric, 1) as tb2
from analytics.bess_spread_daily where zone = 'FR' group by 1 order by 1 desc;

-- Forward curve: latest vs one month earlier
select l.tenor, l.value as latest, p.value as month_ago, round((l.value - p.value)::numeric, 2) as change
from analytics.forward_curve_latest l
join analytics.forward_curve p
  on p.market = l.market and p.tenor = l.tenor
 and p.trade_date = (select max(trade_date) from market.forward_settlement
                     where market = l.market and trade_date <= l.trade_date - 30)
where l.market = 'FR' order by l.tenor;

-- Day-ahead base vs French nuclear availability
select d.delivery_date, d.base, c.value / 1000 as nuclear_available_gw
from analytics.da_price_daily d
join market.commodity_close c on c.key = 'fr_nuc_avail' and c.trade_date = d.delivery_date
where d.zone = 'FR' order by 1 desc;
```

```sql
-- Solar and wind load factor per French region, by year (PPA yield proxy)
select region, extract(year from month)::int as year,
       round(avg(solar_lf_pct)::numeric, 1) as solar_lf, round(avg(wind_lf_pct)::numeric, 1) as wind_lf
from analytics.fr_region_load_factor_monthly
group by 1, 2 order by 2 desc, 3 desc;

-- Daily net import of each country (Energy-Charts physical flows)
select country, date_trunc('month', delivery_date)::date as month, round(avg(net_import_mw)::numeric) as net_import_mw
from analytics.net_position_daily group by 1, 2 order by 2 desc, 1;

-- Installed capacity that may be summed, latest year
select country, round(sum(gw)::numeric, 1) as gw
from analytics.installed_capacity_latest where counts_in_total group by 1 order by 2 desc;
```

## Pitfalls Claude should avoid

- **Coverage differs by zone.** France goes back to 2016; most other zones
  only to the dates in `analytics.coverage`. Never average across zones over
  a period some of them do not cover.
- **France generation: use RTE, not ENTSO-E.** `market.fr_eco2mix_day`
  (views `analytics.fr_generation_daily`, `analytics.fr_generation_qh`) holds
  RTE éCO2mix since 2015: complete days, Paris quarter-hours. ENTSO-E rows
  for FR in `market.generation_day` arrive late and with gaps; differences
  are listed in `ops.quality_issue` (`entsoe_vs_rte_*`). Before 2026-09 the
  consolidated data are half-hourly and do not split onshore / offshore wind.
- **Generation rows (other zones):** `market.generation_day` holds PowerKlock
  aggregates (nuclear, wind, solar…) per quarter-hour; ENTSO-E production
  types (B01…B25) are daily statistics in `market.generation_type_daily`.
- **M0 (`market.fr_m0_month`)** is recomputed from RTE's curves and the FR
  day-ahead: it can differ marginally from the CRE's published values.
- **Partial days:** today's generation stops at the last published slot
  (`published_slots` in `analytics.generation_daily`).
- **Forwards by tenor are rolling**: `Y+1` changes contract on 1 January.
  For a fixed contract use `market.forward_contract_close`.
- **UK forwards are in GBP**: use `value_eur` in `analytics.forward_curve`.
- **Installed capacity**: never sum rows with `counts_in_total = false`
  (planning targets, storage GWh, solar DC duplicate). Italy's solar figure
  comes from ENTSO-E declarations and is far below the national registry.
- **Countries vs bidding zones**: Energy-Charts tables use countries (DE,
  IT); price tables use bidding zones (DE_LU, IT_NORD…).
- **Coal (API2) and EUA are single benchmark contracts**, not rolled
  continuous series (see `market.commodity.contract`).
