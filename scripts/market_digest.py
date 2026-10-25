"""
Weekly market context, written in French and centred on France, for the
"Marchés de l'énergie · la semaine" widget (js/market-brief.js).

The latest market notes (the weekly note received by e-mail, the supplier's
daily report from the public cockpit), the market-moving news of the last days
and the week's prices are handed to the site's AI proxy, which writes 3 to 4
short topics in its own words: France first (politics, nuclear, regulation,
weather), then the world events that move European prices. No source is named
and nothing is quoted, so the file can be public.

Out  data/market_digest.json  {"updated", "asof", "context": [{"topic", "text", "tone"}], "outlook": {market: {"tone", "text"}}}
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


def plain(h):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(h or "")).replace("&nbsp;", " ").replace("&amp;", "&").replace("&euro;", "€")).strip()


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
    return f


def news():
    it = (load("news.json") or {}).get("items") or []
    now = datetime.now(timezone.utc)
    keep = []
    for n in it:
        try:
            age = now - datetime.fromisoformat(str(n.get("date")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if age < timedelta(days=4) and set(n.get("tags") or []) & {"geopolitics", "regulation", "gas", "fr", "markets"}:
            keep.append({"title": n.get("title"), "summary": (n.get("snippet") or "")[:300], "tags": n.get("tags")})
    return keep[:40]


SYSTEM = """Tu es analyste des marchés de l'énergie et tu écris pour des acheteurs et vendeurs d'électricité en France (PPA, fourniture). Tu rédiges le CONTEXTE de la semaine, comme le paragraphe « contexte général » d'une lettre de marché de fournisseur, mais centré sur la France.

Règles :
- Français, phrases courtes, ton de note de salle de marché.
- 2 à 4 sujets. D'abord la France (politique et budget, nucléaire, réglementation, météo, consommation), puis les événements mondiaux qui font bouger les prix européens (Golfe, Russie, Norvège, GNL, États-Unis, Chine…). Ne garde que ce qui compte pour les prix.
- Chaque sujet : un nom court (« France », « Golfe », « Norvège »…) et 1 à 2 phrases : le fait concret, puis son effet sur les prix. Chiffres quand ils existent.
- Écris avec tes propres mots : ne cite aucune source, aucun média, aucun fournisseur, ne recopie aucune phrase.
- N'invente rien : seulement ce que disent les notes, les articles et les chiffres fournis. Pas de sujet sans fait concret (jamais « aucun événement notable ») : mieux vaut 2 sujets solides que 4 creux.
- Le sujet « France » reprend TOUT ce que les notes et les articles disent de la France : politique et budget, nucléaire (réacteurs, arrêts, retours), réglementation, consommation, météo.
- Sois précis : qui, quoi, combien, quand. Pas de conditionnel vague (« pourrait », « pourraient ») : dis ce qui se passe et dans quel sens cela pousse les prix.
- Ne répète pas les variations de prix seules (elles sont affichées ailleurs) : explique les causes.
- tone = "up" si le sujet pousse les prix à la hausse, "down" à la baisse, "flat" sinon.

Ajoute aussi le SENTIMENT POUR LA SEMAINE À VENIR, marché par marché (pétrole, gaz, électricité, carbone) : ce que les notes et l'actualité laissent attendre pour les prochains jours, en une phrase courte (12 mots au plus) avec la raison principale ; tone = "up", "down" ou "flat". Pas de note sur un marché : déduis-le des chiffres et de l'actualité, sans inventer.

Le site est en français et en anglais : donne chaque texte aussi en anglais (champs topic_en et text_en), même sens, mêmes chiffres.

Réponds uniquement avec ce JSON, sans texte autour :
{"context":[{"topic":"France","topic_en":"France","text":"…","text_en":"…","tone":"up"}],
 "outlook":{"oil":{"tone":"up","text":"…","text_en":"…"},"gas":{"tone":"up","text":"…","text_en":"…"},"power":{"tone":"flat","text":"…","text_en":"…"},"carbon":{"tone":"flat","text":"…","text_en":"…"}}}"""


def ask(payload):
    # the Anthropic API when its key and model are set (secret ANTHROPIC_API_KEY, variable DIGEST_MODEL);
    # otherwise the site's AI proxy, whose model writes vaguer French
    msg = {"max_tokens": 1400, "system": SYSTEM, "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
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
    ctx = [c for c in out.get("context", []) if c.get("topic") and c.get("text") and not empty.search(c["text"])][:4]
    for c in ctx:
        c["tone"] = c.get("tone") if c.get("tone") in ("up", "down", "flat") else "flat"
        c["topic_en"] = str(c.get("topic_en") or "").strip() or None
        c["text_en"] = str(c.get("text_en") or "").strip() or None
    if not ctx:
        raise ValueError("empty context")
    return ctx, look


def run(notes=None):
    """notes: the e-mailed notes just read ([{note_date, sections:[{name, headline, points}]}]), newest last"""
    today = datetime.now(timezone.utc).date()
    payload = {"today": today.isoformat(), "market_figures": facts(), "news_last_days": news(), "notes": []}
    for n in (notes or [])[-1:]:
        try:
            if today - datetime.fromisoformat(n["note_date"]).date() <= timedelta(days=10):
                payload["notes"].append({"date": n["note_date"], "kind": "weekly market note", "sections": n["sections"]})
        except (KeyError, TypeError, ValueError):
            pass
    fm = load("fr_market.json") or {}
    mi, d = fm.get("marketInsights") or {}, (fm.get("marketInsightsDate") or fm.get("lastUpdate") or "")[:10]
    if mi and (mi.get("gas") or mi.get("power")):
        payload["notes"].append({"date": d, "kind": "daily energy report", "gas": plain(mi.get("gas"))[:3000], "power": plain(mi.get("power"))[:3000]})
    ctx, look = ask(payload)
    json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "asof": today.isoformat(),
               "notes": len(payload["notes"]), "engine": ENGINE, "context": ctx, "outlook": look}, open(OUT, "w"), ensure_ascii=False, indent=1)
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
