-- requires: auth
-- ════════════════════════════════════════════════════════════════════
-- PowerKlock · 011 · alert on the French Cal+1: the France-specific part
-- of the day's move (what gas and CO₂ do not explain) above a threshold
-- (€/MWh, in absolute value). Evaluated by scripts/alerts.py.
-- ════════════════════════════════════════════════════════════════════
alter table public.alert_rule drop constraint if exists alert_rule_kind_check;
alter table public.alert_rule add constraint alert_rule_kind_check
  check (kind in ('neg_price', 'pp1', 'pp2', 'base_above', 'base_below', 'fwd_fr'));
