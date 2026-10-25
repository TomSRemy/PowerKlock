-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 020 · two more alert kinds, evaluated by scripts/alerts.py:
--   ppa_move    the PPA benchmark (solar or wind, data/history/ppa_benchmark.json)
--               moved by at least `threshold` €/MWh over the last 7 days
--   corr_break  a watched pair's correlation (data/corr_watch.json) moved by at
--               least `threshold` (e.g. 0.3) between the last year and the last 60 days
-- ════════════════════════════════════════════════════════════════════
alter table public.alert_rule drop constraint if exists alert_rule_kind_check;
alter table public.alert_rule add constraint alert_rule_kind_check
  check (kind in ('neg_price', 'pp1', 'pp2', 'base_above', 'base_below', 'fwd_fr', 'ppa_move', 'corr_break'));
