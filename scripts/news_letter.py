"""
The morning newsletter, one edition per reading profile (config/news_profiles.json): regulatory, origination, market
expert, sales. Same facts for everyone, chosen and ordered for each reader:

  markets   France spot today and tomorrow, Cal+1 France, PEG, TTF, EUA, with their move (the repository's data files)
  stories   the 3 stories of the last 36 hours (84 on Monday) that matter most to this reader: categories weighted by the
            profile, its keywords, the number of outlets, freshness; one event once, one outlet once
            « Ce qui s'est passé » and « Pour vous » are written by the site's free AI proxy from the titles and extracts
            only; a story the model does not return keeps its extract and no « Pour vous »
  official  texts of the Journal officiel, EUR-Lex and the CRE of the last days
  cons      consultations closing within 14 days, or opened in the last 3
  pubs      RTE, EEX publications and published reports of the last days
  agenda    dated events of the next 14 days (data/events.json)
  post      the LinkedIn post the team voted most useful this week (public.news_post, public.news_vote)

Out  data/newsletter.json   read by the News page (tab Newsletter) and scripts/morning_mail.py
Run by .github/workflows/morning_mail.yml on weekdays; does nothing when today's edition exists.
    python scripts/news_letter.py [--force] [--no-ai]
"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from morning_mail import load as dload, spot   # noqa: E402
from news_digest import PARIS, PROXY, energy, focus, sid, similar, top_posts   # noqa: E402
import news_charts   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "newsletter.json")             # 7 O'Klock, every weekday at 7:00
OUT_WEEK = os.path.join(ROOT, "data", "newsletter_week.json")   # PowerBrunch, Monday at 10:00: the week before
PROFILES = os.path.join(ROOT, "config", "news_profiles.json")
MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
MIN_SCORE = 3.0     # a story below this is off the reader's subjects (e.g. an offshore-wind contract for a lawyer)
# « À retenir » must be a fact from the article: a generic line (« Impact sur les prix », « Intérêt pour les PPA ») is dropped
GENERIC = re.compile(r"(?i)^\s*(l.|un |une |des |les |le |la )?(impacts?|int[ée]r[êe]ts?|enjeux?|opportunit[ée]s?|cons[ée]quences?|effets?|nouvel(le)?s?|"
                     r"analyser|[ée]tudier|pr[ée]voir|surveiller|suivre|[àa] suivre|anticiper|v[ée]rifier|attention|implications?|potentiel)\b")
EMPTY = re.compile(r"(?i)(aucune information|pas d.information|non (précisé|indiqué|disponible)|sans (détail|précision)s? supplémentaire)")

SYSTEM = """Tu écris la newsletter du matin de PowerKlock pour ce lecteur : {reader}.
Tu reçois les sujets du jour (id, titre, médias, extrait) et les textes officiels récents.

Réponds en JSON seulement :
{{"headline": "<la journée en une phrase de 35 mots au plus>", "headline_en": "<la même en anglais>",
  "items": [{{"id": "<id du sujet>", "what": "<ce qui s'est passé, 2 phrases, 45 mots au plus>", "what_en": "<anglais>",
             "for_you": "<à retenir : le fait précis de l'article, 25 mots au plus>", "for_you_en": "<anglais>"}}]}}

Un élément par sujet reçu, dans l'ordre reçu. N'invente rien : seulement ce que disent les titres et extraits, et ce qui en
découle directement. Aucun chiffre absent des extraits. Ne cite pas de média.
"what" résume l'article : ce qui se passe, qui, où, combien, quand. Ne répète pas le titre, apporte ce qu'il ne dit pas.
"for_you" (« À retenir ») est LE fait concret qu'un professionnel retient de l'article : un chiffre, une décision, une date,
un montant, un volume, qui fait quoi (« 56 MW pour Vattenfall en Allemagne, mise en service fin 2027 »). Jamais une
formule générale (« impact sur les prix », « intérêt pour les PPA », « nouvelle opportunité », « à suivre », « analyser… »),
jamais un conseil. S'il n'y a pas de fait concret dans l'extrait, laisse "for_you" vide."""


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def age_h(i, now):
    try:
        return (now - datetime.fromisoformat(i["date"])).total_seconds() / 3600
    except (KeyError, TypeError, ValueError):
        return None


def kw_hits(i, prof):
    text = (i.get("title", "") + " " + (i.get("snippet") or "")).lower()
    return sum(1 for k in prof.get("keywords", []) if re.search(r"\b" + re.escape(k.lower()) + r"\b", text))


def score(i, prof, now):
    """how much a story matters to this reader: categories weighted by the profile (the strongest in full, the others at
    half), the profile's keywords, France first, more outlets, fresher"""
    tags = i.get("tags") or []
    subj = i.get("topics") if i.get("topics") is not None else tags    # the article's own subjects, not its outlet's
    ws = sorted((prof["weights"].get(t, 0) for t in set(subj) | ({"official", "report", "assoc"} & set(tags))), reverse=True)
    s = (ws[0] + 0.5 * sum(ws[1:])) if ws else 0.0
    if "official" in tags:
        s += prof.get("official", 1)
    s += 1.5 * min(2, kw_hits(i, prof))
    # electricity first (the owner, 24 Nov. 2026): a story about gas only, with nothing on power, renewables or markets, goes down
    if "gas" in subj and not {"power", "renewables", "markets"} & set(subj):
        s -= 2.5
    fr = "fr" in tags or "FR" in (i.get("countries") or [])
    s += prof.get("france", 1.0) if fr else -prof.get("foreign", 0.0)     # France first, as much as the profile asks
    if "major" in tags:
        s += 4.0        # a major yearly publication (IEA World Energy Outlook, RTE Bilan prévisionnel…): it leads
    s += 1.1 * math.log2(1 + len(i.get("other_sources") or []))     # covered by many outlets: the story of the day (5 outlets: +2.6)
    s -= 0.3 * (age_h(i, now) or 0) / 24
    return s


def pick(items, prof, now, hours, n=3):
    cands = [i for i in items if (age_h(i, now) or 1e9) <= hours and not {"official", "research"} & set(i.get("tags") or []) and energy(i)]   # texts and papers have their own sections
    cands.sort(key=lambda i: -score(i, prof, now))
    out, seen_src = [], set()
    for i in cands:
        if score(i, prof, now) < MIN_SCORE:
            break                                       # nothing else that matters to this reader: fewer stories, not filler
        if prof.get("require_keyword") and not kw_hits(i, prof):
            continue
        if i["source"] in seen_src or any(similar(i["title"], o["title"]) for o in out):
            continue
        out.append(i)
        seen_src.add(i["source"])
        if len(out) == n:
            break
    return out


