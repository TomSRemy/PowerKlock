# Merit order: test bench (31 Oct. 2026)

Code to run outside the site: `fetch_full.py` fetches the neighbours' hourly generation by type from Energy-Charts into
/tmp/mo/full; `merit.py` is the model (France + central-western Europe DE/BE/NL/AT/CH, coupled at the French border;
Italy, Spain and Britain as the day's exchanges); `calib*.py` set the free parameters on 2021 and 2023 only and test 2024–2025.

## Results, second night (true weather, hourly price error €/MWh; parameters set on 2021 + 2023 only)
| | 2021 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| current rule | 20.6 | 16.9 | 23.9 | 19.4 |
| merit order v1 | 27.8 | 24.9 | 31.0 | 24.2 |
| merit order v2 | **17.0** | **16.0** | **17.6** | **19.3** |

v2 = observed offer curves (French nuclear: price ÷ CCGT cost by use of the available fleet, learnt on the two last
years; central-western thermal fleet: Germany's price ÷ CCGT cost by use, winter and summer apart), the nuclear
minimum as the lowest seen over all previous years, a monthly effective export room (median export when France
was cut off), negative bids at last year's observed depth, flexible renewables bidding around zero (−3 to +3 €).

Captures on the true weather (output stopped at ≤ 0, €/MWh): wind 0.81 / 4.59 / 3.56 / 0.09 (rule 2023–2025: 1.55 /
1.06 / 2.44); solar 1.79 / 0.78 / 3.43 / −1.64 (rule 2.51 / 0.92 / 2.49).

Generator replay (`genmo.py`: drawn real weeks on the delivery year's fleets, nothing of the delivery year known), same
9 cases 2023–2025 × 1–3 years ahead: solar 2.63 €/MWh against 0.59 for the current generator, wind 2.91 against 2.49.
One year ahead it is better for wind (1.91 against 2.28) but not for solar (0.60 against 0.46); two and three years
ahead it breaks down (curves learnt on 2020–2021, before the crisis and the French cut-off regime, do not carry over).

Tried and left out: the thermal curve as a markup over the cost-based stack (coal–gas switching), worse on calibration
(no coal price before 2022).

## What it taught
- France is more and more cut off from Germany: its price 5 € or more below Germany's in 629 h in 2021, 1,496 in 2023,
  4,374 in 2024, 5,460 in 2025 (63 % of hours). The cut comes at a median export of ≈ 6.4 GW to its central-western
  neighbours, well below the line capacity (≈ 10 GW): flow-based coupling limits it.
- 67 % of French wind MWh fell in those hours in 2025, where the current rule is +6.9 € too high (+10 € weighted by
  wind), while it is −6.4 € too low in coupled hours: this is the wind overvaluation.
- France's nuclear offer, read on last year's cut-off hours: almost free below 80 % use of the available fleet, then
  rising to the CCGT cost near 100 %.
- A two-regime rule (cut off / coupled) built on this did worse on the true weather and in the replay.

## What a usable merit order still needs
Flow-based coupling (the export room moves with the grid situation, not a constant), the nuclear offer and hydro water
values that move with the fuel prices, Italy/Spain/Britain modelled rather than taken as given.

## Third pass (31 Oct. 2026, with the new data in the site)
The model now lives in `scripts/ppa_merit.py` and reads the site's data: neighbours' output by type
(data/history/region_hourly), France's hourly Core export / import limit (data/history/jao_core, JAO), coal before 2022
(data/history/coal_monthly.json, World Bank), Britain (data/history/gb_hourly). Central-western zone = Core
neighbours DE, BE, NL, AT; Switzerland, Britain, Italy, Spain enter as the day's exchanges.

- France's maximum Core export fell: 9.2 GW on average in 2023, 7.6 in 2024, 5.4 in 2025, which is why France is cut off
  more and more. When it is cut off, its physical export is 70–90 % of JAO's commercial limit; the model uses that ratio
  (last two years' median) times the hour's limit.
- True weather, output stopped at ≤ 0, mean error 2023–2025: wind 1.54 €/MWh against 1.68 for the rule, solar 1.13
  against 1.97.
- Generator replay (`genmo2.py`), 9 cases 2023–2025 × 1–3 years ahead: solar 3.24 against 0.59 for the current
  generator, wind 2.66 against 2.49. On the cases learnt after the crisis (known year 2023 or later): wind 1.65 against
  2.08, solar 1.28 against 0.48. Two and three years ahead from 2020–2021 it fails (curves from before the crisis and the
  cut-off regime). Learning on 2022 as well: worse.
- Solar is fragile: on the delivery year's own weather, the replay's assumptions (fleet guessed, demand and nuclear
  availability as last year's monthly means, flat fuel prices, output per GW levelled) move solar by about 3 €/MWh
  (`sanity.py`). To understand before going further.
