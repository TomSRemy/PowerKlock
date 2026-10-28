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

### 2026-10-28 01:10 · bridge-cse (methods and tests)

**On point 1 (which price the site publishes).** Agreed: one definition everywhere, switched the same day on
the widgets, the morning brief, the alerts, the Comparator and the pricer's default. Correction to the table
above: live today, the widgets show the capacity trend (≈ 55 €/MWh solar) and only the pricer shows the
3-method average (48.99). My branch keeps it that way — the European model is shown in the pricer as a card
you can tick, not ticked by default — and `scripts/ppa_daily.py` now records two more fields every day,
`eu` (European model) and `blend4` (4-method average), so the 4-method series builds a history before any
switch. Today: solar `eu` 42.41, `blend4` 47.34; wind `eu` 85.43, `blend4` 80.37 (published `ppa`
unchanged: 55.47 and 76.15, checked to the cent on the frozen data).

**What the data say about the definition** (`scripts/ppa_horizon_test.py`): each delivery year 2024–2026
priced 1, 2 and 3 years ahead (the benchmark covers Cal+1 … Cal+3), with only the years known at the time.
Mean absolute error, €/MWh, convention with output stopped at prices ≤ 0 | all hours paid. Small sample
(three years, 2026 to date).

| Solar | 1 year ahead | 2 years | 3 years |
|---|---|---|---|
| Capacity trend (published today) | 0.99 \| 2.95 | 2.10 \| 4.84 | 4.69 \| 11.13 |
| Forward shape | 5.30 \| 4.80 | 7.28 \| 10.42 | 9.54 \| 16.43 |
| Weather simulation | 6.34 \| 7.14 | 4.49 \| 9.41 | 0.99 \| 9.59 |
| European model | 2.35 \| 7.78 | 3.21 \| 4.62 | 2.93 \| 2.16 |
| Average of 3 (no European) | 0.85 \| 3.19 | 1.99 \| 5.62 | 4.37 \| 12.38 |
| Average of 4 | **0.31** \| 2.99 | **1.65** \| **3.84** | 4.01 \| 9.59 |

| Wind | 1 year ahead | 2 years | 3 years |
|---|---|---|---|
| Capacity trend | 2.64 \| 2.36 | 1.86 \| 2.92 | 4.16 \| 3.90 |
| Forward shape | 2.80 \| 3.64 | 3.27 \| 4.35 | 3.35 \| 3.18 |
| Weather simulation | 1.89 \| 3.23 | 2.71 \| 3.60 | 2.94 \| 3.76 |
| European model | 6.71 \| 2.43 | 6.76 \| 2.90 | 3.82 \| 3.05 |
| Average of 3 | 2.44 \| 2.70 | 2.02 \| 3.62 | 3.48 \| 3.28 |
| Average of 4 | 2.19 \| 2.63 | 2.41 \| 3.44 | 2.59 \| 3.16 |

Reading: the trend methods lose accuracy with the horizon; the European model holds (it reprices with each
year's fleet). The 4-method average beats the 3-method one at every horizon for solar, and stays within
0.4 €/MWh of the best single method for wind. My recommendation: publish the 4-method average, after two to
three weeks of `blend4` history so the switch is not read as a market move (alerts compare 7 days apart). **→ Tom**

**European model, what I found tonight.**
- The "clipping bug" I reported on 27 Oct. is not one. Its flat edge reads the potential (pre-curtailment)
  oversupply the pricer feeds it as curtailed, which is right: every alternative tail tested loses in the
  walk-forward (bounded tail: solar 2.35 → 2.97 €/MWh; France-only training: deep French oversupply hours were
  export hours with positive prices, 96 % of them). Code unchanged; tests in `scripts/ppa_tail_test.py`,
  `ppa_tail_walkforward.py`, `ppa_regional_clip_fix.py`.
- Its real limit: no future storage or flexible demand, so the region saturates at midday from about 2028 and
  France's own capacity barely moves it. Size of the effect (`scripts/ppa_storage_sensitivity.py`, batteries
  of 2 h in France, Germany, Belgium and Spain): solar capture +1.7 / +3.7 / +8.4 points in 2030 with 10 / 20 /
  40 GW; wind under 2 points. Worth a sourced storage path (RTE Bilan prévisionnel, German NEP), not enough to
  change which methods hold. **→ Tom**: which source for the storage path?
- Monte Carlo: 27 ms per draw; 300 draws keep P10–P90 within 0.5 €/MWh from one seed to another
  (`scripts/ppa_mc_stability.py`); 20,000 only matter for P1/P99.

**Other changes on the branch** (details in the debrief): Past discount shown as "reference, not for pricing"
and never in the average; fixed French method names (Décote P74, Modèle européen); stress "Gas crisis like
2022" now per technology from history (solar −16 pts, wind +9 pts, instead of −5 for both — wrong sign for
wind); Compare and Methodology complete in French and English; the price buttons open their tab in French.

**Still to decide** **→ Tom**: (a) the published definition above; (b) single 2022 rule for the wind European
model, today trained with 2022 — without it, 2024-2026 error 6.71 → 8.18 €/MWh (stopped at ≤ 0), 2.43 → 2.33
(all hours); (c) the 2022 slide mockup (`docs/maquettes/diapo_2022.png` on the pricer branch): solar 2022
capture 104.6 % = season effect 1.080 × hour-of-day effect 0.969 — the year's price peak fell in summer.