def ask(prof, stories, official, model=None):
    payload = {"sujets": [{"id": sid(i), "titre": i["title"], "medias": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                           "extrait": article(i, 1200)} for i in stories],
               "textes_officiels": [o["title"] for o in official[:5]]}
    msg = {"max_tokens": 2000, "system": SYSTEM.format(reader=prof["reader"]),
           "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    # a model of the proxy's list (Worker powerklock-ai). Qwen3 30B wrote the most useful « Pour vous » in a comparison
    # of the free models on the same stories (16 Nov. 2026); NEWS_MODEL overrides it
    msg["model"] = model or os.environ.get("NEWS_MODEL") or MODEL
    req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-newsletter"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    parts = [b.get("text") for b in r.get("content", []) if b.get("type") == "text"]
    out = next((x for x in parts if isinstance(x, dict)), None)
    if out is None:
        m = re.search(r"\{.*\}", "".join(x for x in parts if isinstance(x, str)), re.S)
        if not m:
            raise ValueError("no JSON in the answer")
        out = json.loads(m.group(0))
    return out


CONTEXT = """Tu écris pour la newsletter du matin de PowerKlock (marché français de l'électricité). Pour chaque sujet reçu
(id, titre, médias, extrait : le début de l'article quand il a pu être lu), résume ce que dit l'article et pourquoi cela
compte pour le marché de l'électricité en France. 2 phrases, 45 mots au plus. Ne reformule pas le titre : apporte ce
qu'il ne dit pas (le contexte, le mécanisme en jeu, l'enjeu pour les producteurs, fournisseurs ou consommateurs).
Ne nomme aucun lieu, pays, acteur ni chiffre absent du titre ou de l'extrait (ne devine pas où se trouve une ville). Si le
sujet ne parle pas de la France, n'invente pas de lien avec elle : écris ce qu'il montre du marché (une tendance, un type de
contrat). Une phrase vague (« un collectif réduit ses coûts ») ne sert à rien : dans le
doute, décris précisément ce qu'annonce le titre.
N'invente aucun fait, chiffre, date ni citation absents du titre ou de l'extrait ; sans extrait, explique le cadre général
(le mécanisme, l'acteur, l'enjeu) plutôt que des détails. Pas de média cité.
Réponds en JSON seulement : {"items": [{"id": "<id>", "what": "<français>", "what_en": "<anglais>"}]}"""


PAID = re.compile(r"greenunivers|montel|windpowermonthly|lesechos|contexte\.com|rechargenews|carbon-pulse", re.I)
_robots = {}
_pages = {}


def page_text(url, limit=1500):
    """the start of an article (its description and first paragraphs), read only to write a summary of a story that has
    no extract: never kept, never shown. Paid outlets, Google News redirects and sites whose robots.txt refuses are not read."""
    import html as _h
    import urllib.robotparser
    from urllib.parse import urlparse
    if url in _pages:
        return _pages[url]
    _pages[url] = ""
    if not url or PAID.search(url) or "news.google." in url or len(_pages) > 40:
        return ""
    UA = "PowerKlock-newsletter (+https://github.com/TomSRemy/PowerKlock)"
    host = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = urllib.request.urlopen(urllib.request.Request(host + "/robots.txt", headers={"User-Agent": UA}), timeout=10)
            rp.parse(r.read().decode("utf-8", "ignore").splitlines())
        except urllib.error.HTTPError as e:
            rp.parse([] if 400 <= e.code < 500 else ["User-agent: *", "Disallow: /"])   # RFC 9309: missing file allows, a server error does not
        except Exception:
            rp.parse(["User-agent: *", "Disallow: /"])
        _robots[host] = rp
    if not _robots[host].can_fetch(UA, url):
        return ""
    try:
        b = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15).read(600_000).decode("utf-8", "ignore")
    except Exception:
        return ""
    desc = re.search(r'<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"', b) or re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property="og:description"|name="description")', b)
    body = re.sub(r"(?s)<(script|style|nav|header|footer|aside)[^>]*>.*?</\1>", " ", b)
    paras = [re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", p))).strip() for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", body)]
    paras = [p for p in paras if len(p) > 60 and not re.search(r"cookie|abonn|newsletter|subscribe|©|tous droits", p, re.I)]
    txt = " ".join(([_h.unescape(desc.group(1))] if desc else []) + paras)
    _pages[url] = clip(txt, limit)
    return _pages[url]


