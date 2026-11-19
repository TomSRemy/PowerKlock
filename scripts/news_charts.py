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


# the story's own words → its chart (the first that matches and has data)
RULES = [
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
