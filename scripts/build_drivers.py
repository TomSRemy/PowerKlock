#!/usr/bin/env python3
"""Rebuild data/drivers/frames.json, the data of Markets › What drives the price (js/drivers.js).

STUB: not wired to any workflow yet. The current file was produced once from the warehouse (8 Nov 2026) with the
method below; this script documents how to regenerate it and is where the job will live.

Output, one object per maturity (spot, m1, q1, cal):
  w   weekly frames, oldest first: {d: last day of the week (YYYY-MM-DD, delivery day in Paris time for the spot,
      trading day for the forwards), p: price at the end of the week (€/MWh), r: price a week earlier,
      c: {driver: contribution over the week in €/MWh}, x: {driver: level at the end of the week}}
  s   daily price series [[date, €/MWh], ...] (spot: day-ahead base average `avg`; forwards: EEX settlement)
  (to come) i, r2, b: weight of each driver, explained share, pass-through of 1 €/MWh of gas. js/drivers.js reads
      them when present and otherwise uses the values of its SENS table (regressions of 8 Nov 2026).

Drivers: ttf (TTF day-ahead, €/MWh), eua (EUA front December, €/t), coal (API2, $/t), wind, sol, load, nuc (France
daily averages in GW from RTE éCO2mix; nuc = available nuclear capacity), de (German price of the same maturity,
kept as a level only: it is part of the unexplained share).

Method (the Method section of the page):
  1. Window: one year of daily data ending on the last forward settlement.
  2. Forwards (M+1, Q+1, Cal+1 France base, rolling front contracts): ordinary least squares of the daily change of
     the price on the daily changes of ttf, eua, coal and nuc. Spot: OLS of the daily level on the levels of ttf,
     wind, load, nuc and sol.
  3. Weight of a driver = its share of the explained variance (standardised coefficient × correlation, normalised)
     × R² of the regression; drivers under 1 % are dropped. b = coefficient of ttf (€/MWh of power per €/MWh of gas).
  4. Contribution of a driver over a week = coefficient × change of the driver over that week. The unexplained share
     of a week = price change − sum of the contributions (computed by the page, not stored).
  5. Frames are written for the last 52 weeks (fewer for a contract quoted for less time: M+1 since March 2026).

Warehouse tables (Supabase, see the powerklock-sql skill and warehouse/): day-ahead daily averages, forwards
settlements (EEX, France and Germany base), commodities (TTF, EUA, API2), RTE éCO2mix daily (wind, solar, load),
nuclear availability.

Usage once written:  python3 scripts/build_drivers.py   (the warehouse connection comes from the environment, as in the other warehouse jobs: never a file)
"""
import sys


def main() -> int:
    print('build_drivers.py is a stub: data/drivers/frames.json is kept as built on 8 Nov 2026 (see the docstring).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
