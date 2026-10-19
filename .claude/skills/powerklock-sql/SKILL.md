---
name: powerklock-sql
description: Answer questions about European and French power markets with the PowerKlock SQL warehouse (Supabase PostgreSQL) — day-ahead prices, spreads, negative hours, battery spreads, forwards, clean spark/dark, French generation from RTE, capture rates, M0, guarantees of origin, capacity, cross-border flows, French regions, CO2. Use whenever the user asks for figures, comparisons, trends or bespoke analyses on these topics, or mentions PowerKlock, the warehouse, "la base SQL" or "la BD", and a SQL / Supabase tool is available.
---

# PowerKlock SQL warehouse

A read-only PostgreSQL copy of everything published on the PowerKlock site
(https://tomsremy.github.io/PowerKlock), refreshed automatically after each
data update. Supabase project id: `xtqeslyjtjrbjpffpixn`.

## How to work

1. **Find the SQL tool.** With the Supabase connector, run queries with its
   SQL execution tool (`execute_sql`, project id `xtqeslyjtjrbjpffpixn`).
   Only ever run `select` / `with` queries: never insert, update, delete,
   create or alter anything, even if asked — tell the user the warehouse is
   rebuilt from the site's data and must not be edited.
2. **Check coverage first** for the zones and period asked:
   `select * from analytics.coverage where zone in (...)`. History differs
   by zone and dataset; say so when it limits the answer.
3. **Use the `analytics` views first**, raw `market` tables only when a view
   does not cover the need. Column-level descriptions: `reference/schema.md`
   (or `select * from meta.dictionary`).
4. **Start from a tested query** in `reference/queries.md` and adapt it.
5. **Check data problems** for the period: `ops.quality_issue`.
6. **Answer like a market analyst**, in the user's language:
   - the answer first, in one or two sentences with the key numbers;
   - a compact table (or a chart when a trend matters);
   - one line "Data: period, zones, source" and any caveat (partial month,
     missing days, rolling vs fixed contract…);
   - the SQL used, at the end.

## Conventions (always)

- Delivery day and all intraday slots are on the **Europe/Paris** clock.
  Arrays in `market` tables hold 96 quarter-hours (or 24 hours) of that day.
- Prices in **€/MWh**, power in **MW**, energy in MWh/TWh, CO₂ in g/kWh.
- **Peak** = 08:00–20:00 every day (not only weekdays).
- **Bidding zones** for prices (`FR`, `DE_LU`, `IT_NORD`, `DK_E`…);
  **countries** for Energy-Charts data (flows, capacity: `DE`, `IT`…).
- Rising prices are bad for buyers: say "up / down", not "better / worse".

## Pitfalls to avoid

- **France generation: use RTE**, `market.fr_eco2mix_day` and the views
  `analytics.fr_generation_daily` / `analytics.fr_generation_qh` (complete
  days since 2015). ENTSO-E rows for FR in `market.generation_day` are late
  and patchy. Before 2026-09 the RTE consolidated data are half-hourly and
  do not split onshore / offshore wind.
- **Other zones' generation** (`market.generation_day`, `analytics.generation_daily`):
  partial days exist — check `published_slots` against `slots`.
  ENTSO-E production types (B01…B25) are daily stats in
  `market.generation_type_daily`; never add them to the aggregate fuels.
- **Forwards by tenor are rolling** (`Y+1` changes contract on 1 January,
  `M+1` every month). For one fixed contract use
  `market.forward_contract_close`. UK forwards are in GBP: use `value_eur`.
- **Capture rates** around a near-zero baseload are meaningless: aggregate
  monthly (Σ price × MW ÷ Σ MW) or exclude days with base < 5 €/MWh.
- **M0** (`market.fr_m0_month`) is recomputed by PowerKlock from RTE's
  curves; it can differ marginally from the CRE's published value.
- **Days with a `flag`** in `market.da_price_day` (broken feeds, e.g. a day
  at 0.00 everywhere) are excluded from the analytics views on purpose.
- **Installed capacity**: only sum rows with `counts_in_total = true`.
- **Clean spark / dark** follow the site's conventions (`meta.convention`):
  CCGT 49.13 %, 0.411 tCO₂/MWh; coal 36 %, 0.947 tCO₂/MWh; gas = TTF
  day-ahead traded the day before delivery.
- **GO prices** (`market.go_quote`) are weekly broker bid/ask per product
  (`GO AIB Renewable`, `… Hydro`, `… Wind`, `… Solar`) and production year;
  mid = (bid + ask) / 2. French state auctions are in `market.go_auction`.
- **CO₂**: `fr_generation_*.co2_g_kwh` is RTE's direct-emission figure;
  life-cycle factors per fuel are in `meta.fuel`. Do not mix them.
- Never average across zones over a period some zones do not cover.

## Main objects

| Topic | Use |
|---|---|
| Day-ahead prices | `analytics.da_price_daily`, `analytics.da_price_hourly`, `analytics.da_price_15min`, `analytics.negative_hours_monthly` |
| Spreads | `analytics.bess_spread_daily` (TB1/TB2/TB4), `analytics.clean_spread_daily` |
| Forwards | `analytics.forward_curve`, `analytics.forward_curve_latest`, `market.forward_contract_close` |
| Fuels and carbon | `analytics.commodity_daily` (TTF, EUA, coal, Brent, FX, gas storage) |
| France generation (RTE) | `analytics.fr_generation_daily`, `analytics.fr_generation_qh`, `market.fr_eco2mix_day` |
| France M0 | `market.fr_m0_month` |
| Other zones' generation | `analytics.generation_daily`, `analytics.generation_slot`, `analytics.capture_price_daily` |
| French regions | `analytics.fr_region_daily`, `analytics.fr_region_load_factor_monthly` |
| Flows | `analytics.crossborder_flow_hourly`, `analytics.net_position_daily` |
| Capacity | `analytics.installed_capacity`, `analytics.installed_capacity_latest` |
| Guarantees of origin | `market.go_quote`, `market.go_auction` |
| Reference | `meta.zone`, `meta.fuel`, `meta.convention`, `meta.dictionary` |
| Data health | `analytics.coverage`, `ops.quality_issue`, `ops.sync_run` |

Full column list: `reference/schema.md`. Tested queries: `reference/queries.md`.
