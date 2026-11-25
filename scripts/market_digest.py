"""
Weekly market context, written in French and centred on France, for the
"Marchés de l'énergie · la semaine" widget (js/market-brief.js).

The latest market notes (the weekly note received by e-mail, the supplier's
daily report from the public cockpit), the market-moving news of the last days
and the week's prices are handed to the site's AI proxy, which writes 3 to 4
short topics in its own words: France first (politics, nuclear, regulation,
weather), then the world events that move European prices. No source is named
and nothing is quoted, so the file can be public.

Out  data/market_digest.json  {"updated", "asof", "context": [{"topic", "text", "tone"}] (the day), "context_week" (the week,
     for PowerBrunch), "outlook": {market: {"tone", "text"}}}
Called by scripts/fetch_market_notes.py with the notes it just read; runs alone
(without the e-mailed note) with: python scripts/market_digest.py
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROXY = "https://powerklock-ai.tom-s-remy.workers.dev"
OUT = os.path.join(ROOT, "data", "market_digest.json")
ENGINE = None


def load(p):
    try:
        return json.load(open(os.path.join(ROOT, "data", p)))
    except (OSError, ValueError):
        return None


def week_move(pts):
    """last value and its move over 7 days, from [[date, value], …]"""
    if not pts:
        return None
    d, v = pts[-1]
    k = (datetime.fromisoformat(d) - timedelta(days=7)).date().isoformat()
    old = [x for t, x in pts if t <= k]
    return {"date": d, "value": round(v, 2), "move_7d_pct": round((v / old[-1] - 1) * 100, 1) if old and old[-1] else None}


def facts():
    cs = (load("history/commodities_series.json") or {}).get("series", {})
    f = {k: week_move(cs.get(k, {}).get("points")) for k in ("brent", "ttf", "eua", "coal", "agsi", "fr_nuc_avail")}
    ch = (load("history/fr_market_calchain.json") or {}).get("FR", {}).get("years", {})
    if ch:
        y = sorted(ch)[0]
        f["cal_fr_" + y] = week_move(list(zip(ch[y]["dates"], ch[y]["values"])))
    sp = [(r["d"], r["avg"]) for r in ((load("history/summary.json") or {}).get("zones", {}).get("FR") or []) if r.get("avg") is not None]
    if sp:
        f["spot_fr_last_days"] = [[d, round(v, 1)] for d, v in sp[-8:]]
        # the neighbours the same delivery day: where France stands (dearer or cheaper than Germany, Belgium…)
        day = (load("history/daily/" + sp[-1][0] + ".json") or {}).get("zones") or {}
        f["spot_neighbours_" + sp[-1][0]] = {z: round(day[z]["avg"]) for z in ("FR", "DE_LU", "BE", "NL", "IT_NORD", "CH", "ES") if isinstance((day.get(z) or {}).get("avg"), (int, float))}
    # nuclear against the operator's forecast (a gap = reactors announced but not back)
    nf = (cs.get("fr_nuc_avail_fc") or {}).get("points") or []
    if nf and f.get("fr_nuc_avail"):
        f["fr_nuc_avail_GW"] = round(f["fr_nuc_avail"]["value"] / 1000, 1)
        f["fr_nuc_operator_forecast_GW"] = round(nf[-1][1] / 1000, 1)
        f.pop("fr_nuc_avail")
    # weather, the next 4 weeks against normal (temperature in °C, wind and solar output in %)
    wx = ((load("weather_outlook.json") or {}).get("countries") or {}).get("FR", {}).get("series") or {}
    if wx.get("temp"):
        days, today = wx["temp"]["days"], datetime.now(timezone.utc).date().isoformat()
        i0 = next((i for i, d in enumerate(days) if d > today), None)
        out = []
        for w in range(4):
            if i0 is None:
                break
            ix = [i for i in range(i0 + 7 * w, min(i0 + 7 * (w + 1), len(days)))]
            def avg(k, s):
                v = [wx[k][s][i] for i in ix if wx.get(k) and wx[k].get(s) and i < len(wx[k][s]) and wx[k][s][i] is not None]
                return sum(v) / len(v) if v else None
            t, tn, wi, wn = avg("temp", "mean"), avg("temp", "normal"), avg("wind", "mean"), avg("wind", "normal")
            if ix:
                out.append({"week_from": days[ix[0]], "temp_vs_normal_C": round(t - tn, 1) if t is not None and tn is not None else None,
                            "wind_vs_normal_pct": round((wi / wn - 1) * 100) if wi is not None and wn else None})
        f["weather_fr_next_weeks"] = out
    return f


def news(days=4):
    it = (load("news.json") or {}).get("items") or []
    now = datetime.now(timezone.utc)
    keep = []
    for n in it:
        try:
            age = now - datetime.fromisoformat(str(n.get("date")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if age < timedelta(days=days) and set(n.get("tags") or []) & {"geopolitics", "regulation", "gas", "fr", "markets", "nuclear"}:
            keep.append({"title": n.get("title"), "summary": (n.get("snippet") or "")[:300], "tags": n.get("tags")})
    return keep[:40]


SYSTEM = """Tu es analyste des marchés de l'énergie et tu écris pour des directeurs origination et fourniture d'électricité en France (PPA, fourniture, agrégation). Tu rédiges le CONTEXTE DE MARCHÉ, comme le paragraphe « contexte général » d'une lettre de marché de fournisseur, centré sur la France, en deux versions : celle du JOUR (context) et celle de la SEMAINE écoulée (context_week).

