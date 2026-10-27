# The PPA pricer

### 2026-10-27 23:50 · powerklock-78 (audit and corrections)

**1. One PPA price, or three?** Today the same French solar park reads three different "PPA prices" on the site:

| Where | What it shows | Solar, 27 Oct. |
|---|---|---|
| Dashboard widget "PPA benchmark", morning brief, Comparator, alerts | capacity trend alone (`ppa` in `ppa_benchmark.json`) | ≈ 55 €/MWh |
| Pricer, tab 1 "PPA price" (live since 27 Oct.) | average of the ticked methods, 3 by default (capacity trend, forward shape, weather simulation) | 48.99 €/MWh |
| Pricer on branch `claude/pricer-feedback-m08jy8` (not live) | average of 4, the European model added | 47.34 €/MWh |

Proposal: one definition everywhere — the published benchmark is what the pricer shows by default (the average
of the default methods), with its history rebuilt and flagged as rebuilt; the capacity trend stays visible as one
method among others. Until the European model has a history, publish the 3-method average. **→ Tom**

**2. Calendar days (holidays, school breaks).** `scripts/fetch_calendar_days.py` reads open data (api.gouv,
data.education.gouv) but has no job: the file would freeze. If a page or the pricer uses it, it needs a yearly
workflow (CLAUDE.md: only sources that update by themselves).

**3. Before the branch reaches the site**: full `scripts/check_before_push.sh`, the new method in Methodology in
both languages, and the widgets aligned with point 1.

### Open questions for the brainstorm
- Which method should the site trust most, per technology? The replay says forward shape for solar (4.9 pts of
  error), capacity trend for wind (1.5 pts).
- Should the published price be a P50 or a P-something with risk (the pricer uses a 25 % chance of loss)?
- How should batteries and flexibility enter the solar discount after 2028 (the European model has no future
  storage; the other session measured +3 to +10 capture points with 20–40 GW of batteries)?
