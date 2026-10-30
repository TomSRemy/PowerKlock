# Merit order: test bench (31 Oct. 2026)

Code to run outside the site: `fetch_full.py` fetches the neighbours' hourly generation by type from Energy-Charts into
/tmp/mo/full; `merit.py` is the model (France + central-western Europe DE/BE/NL/AT/CH, coupled at the French border;
Italy, Spain and Britain as the day's exchanges); `calib*.py` set the free parameters on 2021 and 2023 only and test 2024–2025.

## Results (true weather, hourly price error €/MWh)
| | 2021 | 2023 | 2024 | 2025 |
|---|---|---|---|---|
| current rule | 20.6 | 16.9 | 23.9 | 19.4 |
| merit order, best version | 27.8 | 24.9 | 31.0 | 24.2 |

Captures are further off than the rule's (wind, output stopped at ≤ 0: +6 to +35 €/MWh against +1 to +2.5). Not usable yet.

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