Règles :
- Français correct et naturel, phrases courtes, ton de note de salle de marché. Pas de traduction mot à mot de l'anglais.
- Couvre, quand les données ou les articles fournis en parlent, ces sujets dans cet ordre (nom court du sujet entre guillemets) :
  « Prix » : le spot France, son sens et sa place face aux voisins (spot_neighbours) ; la cause principale.
  « Gaz » : le TTF, son mouvement et les stocks européens (agsi), et la raison (Norvège, GNL, Russie, froid…).
  « Nucléaire » : la disponibilité (fr_nuc_avail_GW) face à la prévision de l'exploitant (fr_nuc_operator_forecast_GW).
  « Météo » : température et vent des prochaines semaines face à la normale (weather_fr_next_weeks), et l'effet sur la demande et les prix.
  « Forwards » : le Cal France, son mouvement et s'il suit le gaz.
  « Régulation » : décisions CRE, appels d'offres, textes européens ou français des derniers jours.
  « Géopolitique » ou un nom de zone (« Golfe », « Russie », « Norvège ») : seulement si un fait concret touche les prix.
  Un sujet sans fait concret est omis (jamais « aucun événement notable »).
- Chaque sujet : 1 à 2 phrases : le fait, puis son effet sur les prix. Une cause n'est écrite que si les chiffres ou les articles la donnent ; ne contredis jamais les chiffres fournis.
- Chiffres arrondis comme on les dit : les prix en €/MWh sans décimale, les capacités en GW avec une décimale (jamais en MW), les variations en % sans décimale.
- Version du JOUR : ce qui a changé depuis la veille et ce qui compte aujourd'hui. Version de la SEMAINE : le bilan des 7 derniers jours et les tendances.
- Écris avec tes propres mots : ne cite aucune source, aucun média, aucun fournisseur, ne recopie aucune phrase.
- tone = "up" si le sujet pousse les prix à la hausse, "down" à la baisse, "flat" sinon.

Ajoute aussi le SENTIMENT POUR LA SEMAINE À VENIR, marché par marché (pétrole, gaz, électricité, carbone) : ce que les notes et l'actualité laissent attendre pour les prochains jours, en une phrase courte (12 mots au plus) avec la raison principale ; tone = "up", "down" ou "flat". Pas de note sur un marché : déduis-le des chiffres et de l'actualité, sans inventer.

Le site est en français et en anglais : donne chaque texte aussi en anglais (champs topic_en et text_en), même sens, mêmes chiffres.

