-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 001 · base schema
-- ════════════════════════════════════════════════════════════════════
-- Mirror of the PowerKlock data files (GitHub repo = source of truth).
-- Rebuildable at any time with `python warehouse/sync.py --full`.
--
-- Schemas
--   market     raw facts, one row per zone and day (intraday values kept
--              as arrays: 96 quarter-hours or 24 hours) → small and durable
--   analytics  views for analysis (15-min, hourly, daily, capture, spreads…)
--   meta       reference data and the data dictionary
--   ops        sync runs, file states, quality issues, migrations
--
-- Conventions (apply to every table)
--   * delivery_date is the delivery day in Europe/Paris (CET/CEST).
--   * Intraday arrays are indexed on the Paris clock: slot 1 = 00:00–00:15
--     (or 00:00–01:00 for hourly arrays). The grid is always 96 (or 24)
--     slots, including on clock-change days.
--   * Prices in EUR/MWh unless the currency column says otherwise; power in MW.
-- ════════════════════════════════════════════════════════════════════

create schema if not exists market;
create schema if not exists analytics;
create schema if not exists meta;
create schema if not exists ops;

-- ── ops ──────────────────────────────────────────────────────────────
create table if not exists ops.sync_run (
  run_id       bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  mode         text not null,                      -- incremental | full
  status       text not null default 'running',    -- running | ok | failed
  files_read   int default 0,
  rows_written int default 0,
  git_commit   text,
  message      text
);

-- Content hash of every source file already loaded (incremental sync).
create table if not exists ops.file_state (
  path       text primary key,
  sha256     text not null,
  loaded_at  timestamptz not null default now()
);

create table if not exists ops.quality_issue (
  issue_id     bigserial primary key,
  detected_at  timestamptz not null default now(),
  dataset      text not null,          -- da_price | generation | commodity | forward
  zone         text,
  day          date,
  severity     text not null,          -- error | warning | info
  check_name   text not null,
  detail       text,
  unique (dataset, zone, day, check_name)
);

-- ── meta ─────────────────────────────────────────────────────────────
create table if not exists meta.zone (
  zone      text primary key,          -- ENTSO-E bidding zone code used across PowerKlock (FR, DE_LU, IT_NORD…)
  name      text not null,
  country   text,
  eic       text,
  timezone  text not null default 'Europe/Paris'
);

create table if not exists meta.fuel (
  fuel        text primary key,        -- nuclear, hydro, wind, wind_onshore, … or psr:B04 for ENTSO-E production types
  label       text not null,
  family      text not null,           -- nuclear | renewable | fossil | other
  co2_g_kwh   real,                    -- life-cycle emission factor used by PowerKlock (IPCC AR5 medians, g CO2 / kWh)
  description text
);

-- Fuel-cost conventions shared with the site (js/commodities.js PKC.FUEL).
create table if not exists meta.convention (
  key         text primary key,
  value       double precision not null,
  unit        text,
  description text not null
);

-- ── market: facts ────────────────────────────────────────────────────
create table if not exists market.da_price_day (
  zone            text not null references meta.zone(zone),
  delivery_date   date not null,
  resolution_min  smallint not null default 15,      -- native resolution of the auction (15 or 60); prices[] is always 96 slots
  prices          real[] not null,                    -- 96 quarter-hour prices, EUR/MWh, Paris clock
  avg             real,
  min             real,
  max             real,
  peak_avg        real,                               -- 08:00–20:00
  offpeak_avg     real,
  neg_hours       real,                               -- hours with price < 0
  flag            text,                               -- null = valid; otherwise why the day is excluded from analytics (e.g. flat_zero_feed)
  source          text not null default 'ENTSO-E A44',
  loaded_at       timestamptz not null default now(),
  primary key (zone, delivery_date)
);
create index if not exists da_price_day_date on market.da_price_day (delivery_date);

create table if not exists market.generation_day (
  zone            text not null references meta.zone(zone),
  delivery_date   date not null,
  fuel            text not null references meta.fuel(fuel),
  slots           smallint not null,                  -- 96 (15-min) or 24 (hourly)
  mw              real[] not null,                    -- average output per slot (MW), Paris clock; null = not published
  source          text not null default 'ENTSO-E A75',
  loaded_at       timestamptz not null default now(),
  primary key (zone, delivery_date, fuel)
);
create index if not exists generation_day_date on market.generation_day (delivery_date);

create table if not exists market.load_day (
  zone            text not null references meta.zone(zone),
  delivery_date   date not null,
  slots           smallint not null,
  actual_mw       real[],
  forecast_mw     real[],                             -- day-ahead load forecast
  source          text not null default 'ENTSO-E A65',
  loaded_at       timestamptz not null default now(),
  primary key (zone, delivery_date)
);

create table if not exists market.commodity (
  key       text primary key,          -- ttf, eua, coal, brent, eurusd, agsi, fr_nuc_avail…
  name      text not null,
  unit      text,
  contract  text,
  source    text not null default 'SEFE Energy market cockpit'
);

create table if not exists market.commodity_close (
  key         text not null references market.commodity(key),
  trade_date  date not null,
  value       double precision not null,
  primary key (key, trade_date)
);

create table if not exists market.forward_settlement (
  market      text not null,           -- FR, DE, NL, UK
  trade_date  date not null,
  tenor       text not null,           -- M+1 … Y+3 (rolling products)
  value       double precision not null,
  currency    text not null,           -- EUR or GBP
  source      text not null default 'SEFE Energy market cockpit',
  primary key (market, trade_date, tenor)
);

create table if not exists market.forward_contract_close (
  market      text not null,
  contract    text not null,           -- Cal2027 …
  trade_date  date not null,
  value       double precision not null,
  currency    text not null,
  primary key (market, contract, trade_date)
);

create table if not exists market.spot_reference (
  market      text not null,
  trade_date  date not null,
  value       double precision not null,
  currency    text not null,
  primary key (market, trade_date)
);

create table if not exists market.go_quote (
  quote_date  date not null,           -- weekly quote date
  product     text not null,           -- e.g. GO AIB Renewable
  production_year int not null,
  term        text,
  bid         double precision,
  ask         double precision,
  source      text not null default 'Commerg',
  primary key (quote_date, product, production_year)
);

create table if not exists market.go_auction (
  auction_month   date not null,       -- first day of the auctioned production month
  technology      text not null,
  offered_mwh     double precision,
  allocated_mwh   double precision,
  price_eur_mwh   double precision,
  source          text not null default 'EEX French GO auctions',
  primary key (auction_month, technology)
);
