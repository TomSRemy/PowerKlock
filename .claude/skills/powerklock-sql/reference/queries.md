# PowerKlock warehouse — tested queries

Each query was run against the warehouse. Adapt zones, dates and windows; keep the conventions (Paris clock, €/MWh, MW).

## Coverage: what history exists (run this first)

```sql
select dataset, zone, first_day, last_day, days
from analytics.coverage
where zone in ('FR', 'DE_LU') or zone is null
order by dataset, zone;
```

## Monthly base, peak and negative hours for one zone

```sql
select date_trunc('month', delivery_date)::date as month,
       round(avg(base)::numeric, 2) as base, round(avg(peak)::numeric, 2) as peak,
       round(sum(neg_hours)::numeric, 1) as neg_hours, count(*) as days
from analytics.da_price_daily
where zone = 'FR' and delivery_date >= date '2025-01-01'
group by 1 order by 1;
```

## FR − DE baseload spread per day and how often prices are coupled (|spread| < 1)

```sql
select f.delivery_date, f.base as fr, d.base as de, round((f.base - d.base)::numeric, 2) as spread
from analytics.da_price_daily f
join analytics.da_price_daily d on d.delivery_date = f.delivery_date and d.zone = 'DE_LU'
where f.zone = 'FR' and f.delivery_date >= current_date - 60
order by 1 desc;
```

## France monthly solar and wind capture rates since 2016 (RTE generation × FR day-ahead)

```sql
select date_trunc('month', delivery_date)::date as month,
       round((sum(price_eur_mwh * solar_mw) / nullif(sum(solar_mw), 0))::numeric, 2) as solar_capture,
       round((sum(price_eur_mwh * solar_mw) / nullif(sum(solar_mw), 0) / avg(price_eur_mwh) * 100)::numeric, 1) as solar_rate_pct,
       round((sum(price_eur_mwh * wind_mw) / nullif(sum(wind_mw), 0) / avg(price_eur_mwh) * 100)::numeric, 1) as wind_rate_pct,
       round(avg(price_eur_mwh)::numeric, 2) as base
from analytics.fr_generation_qh
where price_eur_mwh is not null
group by 1 order by 1 desc;
```

## M0 (complément de rémunération) vs baseload, last 12 published months

```sql
select month, base_eur_mwh, wind_m0_eur_mwh, solar_m0_eur_mwh,
       round((wind_m0_eur_mwh / base_eur_mwh)::numeric, 3) as wind_ratio,
       round((solar_m0_eur_mwh / base_eur_mwh)::numeric, 3) as solar_ratio,
       solar_neg_share, complete
from market.fr_m0_month order by month desc limit 12;
```

## Battery spreads (TB2) by month and zone

```sql
select date_trunc('month', delivery_date)::date as month, zone, round(avg(tb2)::numeric, 1) as tb2
from analytics.bess_spread_daily
where zone in ('FR', 'DE_LU', 'BE', 'NL') and delivery_date >= date '2025-01-01'
group by 1, 2 order by 1 desc, 3 desc;
```

## Clean spark and clean dark spreads, monthly averages

```sql
select date_trunc('month', delivery_date)::date as month, zone,
       round(avg(css_base)::numeric, 2) as clean_spark_base, round(avg(cds_base)::numeric, 2) as clean_dark_base,
       round(avg(coal_gas_switch_eua)::numeric, 1) as switch_eua
from analytics.clean_spread_daily
where zone = 'DE_LU' and delivery_date >= date '2025-01-01'
group by 1, 2 order by 1 desc;
```

## Forward curve today vs one week earlier (rolling tenors, EUR)

```sql
with l as (select * from analytics.forward_curve_latest where market = 'FR')
select l.tenor, l.trade_date, round(l.value_eur::numeric, 2) as latest,
       round(w.value_eur::numeric, 2) as week_before, round((l.value_eur - w.value_eur)::numeric, 2) as change
from l
left join lateral (select value_eur from analytics.forward_curve f
                   where f.market = l.market and f.tenor = l.tenor and f.trade_date <= l.trade_date - 7
                   order by f.trade_date desc limit 1) w on true
order by array_position(array['M+1','M+2','M+3','Q+1','Q+2','Q+3','S+1','S+2','Y+1','Y+2','Y+3'], l.tenor);
```

## One fixed calendar contract over time (not the rolling Y+1)

```sql
select trade_date, value from market.forward_contract_close
where market = 'FR' and contract like '%Cal2027%' and trade_date >= current_date - 90
order by trade_date;
```

## Guarantees of origin: latest weekly mid per product and production year

```sql
select distinct on (product, production_year) product, production_year, quote_date,
       round(((coalesce(bid, ask) + coalesce(ask, bid)) / 2)::numeric, 3) as mid
from market.go_quote
where production_year between extract(year from current_date)::int and extract(year from current_date)::int + 2
order by product, production_year, quote_date desc;
```

## French state GO auctions: volume-weighted price per auction month

```sql
select auction_month, round((sum(allocated_mwh * price_eur_mwh) / nullif(sum(allocated_mwh), 0))::numeric, 3) as price,
       round((sum(allocated_mwh) / 1e6)::numeric, 2) as twh
from market.go_auction group by 1 order by 1 desc limit 12;
```

## French nuclear output (RTE) vs FR baseload, monthly, with correlation

```sql
with d as (select g.delivery_date, g.nuclear_mw, p.base
           from analytics.fr_generation_daily g join analytics.da_price_daily p on p.zone = 'FR' and p.delivery_date = g.delivery_date)
select date_trunc('year', delivery_date)::date as year, round(avg(nuclear_mw)::numeric) as nuclear_mw,
       round(avg(base)::numeric, 1) as base, round(corr(nuclear_mw, base)::numeric, 2) as corr_daily
from d group by 1 order by 1;
```

## Regions with the best solar load factor, last 12 months

```sql
select region, round(avg(solar_lf_pct)::numeric, 1) as solar_lf_pct, round(avg(wind_lf_pct)::numeric, 1) as wind_lf_pct
from analytics.fr_region_load_factor_monthly
where month >= (date_trunc('month', current_date) - interval '12 months')::date
group by 1 order by 2 desc;
```

## Net import per country by month (Energy-Charts physical flows; negative = net exporter)

```sql
select country, date_trunc('month', delivery_date)::date as month, round(avg(net_import_mw)::numeric) as net_import_mw
from analytics.net_position_daily
where delivery_date >= date '2026-01-01'
group by 1, 2 order by 2 desc, 3;
```

## Known data problems for a zone and period

```sql
select day, dataset, check_name, severity, detail from ops.quality_issue
where zone = 'FR' and day >= current_date - 30 order by day desc;
```
