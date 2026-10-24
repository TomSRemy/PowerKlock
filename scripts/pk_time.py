"""The delivery day on the zone's own clock, shared by the price readers
(scripts/fetch_data.py, scripts/enrich_summary.py; tests/test_prices_dst.py)."""
from datetime import datetime, timedelta, timezone


def local_slots(best, carry_forward):
    """96 quarter-hour values of the delivery day on the zone's own clock.
    best: the ENTSO-E period kept ({'start', 'end', 'res_minutes'}); carry_forward(n): its n values.
    A normal day has 96 quarter-hours (24 hours). The clock-change days do not: the last Sunday
    of October has 100 (one hour twice), the last Sunday of March 92 (one hour skipped). All
    European zones change at the same instant, 01:00 UTC, so each position is placed by its local
    time: the repeated hour is averaged into its slots, the skipped hour left empty (never filled
    with a copy of the previous price)."""
    res = best['res_minutes']
    std = 24 * 60 // res
    n = std
    if best.get('start') and best.get('end'):
        n = int(round((best['end'] - best['start']).total_seconds() / 60 / res))
    if n not in (std - 60 // res, std, std + 60 // res):
        n = std                                    # unexpected length: keep the plain grid
    vals = carry_forward(n)
    per = res // 15
    if n == std or not best.get('start'):
        return [v for v in vals for _ in range(per)]
    day = (best['start'] + timedelta(hours=12)).date()
    switch = datetime(day.year, day.month, day.day, 1, 0, tzinfo=timezone.utc)
    shift = -60 if n > std else 60                 # long day: the clock goes back an hour; short day: forward
    acc = {}
    for i, v in enumerate(vals):
        t = best['start'] + timedelta(minutes=res * i)
        local = res * i + (shift if t >= switch else 0)
        for q in range(per):
            k = (local + 15 * q) // 15
            if 0 <= k < 96 and v is not None:
                acc.setdefault(k, []).append(v)
    return [round(sum(acc[k]) / len(acc[k]), 4) if k in acc else None for k in range(96)]
