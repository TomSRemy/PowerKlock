-- requires: the alert tables (alert_rule)
-- Alerts on the annual forward contracts (Cal+1, +2, +3) of France, Germany, the Netherlands and the United Kingdom
-- (data/history/fr_market_calchain.json): cal_move (a move over one day or one week, in €/MWh or %), cal_above and
-- cal_below (the price crosses a level). They replace fwd_fr (the France-specific part of the French Cal+1 move), which
-- no rule used. A rule's own settings (country, contract, period, unit) go in params.
alter table public.alert_rule add column if not exists params jsonb not null default '{}'::jsonb;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.alert_rule'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.alert_rule drop constraint %I', c);
  end loop;
end $$;
delete from public.alert_rule where kind = 'fwd_fr';
alter table public.alert_rule add constraint alert_rule_kind_check check (kind = any (array['neg_price', 'pp1', 'pp2', 'base_above', 'base_below',
  'cal_move', 'cal_above', 'cal_below', 'ppa_move', 'corr_break']));
