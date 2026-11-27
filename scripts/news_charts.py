"""
The newsletter's charts, drawn as PNG images (mail clients do not show charts drawn in code):

  - the chart of the lead story (« À la une »), chosen by the story's own words: M0, spot, gas, carbon, guarantees of
    origin, nuclear availability, forwards, negative prices. A story that matches none has no chart.
  - PowerBrunch: France spot of the week before, day by day, with a numbered marker on each dated event of the week
    (data/events.json). No event, no marker.

Every chart reads the repository's data files, the same as the site's pages, and names its source.
Out data/newsletter_img/<name>.png (light background for the mail; the site shows the same file).
"""
import json
import os
import re
from datetime import date, timedelta

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data")
IMG = os.path.join(D, "newsletter_img")
MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
INK, GRID, MUTED, LINE, MARK = "#121212", "#E6E6E6", "#6B6B6B", "#0B7A62", "#B8322D"


def load(*p):
    try:
        with open(os.path.join(D, *p)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def day_avg(d):
    return (((load("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get("FR") or {}).get("avg")


def day_neg(d):
    return (((load("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get("FR") or {}).get("negH")


# ── series, each [(label, value)] with its title, unit, source and page of the site ──
def s_m0(today):
    off = (load("cre_m0.json") or {}).get("official") or {}
    sol, win = off.get("solar") or {}, off.get("wind") or {}
    ks = sorted(sol)[-12:]
    if len(ks) < 6:
        return None
    return {"title": "M0 publiés par la CRE, 12 derniers mois", "unit": "€/MWh", "src": "CRE", "page": "renewables/m0",
            "lines": [("Solaire", [(MOIS[int(k[5:]) - 1], sol[k]) for k in ks]), ("Éolien", [(MOIS[int(k[5:]) - 1], win.get(k)) for k in ks])]}


def s_spot(today):
    pts = [(f"{d.day}", day_avg(d)) for d in (today - timedelta(days=k) for k in range(20, -1, -1))]
    pts = [p for p in pts if p[1] is not None]
    if len(pts) < 7:
        return None
    return {"title": "Spot France, 3 dernières semaines (moyennes journalières)", "unit": "€/MWh", "src": "ENTSO-E", "page": "markets/spot", "lines": [("Spot", pts)]}


def s_commo(key, title, unit, page):
    def f(today):
        cs = (load("history", "commodities_series.json") or {}).get("series") or (load("commodities.json") or {}).get("series") or {}
        p = [x for x in ((cs.get(key) or {}).get("points") or []) if x[1] is not None][-60:]
        if len(p) < 10:
            return None
        return {"title": title, "unit": unit, "src": "PowerKlock", "page": page, "lines": [(title.split(",")[0], [(f"{int(str(d)[8:10])} {MOIS[int(str(d)[5:7]) - 1]}", v) for d, v in p])]}
    return f


def s_go(today):
    import csv
    try:
        with open(os.path.join(D, "go_prices.csv")) as fh:
            rows = [r for r in csv.DictReader(fh) if r.get("term", "").replace(" ", "") == "Y+1" and r.get("bid")]
    except OSError:
        return None
    rows.sort(key=lambda r: r["mail_date"])
    rows = rows[-26:]
    if len(rows) < 6:
        return None
    mid = lambda r: (float(r["bid"]) + float(r["ask"])) / 2 if r.get("ask") else float(r["bid"])  # noqa: E731
    return {"title": "Garanties d'origine, année suivante, 6 derniers mois", "unit": "€/MWh", "src": "Commerg", "page": "markets/go",
            "lines": [("GO", [(f"{int(r['mail_date'][8:10])} {MOIS[int(r['mail_date'][5:7]) - 1]}", mid(r)) for r in rows])]}


def s_cal(today):
    ch = (load("history", "fr_market_calchain.json") or {}).get("FR") or {}
    y1 = str(today.year + 1)
    cy = (ch.get("years") or {}).get(y1)
    if not cy:
        return None
    p = [(d, v) for d, v in zip(cy["dates"], cy["values"]) if v is not None][-60:]
    if len(p) < 10:
        return None
    return {"title": f"Cal {y1[2:]} France, 3 derniers mois de cotation", "unit": "€/MWh", "src": "EEX", "page": "markets/forwards",
            "lines": [("Cal", [(f"{int(str(d)[8:10])} {MOIS[int(str(d)[5:7]) - 1]}", v) for d, v in p])]}


def s_neg(today):
    pts = [(f"{d.day}", day_neg(d)) for d in (today - timedelta(days=k) for k in range(29, -1, -1))]
    pts = [p for p in pts if p[1] is not None]
    if len(pts) < 10 or not any(v for _, v in pts):
        return None
    return {"title": "Heures à 0 € ou moins en France, 30 derniers jours", "unit": "h", "src": "ENTSO-E", "page": "markets/spot/negative", "bars": True, "lines": [("Heures", pts)]}


def s_ppa(today):
    bm = (load("history", "ppa_benchmark.json") or {}).get("days") or {}
    ks = sorted(bm)[-90:]
    if len(ks) < 10:
        return None
    lab = lambda d: f"{int(d[8:10])} {MOIS[int(d[5:7]) - 1]}"  # noqa: E731
    return {"title": "Benchmark PPA France, solaire et éolien, 3 derniers mois", "unit": "€/MWh", "src": "PowerKlock", "page": "tools/ppa",
            "lines": [("Solaire", [(lab(d), (bm[d].get("solar") or {}).get("ppa")) for d in ks]), ("Éolien", [(lab(d), (bm[d].get("wind") or {}).get("ppa")) for d in ks])]}


# the story's own words → its chart (the first that matches and has data)
RULES = [
    (r"\bppas?\b|power purchase agreement|contrat d.achat direct", s_ppa),
    (r"\bm0\b|compl[ée]ment de r[ée]mun[ée]ration|prix de capture|capture|cannibali|appel d.offres (cre|ppe)", s_m0),
    (r"prix n[ée]gatif|heures? n[ée]gative|negative price", s_neg),
    (r"garanties? d.origine|guarantees? of origin|\bgos?\b", s_go),
    (r"\bpeg\b|\bttf\b|prix du gaz|gas price|\bgnl\b|\blng\b", s_commo("peg", "Gaz PEG, day-ahead, 2 derniers mois", "€/MWh", "markets/fuels")),
    (r"\beua\b|quotas? carbone|co2|carbon price|ets\b", s_commo("eua", "CO₂ EUA décembre, 2 derniers mois", "€/t", "markets/fuels")),
    (r"nucl[ée]aire|\bedf\b.*r[ée]acteur|disponibilit[ée] du parc|\bepr2?\b", s_commo("fr_nuc_avail", "Nucléaire disponible en France, 2 derniers mois", "MW", "system/generation/nuclear")),
    (r"\bcal\b|forward|march[ée] [àa] terme|contrat annuel", s_cal),
    (r"prix (de l.)?[ée]lectricit[ée]|spot|day-ahead|prix de gros|wholesale", s_spot),
]


def pick(text, today):
    t = (text or "").lower()
    for rx, fn in RULES:
        if re.search(rx, t):
            s = fn(today)
            if s:
                return s
    return None


def _style(ax):
    for k in ("top", "right", "left"):
        ax.spines[k].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.tick_params(colors=MUTED, labelsize=10, length=0)
    ax.set_axisbelow(True)


def draw(spec, path, w=6.4, h=3.0):
    """one chart, light background, its last value labelled; returns the path"""
    fig, ax = plt.subplots(figsize=(w, h), dpi=150)
    fig.patch.set_facecolor("white")
    colours = [LINE, "#1F5C99", "#9A5B12"]
    labels = None
    for k, (name, pts) in enumerate(spec["lines"]):
        pts = [(lab, v) for lab, v in pts if v is not None]
        labels = labels or [p[0] for p in pts]
        xs = list(range(len(pts)))
        ys = [v for _, v in pts]
        if spec.get("bars"):
            ax.bar(xs, ys, color=colours[k], width=0.7)
        else:
            ax.plot(xs, ys, color=colours[k], linewidth=2.2, marker="o", markersize=3.2, label=name)
            ax.annotate(f"{ys[-1]:,.1f}".replace(",", " ").replace(".", ","), (xs[-1], ys[-1]), xytext=(0, 7), textcoords="offset points",
                        ha="right", fontsize=10, fontweight="bold", color=INK)
    step = max(1, len(labels) // 6)
    ax.set_xticks(range(0, len(labels), step))
    ax.set_xticklabels([labels[i] for i in range(0, len(labels), step)])
    ax.set_ylabel(spec["unit"], color=MUTED, fontsize=10)
    _style(ax)
    if len(spec["lines"]) > 1:
        ax.legend(frameon=False, fontsize=10, loc="upper left")
    fig.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    return path


def week_chart(today, path):
    """PowerBrunch: the spot of the week before (Monday to Sunday) with a numbered marker on each dated event"""
    mon = today - timedelta(days=today.weekday() + 7)
    days = [mon + timedelta(days=k) for k in range(7)]
    pts = [(d, day_avg(d)) for d in days]
    if sum(v is not None for _, v in pts) < 5:
        return None, []
    ev = [e for e in ((load("events.json") or {}).get("items") or []) if mon.isoformat() <= (e.get("date") or "") <= days[-1].isoformat()][:4]
    fig, ax = plt.subplots(figsize=(6.4, 3.1), dpi=150)
    fig.patch.set_facecolor("white")
    xs = [k for k, (_, v) in enumerate(pts) if v is not None]
    ys = [v for _, v in pts if v is not None]
    ax.plot(xs, ys, color="#1F5C99", linewidth=2.4, marker="o", markersize=4)
    for x, y in zip(xs, ys):
        ax.annotate(f"{y:.0f}", (x, y), xytext=(0, 7), textcoords="offset points", ha="center", fontsize=9.5, color=INK)
    jours = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
    ax.set_xticks(range(7))
    ax.set_xticklabels([f"{jours[k]} {d.day}" for k, d in enumerate(days)])
    ax.set_ylabel("€/MWh", color=MUTED, fontsize=10)
    top = max(ys) * 1.18
    ax.set_ylim(0, top)
    marks = []
    for n, e in enumerate(ev, 1):
        k = (date.fromisoformat(e["date"]) - mon).days
        ax.axvline(k, color=MARK, linestyle=(0, (3, 3)), linewidth=1)
        ax.annotate(str(n), (k, top), xytext=(0, -2), textcoords="offset points", ha="center", va="top", fontsize=9, fontweight="bold", color="white",
                    bbox=dict(boxstyle="circle,pad=0.25", fc=MARK, ec=MARK))
        marks.append({"n": n, "date": e["date"], "title": (e.get("title") or [""])[0], "title_en": (e.get("title") or ["", ""])[-1]})
    _style(ax)
    fig.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    first, last = pts[0][1], [v for _, v in pts if v is not None][-1]
    return {"path": path, "first": first, "last": last, "pct": (last / first - 1) * 100 if first else None, "from": mon.isoformat(), "to": days[-1].isoformat()}, marks


# ── PowerBrunch's chart catalogue (the owner, 27 Nov. 2026): the chart shows what the analysis talks about (« tu parles
# de l'éolien ? ajoute-le au graph »), and the charts change from week to week to show the breadth of the site. The
# morning task (config/market_context_task.md) picks 2 or 3 ids for the week from data/brunch_charts.json; every chart
# links to its page. Spot with a driver: bars = the French spot by day, line = the driver on the right-hand axis.
def _gen_gw(d, field, zone="FR"):
    """a day's average of a generation or load series (quarter-hour MW in data/history/daily) in GW, or None"""
    z = (((load("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get(zone) or {})
    v = [x for x in (z.get(field) or []) if x is not None]
    return round(sum(v) / len(v) / 1000, 1) if len(v) >= 80 else None


def _zone_avg(d, zone):
    return (((load("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get(zone) or {}).get("avg")


def _two_weeks(today):
    return [today - timedelta(days=k) for k in range(14, 0, -1)]   # the 14 days before the edition


def c_spot_driver(field, name):
    def f(today):
        days = _two_weeks(today)
        spot = [(f"{d.day}", day_avg(d)) for d in days]
        drv = [(f"{d.day}", _gen_gw(d, field)) for d in days]
        if sum(v is not None for _, v in spot) < 10 or sum(v is not None for _, v in drv) < 10:
            return None
        return {"title": f"Spot France et {name.lower()}, 14 derniers jours", "unit": "€/MWh", "src": "ENTSO-E, RTE", "page": "markets/spot",
                "bars": ("Spot base", spot), "right": (f"{name} (GW)", drv, "GW"), "lines": []}
    return f


def c_spot_zones(today):
    days = _two_weeks(today)
    zs = [("France", "FR"), ("Allemagne", "DE_LU"), ("Espagne", "ES"), ("Italie Nord", "IT_NORD")]
    lines = [(n, [(f"{d.day}", _zone_avg(d, z)) for d in days]) for n, z in zs]
    if sum(v is not None for _, v in lines[0][1]) < 10:
        return None
    return {"title": "Spot base en Europe, 14 derniers jours", "unit": "€/MWh", "src": "ENTSO-E", "page": "markets/spot/europe", "lines": lines}


def _cs(key):
    cs = (load("history", "commodities_series.json") or {}).get("series") or {}
    return [(str(d)[:10], v) for d, v in ((cs.get(key) or {}).get("points") or []) if v is not None]


def _lab(d):
    return f"{int(d[8:10])} {MOIS[int(d[5:7]) - 1]}"


def c_cal_gas(today):
    ch = (load("history", "fr_market_calchain.json") or {}).get("FR") or {}
    y1 = str(today.year + 1)
    cy = (ch.get("years") or {}).get(y1)
    if not cy:
        return None
    cal = [(str(d)[:10], v) for d, v in zip(cy["dates"], cy["values"]) if v is not None][-66:]
    ttf = dict(_cs("ttf"))
    if len(cal) < 20:
        return None
    return {"title": f"Cal {y1[2:]} France et gaz TTF, 3 derniers mois", "unit": "€/MWh", "src": "EEX, ICE", "page": "markets/forwards",
            "lines": [(f"Cal {y1[2:]} France", [(_lab(d), v) for d, v in cal]), ("TTF", [(_lab(d), ttf.get(d)) for d, _ in cal])]}


def c_series(key, title, unit, page, n=66, name=None):
    def f(today):
        p = _cs(key)[-n:]
        if len(p) < 15:
            return None
        return {"title": title, "unit": unit, "src": "PowerKlock", "page": page, "lines": [(name or title.split(",")[0], [(_lab(d), v) for d, v in p])]}
    return f


def c_nuc_avail(today):
    a, fc = _cs("fr_nuc_avail")[-60:], dict(_cs("fr_nuc_avail_fc"))
    if len(a) < 15:
        return None
    return {"title": "Nucléaire disponible et prévision de l'exploitant, 2 derniers mois", "unit": "GW", "src": "ENTSO-E", "page": "system/generation/nuclear",
            "lines": [("Disponible", [(_lab(d), v / 1000) for d, v in a]), ("Prévision", [(_lab(d), (fc.get(d) or 0) / 1000 or None) for d, _ in a])]}


def c_capture(today):
    est = (load("cre_m0.json") or {}).get("estimate") or {}
    ks = [k for k in sorted(est) if (est[k] or {}).get("base")][-12:]
    if len(ks) < 6:
        return None
    rate = lambda k, t: round(est[k][t] / est[k]["base"] * 100, 1) if est[k].get(t) is not None and est[k]["base"] > 5 else None  # noqa: E731
    return {"title": "Taux de capture en France, 12 derniers mois", "unit": "% du prix de base", "src": "PowerKlock (méthode CRE)", "page": "renewables/m0",
            "lines": [("Solaire", [(MOIS[int(k[5:]) - 1], rate(k, "solarCap")) for k in ks]), ("Éolien", [(MOIS[int(k[5:]) - 1], rate(k, "windCap")) for k in ks])]}


# id → (what the chart shows, for the morning task's choice), the function
CATALOGUE = {
    "spot_wind": ("Spot France par jour et production éolienne : quand le vent fait le prix", c_spot_driver("wind", "Éolien")),
    "spot_nuclear": ("Spot France par jour et production nucléaire : disponibilité du parc, arrêts, redémarrages", c_spot_driver("nuclear", "Nucléaire")),
    "spot_load": ("Spot France par jour et consommation : froid, chaleur, demande", c_spot_driver("load", "Consommation")),
    "spot_solar": ("Spot France par jour et production solaire : printemps, été, heures négatives", c_spot_driver("solar", "Solaire")),
    "spot_zones": ("Spot base France, Allemagne, Espagne, Italie Nord : écarts entre pays, couplage, interconnexions", c_spot_zones),
    "cal_gas": ("Cal de l'année suivante en France et TTF sur 3 mois : le terme suit-il le gaz ?", c_cal_gas),
    "gas_storage": ("Remplissage des stockages de gaz européens : sécurité de l'hiver", c_series("agsi", "Stockages de gaz européens, 3 derniers mois", "% de remplissage", "markets/fuels", name="Stockages UE")),
    "ttf": ("Gaz TTF day-ahead sur 3 mois", c_series("ttf", "Gaz TTF day-ahead, 3 derniers mois", "€/MWh", "markets/fuels", name="TTF")),
    "eua": ("Quota de CO₂ EUA sur 3 mois : politique climatique, ventes des fonds", c_series("eua", "CO₂ EUA décembre, 3 derniers mois", "€/t", "markets/fuels", name="EUA")),
    "brent": ("Pétrole Brent sur 3 mois : géopolitique, offre mondiale", c_series("brent", "Brent, 3 derniers mois", "$/b", "markets/fuels", name="Brent")),
    "nuc_avail": ("Nucléaire disponible face à la prévision d'EDF : écarts, arrêts imprévus", c_nuc_avail),
    "neg_hours": ("Heures à 0 € ou moins par jour sur 30 jours : solaire, éolien, arrêt aux prix négatifs", s_neg),
    "go": ("Prix des garanties d'origine de l'année suivante sur 6 mois", s_go),
    "ppa": ("Benchmark PPA France solaire et éolien sur 3 mois", s_ppa),
    "m0": ("M0 solaire et éolien publiés par la CRE sur 12 mois : compléments de rémunération", s_m0),
    "capture": ("Taux de capture solaire et éolien sur 12 mois : cannibalisation", c_capture),
}


def catalogue_file(path=None):
    """data/brunch_charts.json: the ids and what each shows, for the morning task"""
    out = {"about": "PowerBrunch's charts (scripts/news_charts.py › CATALOGUE). Pick 2 or 3 ids that show what the week's analysis talks about; "
                    "not the same as last week's unless it is the week's subject.",
           "charts": [{"id": k, "shows": v[0]} for k, v in CATALOGUE.items()]}
    with open(path or os.path.join(D, "brunch_charts.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)


def draw2(spec, path, w=6.4, h=3.1):
    """a catalogue chart: optional bars (the spot), lines on the left axis, an optional driver on a right-hand axis"""
    fig, ax = plt.subplots(figsize=(w, h), dpi=150)
    fig.patch.set_facecolor("white")
    colours = [INK, "#E08A2E", "#1F5C99", "#9A5B12"]
    labels = None
    handles = []
    if spec.get("bars") is True:          # the older specs: their one series drawn as bars
        spec = dict(spec, bars=spec["lines"][0], lines=spec["lines"][1:])
    if spec.get("bars"):
        name, pts = spec["bars"]
        labels = [p[0] for p in pts]
        xs = [k for k, (_, v) in enumerate(pts) if v is not None]
        handles.append(ax.bar(xs, [v for _, v in pts if v is not None], color="#9FC9BD", width=0.65, label=name))
    ends = []
    for k, (name, pts) in enumerate(spec.get("lines") or []):
        labels = labels or [p[0] for p in pts]
        xs = [i for i, (_, v) in enumerate(pts) if v is not None]
        ys = [v for _, v in pts if v is not None]
        if not ys:
            continue
        handles += ax.plot(xs, ys, color=colours[k % len(colours)], linewidth=2.1, label=name)
        ends.append([xs[-1], ys[-1], colours[k % len(colours)]])
    # the last values, labelled at the line's end; two labels too close are pushed apart (in points)
    ends.sort(key=lambda e: e[1])
    lo, hi = ax.get_ylim()
    off, prev = [0] * len(ends), None
    for i, e in enumerate(ends):
        if prev is not None and (e[1] - ends[i - 1][1]) / ((hi - lo) or 1) < 0.07:
            off[i] = off[i - 1] + 11
        prev = e
    for (x, y, col), o in zip(ends, off):
        ax.annotate(f"{y:,.1f}".replace(",", " ").replace(".", ","), (x, y), xytext=(4, o), textcoords="offset points",
                    va="center", fontsize=9.5, fontweight="bold", color=col)
    ax.set_ylabel(spec["unit"], color=MUTED, fontsize=10)
    _style(ax)
    if spec.get("right"):
        name, pts, unit = spec["right"]
        ax2 = ax.twinx()
        xs = [i for i, (_, v) in enumerate(pts) if v is not None]
        handles += ax2.plot(xs, [v for _, v in pts if v is not None], color="#1F7FB8", linewidth=2.3, marker="o", markersize=3, label=name)
        ax2.set_ylabel(unit, color="#1F7FB8", fontsize=10)
        ax2.tick_params(colors="#1F7FB8", labelsize=10, length=0)
        for s in ax2.spines.values():
            s.set_visible(False)
        ax2.set_ylim(bottom=0)
    if spec.get("bars"):
        ax.set_ylim(bottom=min(0, ax.get_ylim()[0]))
    step = max(1, len(labels) // 7)
    ax.set_xticks(range(0, len(labels), step))
    ax.set_xticklabels([labels[i] for i in range(0, len(labels), step)])
    if len(handles) > 1:
        ax.legend(handles=handles, frameon=False, fontsize=9.5, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=len(handles),
                  borderaxespad=0.2, handlelength=1.6)      # above the plot, never over the data
    fig.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    return path
