-- ════════════════════════════════════════════════════════════════════
-- PowerKlock warehouse · 005 · data-quality checks
-- ops.run_quality_checks() is called after every sync. Issues are upserted
-- into ops.quality_issue (one row per dataset / zone / day / check) and
-- the ones that no longer hold are deleted, so the table is the current
-- list of known problems.
-- ════════════════════════════════════════════════════════════════════
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

comment on table ops.quality_issue is 'Current known data problems (refreshed after every sync): flat zero days, out-of-range prices, stale copies, missing days, unpublished generation, stale commodity series.';
comment on table ops.sync_run is 'One row per warehouse sync (GitHub Actions), with status and row counts.';
