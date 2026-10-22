-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 013 · PPA pricing data: monthly forward over the quoted
-- horizon, capture rates by country and by French region, the pricer's
-- monthly capture forecasts and its replay errors
-- (scripts/build_forward_monthly.py, fetch_country_capture.py,
--  fetch_fr_regions_capture.py, ppa_lab.py)
-- ════════════════════════════════════════════════════════════════════
create table if not exists market.forward_month (
  market        text not null,              -- FR
  month         date not null,              -- first day of the delivery month
  value         double precision not null,  -- €/MWh, baseload
  from_contract text,                       -- the listed contract it comes from (Apr2027, Q32027, Cal2029 …)
  peak_ratio    double precision,           -- market peak ÷ base of the finest listed peak contract
  as_of         date not null,              -- settlement date of the contracts used
  primary key (market, month)
);
comment on table market.forward_month is 'Baseload forward of each delivery month: the month contract, else its quarter, season or Cal shaped by day-ahead ratios, matched to every listed contract.';

create table if not exists market.capture_country_year (
  country       text not null,              -- FR, DE, BE, NL, ES, UK
  year          int  not null,
  tech          text not null check (tech in ('solar', 'wind')),
  convention    text not null check (convention in ('all', 'pos')),
  capture_rate  double precision,           -- capture price ÷ baseload
  installed_gw  double precision,
  avg_load_gw   double precision,
  output_twh    double precision,
  negative_hours int,
  baseload      double precision,           -- €/MWh (UK: £/MWh, intraday index)
  complete      boolean,
  primary key (country, year, tech, convention)
);
comment on table market.capture_country_year is 'Solar and wind capture rates per country and year (Energy-Charts; UK from Elexon and PV_Live). all = every hour; pos = hours with a price > 0, baseload over the same hours.';

create table if not exists market.capture_region_year (
  region_code   text not null,              -- INSEE region code
  region        text not null,
  year          int  not null,
  tech          text not null check (tech in ('solar', 'wind')),
  convention    text not null check (convention in ('all', 'curt', 'pos')),
  capture_rate  double precision,
  gap_to_national double precision,         -- capture points ÷ 100 against the sum of the regions
  paid_share    double precision,           -- share of output at prices > 0
  output_twh    double precision,
  complete      boolean,
  primary key (region_code, year, tech, convention)
);
comment on table market.capture_region_year is 'Capture rate of each French region (RTE éCO2mix regional) against the national day-ahead price; curt = output at prices ≤ 0 curtailed, baseload over all hours.';

create table if not exists analytics.ppa_forecast_month (
  tech          text not null check (tech in ('solar', 'wind')),
  convention    text not null check (convention in ('all', 'curt')),
  month         date not null,
  ensemble      double precision,           -- capture rate used by the pricer (average of the four methods)
  step          double precision,
  fpc           double precision,
  regional      double precision,
  regional_mc   double precision,
  weather       double precision,
  dashboard     double precision,
  p10           double precision,           -- simulated weather spread of the regional model
  p90           double precision,
  paid_share    double precision,           -- share of output paid (curtailment)
  negative_hours double precision,
  installed_gw  double precision,           -- French capacity assumed (PPE3 path)
  as_of         date not null,
  primary key (tech, convention, month)
);
comment on table analytics.ppa_forecast_month is 'Monthly capture-rate forecasts of the PPA pricer (scripts/ppa_lab.py), national profile, weekly.';

create table if not exists analytics.ppa_replay_year (
  tech          text not null,
  convention    text not null,
  year          int  not null,
  method        text not null,              -- ensemble (hybrid), step, fpc, regional, regionalMC, weather, dashboard
  error_pts     double precision,           -- predicted − realised capture rate, production-weighted, points
  error_eur     double precision,           -- the same in €/MWh of capture value
  primary key (tech, convention, year, method)
);
comment on table analytics.ppa_replay_year is 'Replay of the pricer methods: each year priced with earlier data only (2022 left out).';