Réponds uniquement avec ce JSON, sans texte autour :
{"context":[{"topic":"Prix","topic_en":"Prices","text":"…","text_en":"…","tone":"up"}],
 "context_week":[{"topic":"Prix","topic_en":"Prices","text":"…","text_en":"…","tone":"up"}],
 "outlook":{"oil":{"tone":"up","text":"…","text_en":"…"},"gas":{"tone":"up","text":"…","text_en":"…"},"power":{"tone":"flat","text":"…","text_en":"…"},"carbon":{"tone":"flat","text":"…","text_en":"…"}}}"""


def ask(payload):
    # the Anthropic API when its key and model are set (secret ANTHROPIC_API_KEY, variable DIGEST_MODEL);
    # otherwise the site's AI proxy, whose model writes vaguer French
    msg = {"max_tokens": 3000, "system": SYSTEM, "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    key, model = os.environ.get("ANTHROPIC_API_KEY"), os.environ.get("DIGEST_MODEL")
    global ENGINE
    if key and model:
        ENGINE = "anthropic"
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(dict(msg, model=model)).encode(),
                                     headers={"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    else:
        ENGINE = "proxy"
        req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-digest"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    parts = [b.get("text") for b in r.get("content", []) if b.get("type") == "text"]
    out = next((x for x in parts if isinstance(x, dict)), None)   # the proxy sometimes hands back the JSON already parsed
    if out is None:
        txt = "".join(x for x in parts if isinstance(x, str))
        m = re.search(r"\{.*\}", txt, re.S)
        if not m:
            raise ValueError("no JSON in the answer: " + txt[:200])
        out = json.loads(m.group(0))
    look = {}
    for k, v in (out.get("outlook") or {}).items():
        if k in ("oil", "gas", "power", "carbon") and isinstance(v, dict) and v.get("text"):
            look[k] = {"tone": v.get("tone") if v.get("tone") in ("up", "down", "flat") else "flat", "text": str(v["text"]).strip(),
                       "text_en": str(v.get("text_en") or "").strip() or None}
    empty = re.compile(r"(?i)(pas d.impact notable|aucun (événement|impact)|rien de notable|pas d.événement)")   # the proxy's model writes them anyway
    def clean(lst):
        lst = [c for c in (lst or []) if isinstance(c, dict) and c.get("topic") and c.get("text") and not empty.search(c["text"])][:7]
        for c in lst:
            c["tone"] = c.get("tone") if c.get("tone") in ("up", "down", "flat") else "flat"
            c["topic_en"] = str(c.get("topic_en") or "").strip() or None
            c["text_en"] = str(c.get("text_en") or "").strip() or None
        return lst
    ctx, week = clean(out.get("context")), clean(out.get("context_week"))
    if not ctx:
        raise ValueError("empty context")
    return ctx, week, look


def run(notes=None):
    """notes: the e-mailed notes just read ([{note_date, sections:[{name, headline, points}]}]), newest last"""
    today = datetime.now(timezone.utc).date()
    payload = {"today": today.isoformat(), "market_figures": facts(), "news_last_days": news(4), "news_last_week": news(8), "notes": []}
    for n in (notes or [])[-1:]:
        try:
            if today - datetime.fromisoformat(n["note_date"]).date() <= timedelta(days=10):
                payload["notes"].append({"date": n["note_date"], "kind": "weekly market note", "sections": n["sections"]})
        except (KeyError, TypeError, ValueError):
            pass
    fm = load("fr_market.json") or {}
    # PowerKlock's daily commentaries are not kept (only their tone score: rising words minus easing words, > 0 = leaning up)
    mt = fm.get("marketInsightsTone") or {}
    if mt.get("gas") is not None or mt.get("power") is not None:
        payload["notes"].append({"date": mt.get("date"), "kind": "daily energy report, tone score only (> 0 leans to rising prices, < 0 to easing)",
                                 "gas_tone": mt.get("gas"), "power_tone": mt.get("power")})
    ctx, week, look = ask(payload)
    json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "asof": today.isoformat(),
               "notes": len(payload["notes"]), "engine": ENGINE, "context": ctx, "context_week": week or ctx, "outlook": look}, open(OUT, "w"), ensure_ascii=False, indent=1)
    remember(today.isoformat(), look)
    print("digest:", [c["topic"] for c in ctx])


HIST = os.path.join(ROOT, "data", "history", "digest_outlook.json")


def remember(day, look):
    """the week-ahead call of each day ({day: {market: tone}}), so the site can score it against what prices did"""
    try:
        h = json.load(open(HIST))
    except (OSError, ValueError):
        h = {}
    h[day] = {k: v["tone"] for k, v in look.items()}
    json.dump(dict(sorted(h.items())[-400:]), open(HIST, "w"), indent=0)


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        sys.exit(f"digest failed: {e}")
