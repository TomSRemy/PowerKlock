# The tools, day to day

### 2026-10-27 23:50 · powerklock-78

Live since 27 Oct.: the PPA pricer in four tabs (Inputs and price · The park · Methods as sub-tabs · Compare and
price), the BOA pricer in three (Inputs and result · The battery and its market · Contract structures), the
forecast in three with a map that places the park. Technical details folded, nothing removed.

Ideas to discuss:
- A "simple" entry for first-time readers on each tool (mockup: claude.ai artifact BeGP9zM5qGy9pu849CpCev), or keep
  one layout for everyone.
- Section titles that state the finding of each chart in Analysis ("Solar capture fell 8 points in a year").
- Carbon footprint, comparator, converter: kept as they are (already tabbed, or single working screens).

### 2026-10-28 02:50 · bridge-cse (BOA pricer: are the aFRR paths grounded in data?)

**What we measure** (`data/history/reserves_fr.json`, German aFRR capacity prices from regelleistung.net, 6 blocks a
day each way, since 20 Jan. 2026 — 282 days, too short for a multi-year trend):

| Month 2026 | aFRR DE, 1 MW held both ways all year | FCR FR, 1 MW all year |
|---|---|---|
| Jan / Feb | 110 / 92 | 85 / 73 |
| Mar / Apr / May | 193 / 277 / 286 | 113 / 181 / 175 |
| Jun / Jul / Aug | 294 / 253 / 230 | 222 / 208 / 225 |
| Sep / Oct | 243 / 153 | 214 / 154 |

k€/MW/yr. Strong seasonality (winter ≈ half of spring), no decline visible over nine months.

**The like-for-like comparison.** In the BOA pricer the aFRR line (central: 65 k€/MW/yr at COD 2028, 10 in 2037) is
a slice of a revenue stack, not 1 MW held all year. Our co-optimisation of the same 2 h battery in Germany
(`bess_europe.json`, day-ahead + FCR + aFRR in one schedule) gives the slice directly: last 30 days, aFRR **82.0**,
FCR 66.4, day-ahead 27.5, total 175.9 k€/MW/yr — and October is one of the low months.

**Reading.** The COD values of the pricer are consistent with the data: high (80) ≈ today's German slice held to
2028, central (65) ≈ 20 % lower by 2028, low (50) ≈ the Belgian-style fall. The 2037 values (6 / 10 / 18) cannot be
checked: nine months of German prices and no French aFRR price yet. Caveats: the German capacity auction is
pay-as-bid, so a new bidder earns its own bid, not the average; Germany is not France (RTE procures far less aFRR).

**Proposal** (no change to the pricer without your yes): keep the three paths; say under the scenario table that
the COD values sit at or below today's measured German slice (82 k€/MW/yr, last 30 days) and show that figure live
next to them, as the FCR price already is. Re-anchor once RTE's French aFRR capacity prices are subscribed (the
Balancing Capacity API you parked). **→ Tom**

### 2026-10-28 03:20 · bridge-cse (Production forecast: how good is it, and does the monthly correction help in 2026?)

Recomputed from the backtest's own data (`scripts/fcst_backtest.py`: RTE regional load factors, Open-Meteo forecast
issued the day before, walk-forward by month, Feb. 2024 – Aug. 2026), now split by year. Error = mean |forecast −
actual| ÷ capacity, hourly (solar on daylight hours). Only the day-ahead horizon exists in this backtest (the weather
archive used is the forecast of the day before); other horizons are not measured yet.

| Region, technology | 2024 | 2025 | 2026 (Jan–Aug) |
|---|---|---|---|
| Solar Occitanie: raw → best (v1 → v6) | 9.1 → 8.4 % | 8.9 → 5.5 % | 8.9 → 4.5 % |
| Solar Nouvelle-Aquitaine | 8.2 → 7.5 % | 8.2 → 5.3 % | 8.0 → 4.5 % |
| Solar Provence-Alpes-Côte d'Azur | 9.7 → 8.9 % | 9.9 → 5.5 % | 10.4 → 4.7 % |
| Wind Hauts-de-France | 8.4 → 4.7 % | 8.9 → 4.8 % | 8.8 → 4.9 % |
| Wind Grand Est | 6.7 → 6.5 % | 6.2 → 5.8 % | 6.5 → 6.0 % |
| Wind Centre-Val de Loire | 6.2 → 5.7 % | 7.1 → 5.6 % | 7.5 → 5.4 % |
| Wind Occitanie | 9.9 → 8.1 % | 8.6 → 8.1 % | 8.0 → 7.4 % |

The gains come from the hour-of-day shape learned on each regional fleet and from several weather models together;
they grow as the history lengthens (solar halves its error from 2025).

**The monthly solar factor the tool applies to a single park** (`fcst_calib.json`, one factor per calendar month)
does not help out of sample: learned on the months before 2025, it makes 2025 worse in all three solar regions
(Occitanie 8.54 → 9.47 %, Nouvelle-Aquitaine 7.91 → 9.05 %, PACA 9.50 → 10.11 %); learned before 2026, it is neutral
or worse in 2026 (8.64 → 8.62, 7.73 → 8.80, 10.01 → 10.34). It only looks useful when measured on the period it was
learned on (2026: 8.08 / 8.23 / 9.54). Proposal: stop applying it to a single park (keep the raw model, or the park's
own metering when there is one), and say so in "How good is it". **→ Tom**