def adds_nothing(what, title):
    """a summary that only says the title again: most of its own words are the title's (not « similar », which is made to
    pair two titles and finds two common words in nearly any summary)"""
    w = lambda t: {x for x in re.findall(r"[a-z0-9à-ÿ]+", (t or "").lower()) if len(x) > 3}  # noqa: E731
    sw, tw = w(what), w(title)
    return not sw or len(sw - tw) <= max(2, len(sw) // 4)


def best_text(i, limit=1500):
    """the best readable article of a story: its own page, else the other outlets on it, else the free ones of a paid
    story (« Aussi en accès libre »); the first that gives a text"""
    urls = [i.get("link")] + [o.get("link") for o in i.get("other_sources") or []] + [f.get("link") for f in i.get("free") or []]
    for u in urls:
        t = page_text(u, limit)
        if t:
            return t
    return ""


def article(i, limit):
    """what the model reads of a story: the outlet's extract, completed by the start of the article when it is short"""
    sn = i.get("snippet") or ""
    return (sn if len(sn) >= 400 else (sn + " " + best_text(i, limit)).strip())[:limit]


def ask_context(items, model=None):
    """a context text for the stories that have none (no extract, a summary that only repeated the title)"""
    payload = [{"id": sid(i), "titre": i["title"], "medias": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                "extrait": ((i.get("snippet") or "") if len(i.get("snippet") or "") >= 80 else best_text(i) or i.get("snippet") or "")[:1500]} for i in items]
    msg = {"max_tokens": 1500, "system": CONTEXT, "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
           "model": model or os.environ.get("NEWS_MODEL") or MODEL}
    req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-newsletter"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    txt = "".join(b.get("text") for b in r.get("content", []) if b.get("type") == "text" and isinstance(b.get("text"), str))
    m = re.search(r"\{.*\}", txt, re.S)
    out = json.loads(m.group(0)) if m else {}
    return {str(x.get("id")): x for x in out.get("items") or [] if isinstance(x, dict) and x.get("what") and not EMPTY.search(x.get("what"))}


def takeaway(t, title, what):
    """« À retenir »: a concrete fact of the article, or nothing (not a generic line, not the title or summary again)"""
    t = clip(t, 260)
    if not t or EMPTY.search(t) or GENERIC.search(t) or len(t.split()) < 4 or adds_nothing(t, title + " " + (what or "")):
        return None
    return t


BRIEF = """Tu écris « Le point du matin » de PowerKlock : l'analyse du marché de l'électricité français, comme un analyste marché
senior qui parle à des directeurs du secteur. Un seul paragraphe, 5 ou 6 phrases, 140 mots au plus, ton clair et posé,
sans liste ni titre. Pas d'actualité générale : la page la donne juste en dessous. Le contexte géopolitique vient des
actualités de marché reçues : dis ce qui se passe et en quoi cela touche le gaz, donc l'électricité.
Tu reçois : les marchés du matin (dont le spot du jour et le Cal 27, contrat de l'an prochain), les fondamentaux France
(consommation, demande résiduelle face à la veille), l'indice PowerKlock (couverture bas-carbone, exportations, coût du MWh
d'une centrale au gaz, température face à la normale), les lectures de « Ce qui a bougé et pourquoi » (Cal, nucléaire, gaz,
carbone), notre contexte de marché (nucléaire, météo, géopolitique), les tendances
attendues de la semaine (une attente : « devrait ») et les actualités de marché des dernières 36 h (id, titre, extrait, média).
Ce qu'on attend :
  - le spot ET le Cal 27, et ce que leur écart dit (le marché voit-il le mouvement durer ?) ; reprends la lecture de
    « Ce qui a bougé » (bloc ce_qui_a_bougé, déjà calculée : Cal face au gaz seul, nucléaire face à la prévision de
    l'exploitant, stocks de gaz face à l'an dernier, effet du CO₂) : ce sont nos lectures, plus fiables que tes déductions ;
  - une phrase sur la consommation et la demande résiduelle du jour face à la veille, qui explique le mouvement du spot
    (« Cette hausse s'inscrit dans un contexte de consommation et de demande résiduelle en hausse ») ;
  - la lecture de l'indice PowerKlock (page Aujourd'hui) : la production bas-carbone française (nucléaire, hydraulique,
    éolien, solaire) rapportée à la consommation. Au-dessus de 100 %, la France couvre sa demande sans gaz et exporte : son
    prix suit alors celui de ses voisins, souvent fixé par leurs centrales au gaz. En dessous, ce sont les centrales au gaz
    françaises qui fixent le prix, près de leur coût de production (gaz et CO₂). Dis où l'on en est et ce que cela explique,
    et relie-le à la température face à la normale (plus froid = plus de consommation = couverture qui baisse) ;
  - pourquoi, dit simplement : quand il reste plus de demande à couvrir une fois l'éolien et le solaire déduits, il faut
    appeler davantage de centrales au gaz, les plus chères ; ce sont elles qui fixent alors le prix, qui suit donc le gaz
    (« il faut davantage de centrales au gaz pour passer la journée, et ce sont elles qui fixent le prix ») ; jamais
    « la demande résiduelle pousse les centrales au gaz à fixer le prix », phrase obscure ; le nucléaire disponible joue en sens inverse ;
  - le gaz et son contexte géopolitique, dit simplement (ce qui se passe, en quoi cela touche les prix) ;
  - ce qu'on attend pour les jours qui viennent (météo, tendance de la semaine), au conditionnel.
Varie les verbes : pas deux fois la même tournure. 4 à 6 chiffres, arrondis. Une cause n'est écrite que si le contexte ou un
article la donne. Aucun fait, chiffre, acteur ni date absent de ce qui est reçu. Interdits : « les prix restent volatils »,
« influencés par des facteurs », tout conseil.
Le ton seulement (un autre jour, d'autres faits : n'en reprends ni les mots ni les faits) : « Le solaire pèse sur les prix :
le spot recule de 8 % sous 60 €, avec deux heures négatives à la mi-journée. Le Cal-27 ne bouge pas, signe que le marché ne
voit pas l'épisode durer. À noter : RTE ouvre sa consultation sur les règles de raccordement. »
Réponds en JSON seulement : {"brief": "<français>", "brief_en": "<anglais>", "sources": ["<id des actualités de marché utilisées>"]}"""


def numbers_ok(text, given):
    """every figure of a generated text is one of the figures it was given (rounding allowed): nothing invented"""
    nums = [float(x.replace("\u202f", "").replace(" ", "").replace(",", ".")) for x in re.findall(r"\d+(?:[ \u202f]\d{3})*(?:[.,]\d+)?", text or "")]
    return all(any(abs(n - g) <= max(0.6, 0.012 * abs(g)) for g in given) for n in nums)


UPW = r"hausse|haussi|monte|remonte|grimpe|progress|gagne|augment|bondit|s.envole|rench[ée]ri|rises?|up\b|gains?|climbs?|jumps?"
DOWNW = r"baisse|recul|chute|perd|c[èe]de|repli|diminu|d[ée]croch|falls?|down\b|drops?|slips?|eases?|declines?"
MKT_KEY = [(r"spot", "spot"), (r"\bgaz\b|\bpeg\b|\bgas\b|\bttf\b", "peg"), (r"\bcal", "cal"), (r"garanties|guarantees", "garanties"), (r"pointe|peak", "pointe")]
PRICE_NEWS = re.compile(r"prix|price|cours|march[ée]|market|peg|ttf|spot|ormuz|hormuz|gnl|lng|p[ée]trole|oil|brent|g[ée]opolit|tension|sanction|"
                        r"approvisionnement|supply|stocks?|carbone|co2|quotas?|nucl[ée]aire|disponibilit", re.I)


def direction_ok(text, markets):
    """a market said to rise really rose (and the other way): the sentence that names it must not give the opposite move"""
    for r in markets:
        lab = (r.get("label") or [""])[0].lower()
        key = next((rx for rx, k in MKT_KEY if k in lab), None)
        move = r.get("chg") if r.get("show") == "abs" or r.get("hours") else r.get("pct")
        if not key or not isinstance(move, (int, float)) or abs(move) < 0.5:
            continue
        for sent in re.split(r"(?<=[.;!?])\s+", text):
            m = re.search(key, sent, re.I)
            if not m:
                continue
            after = sent[m.start(): m.start() + 90].lower()
            up, down = re.search(UPW, after), re.search(DOWNW, after)
            first = min([x for x in (up, down) if x], key=lambda x: x.start(), default=None)
            if first is not None and (first is down) == (move > 0):
                return False
            break
    return True


def fundamentals(day):
    """France's consumption, wind and solar of the delivery day against the day before (TSO forecasts, data/forecast.json),
    and the demand left to nuclear, hydro and gas (consumption minus wind and solar): what links power to gas"""
    try:
        days = json.load(open(os.path.join(ROOT, "data", "forecast.json")))["zones"]["FR"]["days"]
    except (OSError, ValueError, KeyError):
        return {}
    prev = (date.fromisoformat(day) - timedelta(days=1)).isoformat()

    def avg(d, k):
        v = [x for x in ((days.get(d) or {}).get(k) or []) if x is not None]
        return sum(v) / len(v) / 1000 if len(v) >= 80 else None     # GW, a whole day only
    out = {}
    for k, name in (("load", "consommation"), ("wind", "éolien"), ("solar", "solaire")):
        a, b = avg(day, k), avg(prev, k)
        if a is not None:
            out[name] = {"moyenne_GW": round(a, 1), "veille_GW": round(b, 1) if b else None,
                         "évolution": None if not b else ("en hausse de " if a > b else "en baisse de ") + f"{abs(round((a / b - 1) * 100))} %"}
    if all(k in out for k in ("consommation", "éolien", "solaire")):
        r = out["consommation"]["moyenne_GW"] - out["éolien"]["moyenne_GW"] - out["solaire"]["moyenne_GW"]
        rb = [out[k].get("veille_GW") for k in ("consommation", "éolien", "solaire")]
        out["demande_résiduelle"] = {"moyenne_GW": round(r, 1), "note": "consommation moins éolien et solaire : ce que nucléaire, hydraulique et gaz doivent fournir ; "
                                     "plus elle monte, plus les centrales au gaz fixent le prix de l'électricité"}
        if all(rb):
            rr = rb[0] - rb[1] - rb[2]
            out["demande_résiduelle"]["évolution"] = ("en hausse de " if r > rr else "en baisse de ") + f"{abs(round((r / rr - 1) * 100))} %"
    return out


def pk_index(day):
    """the reading of the PowerKlock index (Today › Expert, js/morning.js _mrnIndex): France's low-carbon output (nuclear,
    hydro, wind, solar, bioenergy) against its consumption on the last day RTE published, against the day before; the cost of
    a gas plant's MWh (TTF / 0.55 efficiency + 0.37 t CO2 × EUA, the site's convention); the temperature against normal"""
    out = {}
    try:
        rows = json.load(open(os.path.join(ROOT, "data", "history", "rte", "fr_daily.json")))["rows"]
        rows = [r for r in rows if r.get("loadAvg") and r.get("d", "") < day]
        cov = lambda r: sum(r.get(k) or 0 for k in ("nuclearAvg", "hydroAvg", "windAvg", "solarAvg", "bioAvg")) / r["loadAvg"] * 100  # noqa: E731
        a, b = rows[-1], rows[-2]
        out["couverture_bas_carbone"] = {"jour": a["d"], "pct": round(cov(a)), "veille_pct": round(cov(b)),
                                         "exports_GW": round(-(a.get("exchAvg") or 0) / 1000, 1) if (a.get("exchAvg") or 0) < 0 else 0,
                                         "spot_base_ce_jour": round(a["base"]) if a.get("base") else None}
    except (OSError, ValueError, KeyError, IndexError):
        pass
    try:
        S = json.load(open(os.path.join(ROOT, "data", "history", "commodities_series.json")))["series"]
        ttf, eua = S["ttf"]["points"][-1][1], S["eua"]["points"][-1][1]
        out["coût_MWh_centrale_gaz"] = round(ttf / 0.55 + 0.37 * eua)
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        pass
    try:
        T = json.load(open(os.path.join(ROOT, "data", "weather_outlook.json")))["countries"]["FR"]["series"]["temp"]
        ix = T["days"].index(day)
        val = lambda i: T["actual"][i] if T["actual"][i] is not None else T["mean"][i]  # noqa: E731
        an = [val(i) - T["normal"][i] for i in range(ix, min(ix + 7, len(T["days"]))) if val(i) is not None and T["normal"][i] is not None]
        if an:
            m = sum(an) / len(an)
            out["température_7_jours_vs_normale"] = ("au-dessus" if m > 0 else "en dessous") + f" de la normale de {abs(round(m, 1))} °C"
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        pass
    return out


def what_moved():
    """the readings of « What moved and why » (Today, js/market-brief.js), the same calculations: the Cal of next year against
    what gas alone would have done over the week (Δ gas Cal × 2, a gas plant burning about 2 MWh of gas per MWh), nuclear
    availability against the week before, a year before and the operator's forecast, gas and its EU storage against a year
    before, CO2 and what it does to a gas plant's cost (0.37 t per MWh)"""
    out = {}

    def back(pts, days):
        if not pts:
            return None
        t = (date.fromisoformat(pts[-1][0][:10]) - timedelta(days=days)).isoformat()
        v = [x[1] for x in pts if x[0][:10] <= t and x[1] is not None]
        return v[-1] if v else None
    try:
        cs = json.load(open(os.path.join(ROOT, "data", "history", "commodities_series.json")))
        P = lambda k: [p for p in (cs["series"].get(k) or {}).get("points") or [] if p[1] is not None]  # noqa: E731
        Y = json.load(open(os.path.join(ROOT, "data", "history", "fr_market_calchain.json")))["FR"]["years"]
        y0 = sorted(Y)[0]
        fr = list(zip(Y[y0]["dates"], Y[y0]["values"]))
        dfr = fr[-1][1] - back(fr, 7) if back(fr, 7) is not None else None
        ty = cs.get("calYears", {}).get("ttf", {}).get(y0)
        tp = list(zip(ty["dates"], ty["values"])) if ty else []
        gas = (tp[-1][1] - back(tp, 7)) * 2 if tp and back(tp, 7) is not None else None
        if dfr is not None and gas is not None:
            out["cal"] = {"contrat": f"Cal {y0[2:]}", "variation_7_jours_€": round(dfr, 1), "effet_du_gaz_seul_€": round(gas, 1),
                          "lecture": "la France monte moins que le gaz seul (nucléaire et demande détendus)" if dfr < gas else "la France monte plus que le gaz seul : ses propres fondamentaux se tendent"}
        nu, nf = P("fr_nuc_avail"), P("fr_nuc_avail_fc")
        if nu:
            w, yb = back(nu, 7), back(nu, 365)
            out["nucléaire"] = {"disponible_GW": round(nu[-1][1] / 1000, 1), "sur_7_jours_GW": round((nu[-1][1] - w) / 1000, 1) if w else None,
                                "sur_un_an_GW": round((nu[-1][1] - yb) / 1000, 1) if yb else None,
                                "sous_la_prévision_de_l_exploitant_GW": round((nf[-1][1] - nu[-1][1]) / 1000, 1) if nf and nf[-1][1] > nu[-1][1] else 0,
                                "lecture": "moins de nucléaire, c'est plus de gaz appelé et des prix en hausse ; son retour pèserait sur les prix"}
        tt, ag = P("ttf"), P("agsi")
        if tt:
            w = back(tt, 7)
            out["gaz"] = {"TTF_€": round(tt[-1][1]), "sur_7_jours_pct": round((tt[-1][1] / w - 1) * 100, 1) if w else None}
            if ag and back(ag, 365) is not None:
                out["gaz"]["stocks_UE_pts_vs_an_dernier"] = round(ag[-1][1] - back(ag, 365), 1)
                out["gaz"]["lecture"] = "des stocks plus bas qu'il y a un an laissent moins de marge pour l'hiver, un soutien aux prix" if ag[-1][1] < back(ag, 365) else "des stocks plus hauts qu'il y a un an détendent l'hiver"
        eu = P("eua")
        if eu and back(eu, 7) is not None:
            d = eu[-1][1] - back(eu, 7)
            out["carbone"] = {"EUA_€": round(eu[-1][1], 1), "effet_sur_le_coût_d_une_centrale_gaz_€": round(0.37 * d, 1)}
    except (OSError, ValueError, KeyError, IndexError, TypeError, ZeroDivisionError):
        pass
    return out


def trends_only(f):
    """the fundamentals as moves (« en hausse de 6 % »), without the levels: the brief explains, the tiles give the numbers"""
    # consumption and residual demand only: wind and solar alone led the model to wrong reasoning (24 Nov. 2026 tests)
    return {k: {"évolution": v.get("évolution"), **({"note": v["note"]} if v.get("note") else {})} for k, v in f.items()
            if v.get("évolution") and k in ("consommation", "demande_résiduelle")}


def ask_brief(edition, model=None, items=None):
    """« Le point du matin »: the markets with their reasons (our market context of the evening before) and the day's news"""
    try:
        md = json.load(open(os.path.join(ROOT, "data", "market_digest.json")))
    except (OSError, ValueError):
        md = {}
    fresh = md.get("asof") and (date.fromisoformat(edition["date"]) - date.fromisoformat(md["asof"])).days <= 3
    ctx = [{"sujet": c.get("topic"), "texte": c.get("text"), "tendance": c.get("tone")} for c in (md.get("context") or [])] if fresh else []
    rnd = lambda v, d: None if not isinstance(v, (int, float)) else round(v) if abs(v) >= 20 or d == 0 else round(v, d)  # noqa: E731
    # rounded as one says them (« vers 245 € », « +3 % »): the text then reads like a note, not a table
    mk = [{"marché": r["label"][0], "valeur": rnd(r.get("value"), 1), "unité": r.get("unit"),
           "variation": (("en hausse de " if r.get("pct", 0) > 0 else "en baisse de " if r.get("pct", 0) < 0 else "stable ") + f'{abs(rnd(r.get("pct"), 0))} %' if isinstance(r.get("pct"), (int, float)) and r.get("show") != "abs" and not r.get("hours")
                         else f'{rnd(r.get("chg"), 1):+} {"h" if r.get("hours") else "€"}' if isinstance(r.get("chg"), (int, float)) else None)}
          for r in edition.get("markets") or []]
    w = edition.get("weather") or {}
    names = {"oil": "pétrole", "gas": "gaz", "power": "électricité", "carbon": "carbone"}
    trend = {names.get(k, k): {"tendance": v.get("tone"), "texte": v.get("text")} for k, v in (md.get("outlook") or {}).items()} if fresh else {}
    # the market news of the last 36 h: what moved the prices (gas, power, carbon, geopolitics), the most important first
    now = datetime.fromisoformat(edition["updated"])
    mkt = [i for i in items or [] if {"markets", "gas", "geopolitics", "power", "carbon"} & set(i.get("topics") or [])
           and PRICE_NEWS.search(i["title"]) and not {"official", "research"} & set(i.get("tags") or []) and (age_h(i, now) or 1e9) <= 36]
    mkt = sorted(mkt, key=lambda i: -(i.get("impact") or 0))[:5]
    news = [{"id": f"n{k + 1}", "titre": i["title"], "extrait": clip(i.get("snippet"), 300), "média": i["source"]} for k, i in enumerate(mkt)]
    payload = {"marchés": mk, "fondamentaux_france": trends_only(fundamentals(edition["date"])), "indice_powerklock": pk_index(edition["date"]), "ce_qui_a_bougé": what_moved(), "contexte": ctx, "tendances_semaine": trend, "actualités_marché": news, "météo": " · ".join(filter(None, [(w.get("label") or [""])[0], (w.get("sub") or [""])[0]]))}
    msg = {"max_tokens": 700, "system": BRIEF, "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
           "model": model or os.environ.get("NEWS_MODEL") or MODEL}
    req = urllib.request.Request(PROXY, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json", "User-Agent": "PowerKlock-newsletter"})
    r = json.load(urllib.request.urlopen(req, timeout=150))
    txt = "".join(b.get("text") for b in r.get("content", []) if b.get("type") == "text" and isinstance(b.get("text"), str))
    m = re.search(r"\{.*\}", txt, re.S)
    out = json.loads(m.group(0), strict=False) if m else {}   # the two paragraphs come with a real line break
    given = [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", json.dumps(payload, ensure_ascii=False).replace("\u202f", ""))]
    given += [float(v) for r_ in edition.get("markets") or [] for v in (r_.get("value"), r_.get("pct"), r_.get("chg")) if isinstance(v, (int, float))]
    given += [abs(g) for g in given]
    para = lambda t: "\n\n".join(clip(x, 900) for x in re.split(r"\n\s*\n", str(t or "")) if x.strip())  # noqa: E731   two paragraphs kept
    b, be = para(out.get("brief")), para(out.get("brief_en"))
    market_par = re.split(r"\n\s*\n", b or "")[0]   # the market paragraph: a note, not a table of figures (« Cal-27 » is a name; the news keep theirs)
    many = len(re.findall(r"(?<![\w-])\d+(?:[.,]\d+)?", re.sub(r"\b(19|20)\d\d\b", "", market_par))) > 8
    hollow = re.search(r"(?i)restent volatils|reste volatil|influenc[ée]s par (des|les) facteurs|il faut retenir que les prix|pousse les centrales", b or "")
    hollow = hollow or len((b or "").split()) > 160
    hollow = hollow or len(re.findall(r"(?i)\ben hausse\b", b or "")) > 3      # the same words again and again
    hollow = hollow or "\n\n" in (b or "")                                                 # one paragraph: the market only
    if payload.get("fondamentaux_france"):                                                  # consumption and residual demand always said
        hollow = hollow or not (re.search(r"(?i)consommation", b or "") and re.search(r"(?i)demande r[ée]siduelle", b or ""))
    hollow = hollow or not re.search(r"(?i)\bcal", b or "")                                  # the year ahead says whether the move lasts
    if not b or many or hollow or not numbers_ok(b, given) or not direction_ok(b, edition.get("markets") or []):
        raise ValueError(f"brief rejected: {b[:120]!r}")   # a figure that was not given: better no brief
    used = [mkt[int(x[1:]) - 1] for x in out.get("sources") or [] if isinstance(x, str) and re.fullmatch(r"n[1-5]", x) and int(x[1:]) <= len(mkt)]
    links = [{"title": i["title"], "source": i["source"], "link": i["link"]} for i in dict((i["link"], i) for i in used).values()][:3]
    return b, (be if be and numbers_ok(be, given) else None), links

def clip(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def back(points, days):
    """the last point, and the one `days` before it (1: the previous session; 7: a week before)"""
    p = [x for x in points if x[1] is not None]
    if len(p) < 2:
        return None, None
    if days <= 1:
        return p[-1], p[-2]
    lim = (date.fromisoformat(str(p[-1][0])[:10]) - timedelta(days=days)).isoformat()
    old = [x for x in p if str(x[0])[:10] <= lim]
    return p[-1], (old[-1] if old else p[0])


def go_y1():
    """guarantees of origin, renewable, next calendar year: the latest weekly broker quote (data/go_prices.csv, the
    site's Markets › Guarantees of origin), mid of bid and ask, and the quote before it"""
    import csv
    try:
        with open(os.path.join(ROOT, "data", "go_prices.csv")) as f:
            rows = [r for r in csv.DictReader(f) if r.get("term", "").replace(" ", "") == "Y+1" and r.get("bid")]
    except OSError:
        return None
    rows.sort(key=lambda r: r["mail_date"])
    mid = lambda r: (float(r["bid"]) + float(r["ask"])) / 2 if r.get("ask") else float(r["bid"])  # noqa: E731
    if not rows:
        return None
    prev = [r for r in rows if r["mail_date"] < rows[-1]["mail_date"]]
    return mid(rows[-1]), (mid(prev[-1]) if prev else None), rows[-1]["year"]


MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def month_avg(first, last):
    """mean of the published daily averages (data/history/daily/<D>.json, FR avg) from first to last, the days present"""
    v, d = [], first
    while d <= last:
        a = (((dload("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get("FR") or {}).get("avg")
        if a is not None:
            v.append(a)
        d += timedelta(days=1)
    return sum(v) / len(v) if v else None


def markets(today, days=1):
    """the six price tiles, French first (chosen by the owner, 17 Nov. 2026): France spot today, peak minus base, hours at
    0 € or below tomorrow (published at about 13:00, before that PowerKlock's forecast), Cal+1 France, PEG,
    guarantees of origin for next year. Change on the day before (the spot), on the previous session (Cal, PEG), on the
    previous quote (GO). PowerBrunch: France spot of the month so far (against last month), Cal+1 France, solar and wind
    PPA benchmarks (over the week), the CRE's latest solar M0 (against the month before), guarantees of origin."""
    rows = []

    def row(fr, en, value, unit, ref=None, src="", page="markets/spot", show="pct"):
        # show: pct = change in %; abs = change in the unit (a spread); h = change in hours (more hours at 0 € or below
        # is lower prices, shown green like a fall)
        rows.append({"label": [fr, en], "value": round(value, 1 if show == "h" else 2), "unit": unit, "page": page, "src": src,
                     "show": show, "hours": show == "h", "chg": None if ref is None else round(value - ref, 2),
                     "pct": None if (not ref or show != "pct") else round((value / ref - 1) * 100, 1)})
    sp = {k: spot(today - timedelta(days=k)) for k in range(-1, 14)}   # -1 = tomorrow
    if days > 1:
        # PowerBrunch (chosen by the owner, 17 Nov. 2026): spot of the month so far, Cal+1, solar and wind PPAs, the
        # CRE's latest solar M0, guarantees of origin
        cur = month_avg(today.replace(day=1), today)
        prev_end = today.replace(day=1) - timedelta(days=1)
        prv = month_avg(prev_end.replace(day=1), prev_end)
        if cur:
            row(f"Spot France, moyenne {MOIS[today.month - 1]}", f"France spot, {today:%B} average", cur, "€/MWh", prv, "ENTSO-E", "markets/spot/overview")
    else:
        t, y, tm = sp.get(0), sp.get(1), sp.get(-1)
        fc = ((dload("neg_forecast.json") or {}).get("days") or {}).get((today + timedelta(days=1)).isoformat()) or {}
        if t:
            row("Spot France aujourd'hui", "France spot today", t["base"], "€/MWh", y["base"] if y else None, "ENTSO-E")
        if t:
            row("Pointe − base aujourd'hui", "Peak − base today", t["peak"] - t["base"], "€/MWh", (y["peak"] - y["base"]) if y else None, "ENTSO-E", show="abs")
        if tm:
            row("Heures ≤ 0 € demain", "Hours ≤ 0 € tomorrow", tm["neg"], "h", t["neg"] if t else None, "ENTSO-E", "markets/spot/negative", show="h")
        elif t:
            row("Heures ≤ 0 € aujourd'hui", "Hours ≤ 0 € today", t["neg"], "h", y["neg"] if y else None, "ENTSO-E", "markets/spot/negative", show="h")
    ch = dload("history", "fr_market_calchain.json") or {}
    y1 = str(today.year + 1)
    cy = ((ch.get("FR") or {}).get("years") or {}).get(y1)
    if cy:
        a, b = back(list(zip(cy["dates"], cy["values"])), days)
        if a:
            row(f"Cal {y1[2:]} France", f"Cal {y1[2:]} France", a[1], "€/MWh", b[1], "EEX", "markets/forwards")
    cs = (dload("history", "commodities_series.json") or {}).get("series") or (dload("commodities.json") or {}).get("series") or {}
    if "peg" in cs:
        a, b = back(cs["peg"]["points"], days)
        if a:
            row("Gaz PEG", "PEG gas", a[1], "€/MWh", b[1], "PowerKlock", "markets/fuels")
    if days > 1:
        # one tile per technology: the PPA benchmark (change over the week)
        bm = (dload("history", "ppa_benchmark.json") or {}).get("days") or {}
        # under it, the forecast M0 of next month (PowerKlock: the CRE's method on the month's forward, data/cre_m0.json)
        fc = next((x for x in ((dload("cre_m0.json") or {}).get("forecast") or []) if x.get("month", "") > today.strftime("%Y-%m")), None)
        for tech, fr, en in (("solar", "Solaire", "Solar"), ("wind", "Éolien", "Wind")):
            a, b = back([(d, (bm[d].get(tech) or {}).get("ppa")) for d in sorted(bm)], 7)
            if not a:
                continue
            row(f"{fr} · PPA France", f"{en} · France PPA", a[1], "€/MWh", b[1], "PowerKlock", "tools/ppa")
            if fc and fc.get(tech) is not None:
                mo = fc["month"]
                rows[-1]["sub"] = [f"M0 prévu {MOIS[int(mo[5:]) - 1]} : {fc[tech]:.2f} €".replace(".", ","), f"Forecast M0 {mo}: €{fc[tech]:.2f}"]
    go = go_y1()
    if go:
        row("Garanties d'origine " + go[2], "Guarantees of origin " + go[2], go[0], "€/MWh", go[1], "Commerg", "markets/go")
    return rows


def pinned(now):
    """the story the admin put at the top in the last 36 hours (public.news_pin, warehouse migration 027), or None"""
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        return None
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
            cur.execute("select link from public.news_pin where pinned_at >= %s order by pinned_at desc limit 1", (now - timedelta(hours=36),))
            r = cur.fetchone()
            return r[0] if r else None
    except Exception as e:      # the newsletter must not depend on the database
        print("  pin not read:", str(e)[:160])
        return None


def figure_of_day(today):
    """the figure of the day: the spot's move on the day before when it is large (15 % or more), with how long since a
    larger one; else the hours at 0 € or below of the day; else none"""
    t, y = news_charts.day_avg(today), news_charts.day_avg(today - timedelta(days=1))
    if t is not None and y:
        pct = (t / y - 1) * 100
        if abs(pct) >= 15:
            k, since = 2, None
            while k <= 365:
                a, b = news_charts.day_avg(today - timedelta(days=k - 1)), news_charts.day_avg(today - timedelta(days=k))
                if a is not None and b and abs(a / b - 1) * 100 >= abs(pct) and (a / b - 1) * pct > 0:
                    since = k - 1
                    break
                k += 1
            word = "baisse" if pct < 0 else "hausse"
            when = (f"la plus forte {word} depuis {since} jours" if since and since > 7 else f"la plus forte {word} de la semaine" if since else f"la plus forte {word} depuis un an")
            when_en = (f"the largest {'fall' if pct < 0 else 'rise'} in {since} days" if since and since > 7 else f"the largest {'fall' if pct < 0 else 'rise'} of the week" if since else f"the largest {'fall' if pct < 0 else 'rise'} in a year")
            v = f"{'−' if pct < 0 else '+'}{abs(pct):.0f} %"
            return {"value": v, "dir": "dn" if pct < 0 else "up",
                    "text": f"Le spot France passe de {y:.0f} € à {t:.0f} € le MWh en 24 h : {when}.",
                    "text_en": f"France spot moves from €{y:.0f} to €{t:.0f} per MWh in 24 h: {when_en}.", "src": "ENTSO-E", "page": "markets/spot"}
    n = news_charts.day_neg(today)
    if n:
        return {"value": f"{n:.0f} h", "dir": "dn", "text": f"{n:.0f} heures à 0 € ou moins aujourd'hui en France.", "text_en": f"{n:.0f} hours at €0 or below today in France.",
                "src": "ENTSO-E", "page": "markets/spot/negative"}
    return None


def weather(today):
    """the market's weather, from the spot's move on the day before: clearing (prices down 10 % or more), storm (up 20 %
    or more), cloudy otherwise"""
    t, y = news_charts.day_avg(today), news_charts.day_avg(today - timedelta(days=1))
    if t is None or not y:
        return None
    pct = (t / y - 1) * 100
    if pct <= -10:
        return {"kind": "sun", "label": ["Éclaircie", "Clearing"], "sub": ["prix en baisse", "prices down"]}
    if pct >= 20:
        return {"kind": "storm", "label": ["Orage", "Storm"], "sub": ["prix en forte hausse", "prices up sharply"]}
    return {"kind": "cloud", "label": ["Nuageux", "Cloudy"], "sub": ["prix stables" if abs(pct) < 5 else "prix en hausse" if pct > 0 else "prix en baisse", "prices steady" if abs(pct) < 5 else "prices up" if pct > 0 else "prices down"]}


def prune_images(keep_days=21):
    """the images of past editions are kept three weeks (the site shows the latest edition only)"""
    lim = (date.today() - timedelta(days=keep_days)).isoformat()
    try:
        for f in os.listdir(news_charts.IMG):
            if f[:10] < lim:
                os.remove(os.path.join(news_charts.IMG, f))
    except OSError:
        pass


def main():
    force, use_ai, weekly = "--force" in sys.argv, "--no-ai" not in sys.argv, "--weekly" in sys.argv
    out_path = OUT_WEEK if weekly else OUT
    now = datetime.now(timezone.utc)
    today = now.astimezone(PARIS).date()
    old = load(out_path, {}) or {}
    if (today.weekday() >= 5 or (weekly and today.weekday() != 0)) and not force:
        print("no edition today")
        return 0
    built = datetime.fromisoformat(old["updated"]).astimezone(PARIS).hour if old.get("updated") else 0
    if old.get("date") == today.isoformat() and built >= 5 and not force:   # an edition built in the night is rebuilt in the morning
        print("today's edition exists")
        return 0
    profiles = (load(PROFILES, {}) or {}).get("profiles") or {}
    items = (load(os.path.join(ROOT, "data", "news.json"), {}) or {}).get("items") or []
    cons = (load(os.path.join(ROOT, "data", "consultations.json"), {}) or {}).get("items") or []
    events = (load(os.path.join(ROOT, "data", "events.json"), {}) or {}).get("items") or []
    monday = today.weekday() == 0
    # 7 O'Klock: the last 36 hours (84 on Monday); PowerBrunch: the week before, larger
    hours = 7 * 24 + 12 if weekly else 84 if monday else 36
    days = 7 if weekly else 4 if monday else 2
    ahead = 21 if weekly else 14
    iso = lambda d: d.isoformat()   # noqa: E731
    recent = [i for i in items if (age_h(i, now) or 1e9) <= days * 24 + 12]
    official = sorted([i for i in recent if "official" in (i.get("tags") or [])], key=lambda i: i["date"], reverse=True)[:12 if weekly else 6]
    pubs = sorted([i for i in recent if "official" not in (i.get("tags") or []) and ("report" in (i.get("tags") or []) or re.match(r"^(RTE|EEX)\b", i.get("source", "")))],
                  key=lambda i: i["date"], reverse=True)[:10 if weekly else 5]
    t = iso(today)
    c_soon = [c for c in cons if c.get("deadline") and t <= c["deadline"] <= iso(today + timedelta(days=ahead))]
    c_new = [c for c in cons if c.get("opened") and c["opened"] >= iso(today - timedelta(days=days)) and (not c.get("deadline") or c["deadline"] >= t)]
    cs = sorted({c["link"]: c for c in c_soon + c_new}.values(), key=lambda c: c.get("deadline") or "9999")[:10 if weekly else 6]
    agenda = sorted([{"date": e["date"], "title": e.get("title"), "text": e.get("text"), "kind": e.get("kind")} for e in events
                     if t <= (e.get("date") or "") <= iso(today + timedelta(days=ahead))], key=lambda e: e["date"])[:8 if weekly else 5]
    posts = top_posts(now - timedelta(days=7))
    # the day's essentials (scripts/news_digest.py, run just before): today's, or on Monday the week before
    dg = load(os.path.join(ROOT, "data", "news_digest.json"), {}) or {}
    week = iso(today - timedelta(days=today.weekday()))
    de = (dg.get("weekly") if (dg.get("weekly") or {}).get("week") == week else None) if weekly else dg.get("daily") if (dg.get("daily") or {}).get("date") == t else None
    digest = {"weekly": de is dg.get("weekly"), "items": [{k: x.get(k) for k in ("text", "text_en", "title", "link", "sources")} for x in (de or {}).get("items") or []]} if de else None
    # the main articles: the highest impact of the last 24 hours (72 on Monday), one per outlet, one per event
    top, srcs = [], set()
    for i in sorted([i for i in items if (age_h(i, now) or 1e9) <= (7 * 24 if weekly else 72 if monday else 24) and "official" not in (i.get("tags") or []) and energy(i)],
                    key=lambda i: -((i.get("impact") or 0) + focus(i))):
        if i["source"] in srcs or any(similar(i["title"], o["title"]) for o in top):
            continue
        top.append(i)
        srcs.add(i["source"])
        if len(top) == (12 if weekly else 6):
            break
    edition = {"date": t, "updated": now.isoformat(timespec="seconds"), "engine": "proxy" if use_ai else "none", "monday": monday,
               "weekly": weekly, "markets": markets(today, 7 if weekly else 1),
               "official": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "tags": i.get("tags") or []} for i in official],
               "pubs": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "tags": i.get("tags") or []} for i in pubs],
               "cons": [{k: c.get(k) for k in ("title", "link", "source", "deadline", "opened", "theme")} for c in cs],
               "agenda": agenda, "post": posts[0] if posts else None, "posts": posts if weekly else [], "digest": digest,
               "top": [{"title": i["title"], "link": i["link"], "source": i["source"], "date": i["date"], "n": 1 + len(i.get("other_sources") or []), "tags": i.get("tags") or []} for i in top],
               "profiles": {}}
    edition["figure"] = None if weekly else figure_of_day(today)
    edition["weather"] = weather(today)
    soon = sorted([{"date": c["deadline"], "kind": "cons", "title": c["title"], "link": c["link"], "source": c.get("source")} for c in cons
                   if c.get("deadline") and t <= c["deadline"] <= iso(today + timedelta(days=7 if not weekly else 14))]
                  + [{"date": e["date"], "kind": "event", "title": (e.get("title") or [""])[0], "title_en": (e.get("title") or ["", ""])[-1], "link": None, "source": None}
                     for e in events if t <= (e.get("date") or "") <= iso(today + timedelta(days=14 if not weekly else 21))], key=lambda x: x["date"])[:6]
    edition["week_ahead"] = soon
    prune_images()
    if weekly:
        # « Ce jour-là »: the spot the same day in past years (published daily averages)
        past = []
        for k in range(1, 6):
            try:
                d0 = today.replace(year=today.year - k)
            except ValueError:
                continue
            v = news_charts.day_avg(d0)
            if v is not None:
                past.append({"year": d0.year, "value": round(v, 2)})
        edition["on_this_day"] = {"today": news_charts.day_avg(today), "past": past} if past else None
        edition["week_chart"] = None   # no chart any more (the owner's choice, 23 Nov. 2026)
    charts = {}
    ctx_cache = {}
    pin_link = pinned(now)
    pin = next((i for i in items if i.get("link") == pin_link), None) if pin_link else None
    edition["pinned"] = pin_link if pin else None
    for pid, prof in profiles.items():
        stories = pick(items, prof, now, hours, 5 if weekly else 3)
        if pin:     # the admin's pinned story leads every profile's edition
            stories = [pin] + [i for i in stories if i.get("link") != pin["link"]][:len(stories) - 1 if stories else 0]
        gen = {}
        if use_ai and stories:
            for attempt in (1, 2):      # the free model sometimes answers without JSON: once more
                try:
                    # the second try on the proxy's default model (Llama 3.3 70B), when Qwen3 is down or answers badly
                    gen = ask(prof, stories, official, None if attempt == 1 else "@cf/meta/llama-3.3-70b-instruct-fp8-fast")
                    break
                except Exception as e:  # the edition still goes out, with the extracts
                    print(f"{pid}: AI text not written, attempt {attempt} ({str(e)[:160]})")
        by = {str(x.get("id")): x for x in (gen.get("items") or []) if isinstance(x, dict)}
        out = []
        for i in stories:
            g = by.get(sid(i), {})
            what = g.get("what") or i.get("snippet")
            if what and adds_nothing(what, i["title"]) and i.get("snippet") and not adds_nothing(i["snippet"], i["title"]):
                what = i["snippet"]                     # the model only repeated the title: the outlet's own extract says more
            if what and EMPTY.search(what):
                what = None                             # the model saying it has nothing to say
            if what and adds_nothing(what, i["title"]):
                what = None                             # nothing beyond the title (press searches give titles only)
            out.append({"id": sid(i), "title": i["title"], "link": i["link"], "tags": (i.get("tags") or []) + (["fr"] if "FR" in (i.get("countries") or []) and "fr" not in (i.get("tags") or []) else []),
                        "sources": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                        "free": [{"source": o["source"], "link": o["link"]} for o in i.get("free") or []] or None,   # paid outlet: the story at free ones
                        "report_link": i.get("report_link"), "report_name": i.get("report_name"),   # a major publication: the report itself
                        "what": clip(what, 360) or None, "what_en": (clip(g.get("what_en"), 360) or None) if what and what == g.get("what") else None,
                        "for_you": takeaway(g.get("for_you"), i["title"], what), "for_you_en": clip(g.get("for_you_en"), 260) if takeaway(g.get("for_you"), i["title"], what) else None})
        # a story without a text gets a context written by the model (the owner's wish: always a text under a title),
        # marked « ctx » so the site and the mail can say so; one call per edition, shared by the profiles
        missing = [i for i in stories if not next((o for o in out if o["id"] == sid(i)), {}).get("what") and sid(i) not in ctx_cache]
        if use_ai and missing:
            for attempt in (1, 2):
                try:
                    ctx_cache.update(ask_context(missing, None if attempt == 1 else "@cf/meta/llama-3.3-70b-instruct-fp8-fast"))
                    break
                except Exception as e:
                    print(f"{pid}: context not written, attempt {attempt} ({str(e)[:160]})")
        for o in out:
            c = ctx_cache.get(o["id"])
            if not o.get("what") and c and not adds_nothing(c["what"], o["title"]):
                o["what"], o["what_en"], o["ctx"] = clip(c["what"], 360), clip(c.get("what_en"), 360) or None, True
        # no chart any more (the owner's choice, 23 Nov. 2026): the lead story is text only
        hero = None
        if False:
            spec = news_charts.pick(out[0]["title"] + " " + (out[0].get("what") or "") + " " + " ".join(i.get("snippet") or "" for i in stories[:1]), today)
            if spec:
                key = re.sub(r"[^a-z0-9]+", "-", spec["title"].lower())[:40]
                if key not in charts:
                    news_charts.draw(spec, os.path.join(news_charts.IMG, f"{t}_{key}.png"))
                    charts[key] = {"img": f"newsletter_img/{t}_{key}.png", "title": spec["title"], "src": spec["src"], "page": spec["page"]}
                hero = charts[key]
        edition["profiles"][pid] = {"hero_chart": hero, "name": prof["name"], "short": prof["short"], "order": prof["order"], "headline": clip(gen.get("headline"), 300) or None, "headline_en": clip(gen.get("headline_en"), 300) or None,
                                    "stories": out, "ai": bool(by)}
        print(f"{pid}: {len(out)} stories, AI text for {len(by)}")
    edition["brief"] = edition["brief_en"] = None
    edition["brief_links"] = []
    if use_ai and edition["profiles"]:
        # Qwen3 first when it answers, then Llama 4 Scout, the most faithful in the tests of 24 Nov. 2026, and two other free
        # models as a backup when Workers AI refuses one; a text that fails the checks (figures, direction, hollow lines) is
        # written again by the next one
        chain = [None, "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                 "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct"]
        for attempt, model in enumerate(chain, 1):
            try:
                edition["brief"], edition["brief_en"], edition["brief_links"] = ask_brief(edition, model, items)
                break
            except Exception as e:
                print(f"brief not written, attempt {attempt} ({str(e)[:160]})")
    with open(out_path, "w") as f:
        json.dump(edition, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
