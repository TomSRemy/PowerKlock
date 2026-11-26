-- requires: 010_alerts.sql, 038_alert_cal.sql
-- One « PP day » alert (kind 'pp') instead of PP1 and PP2: since 1 November 2026 the reformed capacity mechanism has a
-- single peak-day signal from RTE (the owner, 26 Nov. 2026). Rules saved as pp1 or pp2 become pp (one per member).
-- Applied 26 Nov. 2026 (no pp1 / pp2 rule existed); tests/test_consistency.py checks this list against the site.
alter table public.alert_rule drop constraint if exists alert_rule_kind_check;
delete from public.alert_rule r where r.kind = 'pp2'
  and exists (select 1 from public.alert_rule o where o.user_id = r.user_id and o.kind = 'pp1');
update public.alert_rule set kind = 'pp' where kind in ('pp1', 'pp2');
alter table public.alert_rule add constraint alert_rule_kind_check check (kind = any (array['neg_price', 'pp', 'base_above', 'base_below',
  'cal_move', 'cal_above', 'cal_below', 'ppa_move', 'corr_break']));
