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
OUT_WEEK = os.path.join(ROOT, "data", "newsletter_week.json")   # PowerBrunch, Monday at 08:00 instead of 7 O'Klock: the week before
# what the last editions carried (links, titles, brief): an article is never in two editions of 7 O'Klock, and a brief does not
# repeat yesterday's (the owner, 25 Nov. 2026); 10 days kept
HIST = os.path.join(ROOT, "data", "newsletter_history.json")
PREV_BRIEF = ""
PROFILES = os.path.join(ROOT, "config", "news_profiles.json")
MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
BORING = re.compile(r"(?i)customer information|adjustment of the .* calendar|\bwebinaire?s?\b|\bwebinar\b|\bportrait\b|le p[èe]re de\b|\bH/F\b|\bCDI\b|offre d.emploi|\balternance\b|black friday|\bbon plan\b|\bpromo(tion)?s?\b|\bpodcast\b|\brecrute\b|\bnomm[ée]e?\b|\bappoints?\b|\bjoins? .* as\b|"
                    r"\blance (en europe |sur le march[ée] )?(une|un|sa|son) (nouvelle |nouveau )?(batterie|onduleur|gamme|offre|produit|application)|\blaunch(es)? (a|its) new\b|\bstarts? .* production\b|\bpartenariat commercial\b")
# far from the French and European market (title-based: an outlet's country says little), unless geopolitics or gas moves it
FARAWAY = re.compile(r"(?i)alg[ée]ri|p[ée]rou|\bperu\b|\bchil[ei]|br[ée]sil|brazil|\binde\b|\bindia|\bchin[ae]\b|chinese|australi|japon|japan|afrique|africa|maroc|morocco|"
                     r"arabie|saudi|texas|californi|congr[èe]s am[ée]ricain|\bcanad|mexi|cor[ée]e|korea|vietnam|indon[ée]si|philippin|[ée]gypt|kenya|nigeria")
# a headline that teases instead of telling (« Ce chantier titanesque va… », « Cette future raffinerie… »)
TEASER = re.compile(r"(?i)^(ce|cette|ces)\s+\w+(\s+\w+)?\s+(va|vont|pourrait|veut|sera)\b|^(ce|cette)\s+(future?|nouvel(le)?)\b|\bvoici\b|ce que l.on sait|vous ne devinerez")
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
    if BORING.search(i.get("title", "")):
        s -= 3.0        # a product launch, an operator's notice, an appointment: rarely what a market reader needs
    if FARAWAY.search(i.get("title", "")) and not ({"geopolitics", "gas"} & set(subj) or "major" in tags):
        s -= 2.5        # far from the French and European market
    if TEASER.search(i.get("title", "")):
        s -= 2.0
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
    no extract: never kept, never shown. A paid outlet gives its public description only; Google News redirects and
    sites whose robots.txt or servers refuse are not read."""
    import html as _h
    import urllib.robotparser
    from urllib.parse import urlparse
    if url in _pages:
        return _pages[url]
    _pages[url] = ""
    if not url or "news.google." in url or len(_pages) > 40:
        return ""
    paid = bool(PAID.search(url))     # a paid paper: its public summary only (the page's description), never the article (owner, 24 Nov. 2026)
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
    txt = " ".join(([_h.unescape(desc.group(1))] if desc else []) + ([] if paid else paras))
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
senior qui parle à des directeurs du secteur. Un seul paragraphe, 4 phrases, 90 mots au plus, simple à lire : un enchaînement de causes, pas un relevé ; ton clair et posé,
sans liste ni titre. Pas d'actualité générale : la page la donne juste en dessous. Le contexte géopolitique vient des
actualités de marché reçues : dis ce qui se passe et en quoi cela touche le gaz, donc l'électricité.
Tu reçois d'abord « conclusions_du_jour » : notre analyse, calculée à partir des données. C'est le fond du texte : garde
ces conclusions, dans cet ordre, sans en inverser aucune (si la France couvre sa consommation et exporte, son prix suit ses
voisins : n'écris jamais alors que les centrales au gaz françaises fixent le prix) ; tu les relies et les rends fluides,
tu peux en laisser une de côté, tu n'en ajoutes pas. Le reste sert à les comprendre.
Tu reçois aussi : les marchés du matin (dont le spot du jour et le Cal 27, contrat de l'an prochain), les fondamentaux France
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
  - ce qu'on attend pour les jours qui viennent (météo, tendance de la semaine), au conditionnel ;
  - un signal structurant (bloc signaux_structurants, rempli seulement quand il compte vraiment, par exemple des réservoirs
    hydrauliques au plus bas depuis dix ans) : une proposition, s'il y en a un ; rien sinon. Pas d'information secondaire.
Évite les répétitions : pas deux fois la même tournure, et « gaz », « prix », « hausse », « marché » deux fois au plus
chacun (le prix de gros, se tend, progresse…). 2 ou 3 chiffres seulement (le spot, et un chiffre qui explique) : le lecteur ne doit pas être noyé ; les tuiles donnent les autres. Une cause n'est écrite que si le contexte ou un
article la donne. Aucun fait, chiffre, acteur ni date absent de ce qui est reçu. Interdits : « les prix restent volatils »,
« influencés par des facteurs », tout conseil.
{example}
Réponds en JSON seulement : {"brief": "<français>", "brief_en": "<anglais>", "sources": ["<id des actualités de marché utilisées>"]}"""


def brief_system():
    """the prompt, with the model text of config/brief_example.json (written by hand, editable) as the tone to follow"""
    try:
        ex = json.load(open(os.path.join(ROOT, "config", "brief_example.json")))
        # the tone only, described: quoted (whole, then its first sentence) the model copied it every morning (25 Nov. 2026)
        example = ("Le ton à suivre : un analyste qui parle à un directeur, phrases courtes qui enchaînent cause et effet, aucune "
                   "formule toute faite. Ouvre sur le fait du jour le plus parlant, pas sur la météo par habitude.") if ex.get("fr") else ""
    except (OSError, ValueError, KeyError):
        example = ""
    return BRIEF.replace("{example}", example)


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


def structural(day):
    """only what really shapes the season, and only when it does: French hydro reservoirs far from their usual level for
    the week (ENTSO-E A72, data/history/hydro_reservoirs.json, 25 % or more off the 2015-2025 mean, with their rank)"""
    out = []
    try:
        W = json.load(open(os.path.join(ROOT, "data", "history", "hydro_reservoirs.json")))["countries"]["FR"]["weeks"]
        W = sorted(W.items()) if isinstance(W, dict) else W
        d0, v0 = W[-1]
        if (date.fromisoformat(day) - date.fromisoformat(d0)).days <= 21:
            wk = date.fromisoformat(d0).isocalendar()[1]
            same = {k[:4]: v for k, v in W if date.fromisoformat(k).isocalendar()[1] == wk and k[:4] != d0[:4]}
            if len(same) >= 5:
                avg, gap = sum(same.values()) / len(same), None
                gap = (v0 / avg - 1) * 100
                if abs(gap) >= 25:
                    low = v0 < min(same.values()) and gap < 0
                    high = v0 > max(same.values()) and gap > 0
                    out.append({"sujet": "réservoirs hydrauliques français", "semaine_du": d0,
                                "écart_à_la_normale": ("en dessous" if gap < 0 else "au-dessus") + f" de la normale de {abs(round(gap))} %",
                                "rang": f"au plus bas pour la saison sur {len(same) + 1} ans de données" if low else f"au plus haut pour la saison sur {len(same) + 1} ans de données" if high else None,
                                "lecture": "moins d'eau en réserve, c'est moins de flexibilité pour passer les pointes d'hiver : plus de gaz et d'imports appelés aux heures chères"
                                if gap < 0 else "des réservoirs bien remplis donnent de la marge pour les pointes d'hiver"})
    except (OSError, ValueError, KeyError, IndexError, TypeError, ZeroDivisionError):
        pass
    return out


def trends_only(f):
    """the fundamentals as moves (« en hausse de 6 % »), without the levels: the brief explains, the tiles give the numbers"""
    # consumption and residual demand only: wind and solar alone led the model to wrong reasoning (24 Nov. 2026 tests)
    return {k: {"évolution": v.get("évolution"), **({"note": v["note"]} if v.get("note") else {})} for k, v in f.items()
            if v.get("évolution") and k in ("consommation", "demande_résiduelle")}


def fr_num(v, d=1):
    """1 234,5 in French"""
    t = f"{v:,.{d}f}".replace(",", "\u202f").replace(".", ",")
    return t


def key_facts(edition):
    """the day's analysis as conclusions computed from the data (the owner, 25 Nov. 2026: the brief copied its model text and
    said the opposite of the data): one sentence each, French and English, the most telling first. The AI writes the brief
    from these only; when it fails the checks, they are the brief."""
    f = []
    M = edition.get("markets") or []
    sp = next((r for r in M if r["label"][0].startswith("Spot France")), None)
    if sp:
        mv = sp.get("pct")
        trend_fr = "" if not isinstance(mv, (int, float)) or abs(mv) < 1 else (f", en hausse de {fr_num(abs(mv), 0)} % sur la veille" if mv > 0 else f", en baisse de {fr_num(abs(mv), 0)} % sur la veille")
        trend_en = "" if not isinstance(mv, (int, float)) or abs(mv) < 1 else (f", up {abs(mv):.0f} % on the day before" if mv > 0 else f", down {abs(mv):.0f} % on the day before")
        fr, en = f"Le spot France ressort à {fr_num(sp['value'], 0)} €/MWh pour aujourd’hui{trend_fr}.", f"The French spot is {sp['value']:.0f} €/MWh for today{trend_en}."
        # where France stands among its neighbours, the same delivery day (data/history/daily/<D>.json): a fact, not a guess
        try:
            Z = json.load(open(os.path.join(ROOT, "data", "history", "daily", edition["date"] + ".json"))).get("zones") or {}
        except (OSError, ValueError):
            Z = {}
        NB = [("DE_LU", "l’Allemagne", "Germany"), ("BE", "la Belgique", "Belgium"), ("NL", "les Pays-Bas", "the Netherlands"),
              ("IT_NORD", "l’Italie du Nord", "northern Italy"), ("ES", "l’Espagne", "Spain"), ("CH", "la Suisse", "Switzerland")]
        nb = [(fz, ez, Z[z]["avg"]) for z, fz, ez in NB if isinstance((Z.get(z) or {}).get("avg"), (int, float))]
        lo = sorted([x for x in nb if x[2] < sp["value"] - 2], key=lambda x: x[2])[-3:]
        hi = sorted([x for x in nb if x[2] > sp["value"] + 2], key=lambda x: -x[2])[-3:]
        lst = lambda xs, k: " et ".join(", ".join(f"{x[k]} ({fr_num(x[2], 0) if k == 0 else f'{x[2]:.0f}'} €)" for x in xs).rsplit(", ", 1)) if xs else ""  # noqa: E731
        lsten = lambda xs: " and ".join(", ".join(f"{x[1]} ({x[2]:.0f} €)" for x in xs).rsplit(", ", 1))  # noqa: E731
        if lo and hi:
            fr += f" C’est plus cher que {lst(lo, 0)}, moins que {lst(hi, 0)}."
            en += f" That is above {lsten(lo)}, below {lsten(hi)}."
        elif lo:
            fr += f" La France est la zone la plus chère du voisinage, devant {lst(lo, 0)}."
            en += f" France is the dearest zone around, above {lsten(lo)}."
        elif hi:
            fr += f" La France est la zone la moins chère du voisinage, sous {lst(hi, 0)}."
            en += f" France is the cheapest zone around, below {lsten(hi)}."
        cost = (pk_index(edition["date"]) or {}).get("coût_MWh_centrale_gaz")
        if isinstance(cost, (int, float)):
            gap = sp["value"] - cost
            if gap > 15:
                fr += f" Le prix dépasse de {fr_num(gap, 0)} € le coût de production d’une centrale au gaz ({fr_num(cost, 0)} €/MWh) : le système est tendu, avec des heures de pointe payées bien au-delà du gaz."
                en += f" The price is {gap:.0f} € above a gas plant's production cost ({cost:.0f} €/MWh): the system is tight, with peak hours paid well above gas."
            elif gap >= -15:
                fr += f" Le prix est au niveau du coût de production d’une centrale au gaz ({fr_num(cost, 0)} €/MWh) : c’est le gaz qui fixe le prix."
                en += f" The price is at a gas plant's production cost ({cost:.0f} €/MWh): gas sets the price."
            else:
                fr += f" Le prix reste sous le coût de production d’une centrale au gaz ({fr_num(cost, 0)} €/MWh) : le nucléaire et les renouvelables fixent le prix une bonne partie de la journée."
                en += f" The price stays below a gas plant's production cost ({cost:.0f} €/MWh): nuclear and renewables set the price much of the day."
        f.append(("spot", fr, en))
    ix = pk_index(edition["date"])
    fu = trends_only(fundamentals(edition["date"])) or {}
    cv = ix.get("couverture_bas_carbone")
    temp = ix.get("température_7_jours_vs_normale")
    cons = (fu.get("consommation") or {}).get("évolution")
    rd = (fu.get("demande_résiduelle") or {}).get("évolution")
    # the reasons in words (the figures stay on the tiles and in Expert: a brief of few figures, the owner's wish)
    cold = temp and "en dessous" in temp
    up = lambda v: v and "hausse" in v  # noqa: E731
    if cold and up(cons):
        why_fr = "Le froid fait monter la consommation" + (" et ce qu’il reste à couvrir une fois l’éolien et le solaire déduits" if up(rd) else "") + "."
        why_en = "The cold lifts consumption" + (" and what is left to cover once wind and solar are taken off" if up(rd) else "") + "."
    elif temp and not cold and cons and not up(cons):
        why_fr, why_en = "La douceur fait reculer la consommation.", "Mild weather brings consumption down."
    elif up(rd):
        why_fr, why_en = "Il reste davantage à couvrir une fois l’éolien et le solaire déduits.", "More is left to cover once wind and solar are taken off."
    else:
        why_fr = why_en = ""
    if cv:
        # the coverage is of the day before (the last complete day of generation data): said as such, and without saying
        # who sets the price, which the spot sentence does from the prices themselves
        pct, prev, ex = cv["pct"], cv.get("veille_pct"), cv.get("exports_GW") or 0
        was_fr = f", contre {prev} % la veille" if prev is not None and prev != pct else ""
        was_en = f", against {prev} % the day before" if prev is not None and prev != pct else ""
        if pct >= 100:
            fr = f"Hier, la production bas-carbone couvrait encore la consommation française ({pct} %{was_fr})" + (f" et la France exportait {fr_num(ex)} GW." if ex >= 0.5 else ".")
            en = f"Yesterday low-carbon output still covered French consumption ({pct} %{was_en})" + (f" and France exported {ex:.1f} GW." if ex >= 0.5 else ".")
        else:
            fr = f"Hier, la production bas-carbone ne couvrait plus la consommation française ({pct} %{was_fr}) : le complément est venu du gaz et des importations."
            en = f"Yesterday low-carbon output no longer covered French consumption ({pct} %{was_en}): gas and imports made up the rest."
        f.append(("coverage", (why_fr + " " if why_fr else "") + fr, (why_en + " " if why_en else "") + en))
    W = what_moved()
    g = W.get("gaz") or {}
    if g.get("TTF_€") is not None:
        w = g.get("sur_7_jours_pct")
        st = g.get("stocks_UE_pts_vs_an_dernier")
        fr = "Le gaz " + (f"{'prend' if w > 0 else 'perd'} {fr_num(abs(w), 0)} % en une semaine" if isinstance(w, (int, float)) and abs(w) >= 1 else "reste stable sur la semaine")
        fr += (f", avec des stocks européens {'plus bas' if st < 0 else 'plus hauts'} qu’il y a un an." if isinstance(st, (int, float)) and abs(st) >= 2 else ".")
        en = f"TTF gas is at {g['TTF_€']} €/MWh" + (f", {'up' if w > 0 else 'down'} {abs(w):.1f} % over seven days" if isinstance(w, (int, float)) and abs(w) >= 1 else "")
        en += (f", with European storage {abs(st):.1f} points {'below' if st < 0 else 'above'} a year ago." if isinstance(st, (int, float)) and abs(st) >= 2 else ".")
        f.append(("gas", fr, en))
    nu = W.get("nucléaire") or {}
    if nu.get("disponible_GW") is not None:
        below = nu.get("sous_la_prévision_de_l_exploitant_GW")
        fr = f"Le nucléaire disponible atteint {fr_num(nu['disponible_GW'])} GW" + (f", {fr_num(below)} GW sous la prévision de l’exploitant" if isinstance(below, (int, float)) and below >= 1 else "") + "."
        en = f"Available nuclear is {nu['disponible_GW']:.1f} GW" + (f", {below:.1f} GW below the operator's forecast" if isinstance(below, (int, float)) and below >= 1 else "") + "."
        f.append(("nuclear", fr, en))
    c = W.get("cal") or {}
    if c.get("variation_7_jours_€") is not None:
        d = c["variation_7_jours_€"]
        cal = next((r for r in M if r["label"][0].startswith("Cal ")), None)
        lvl_fr = f" à {fr_num(cal['value'], 0)} €/MWh" if cal else ""
        lvl_en = f" at {cal['value']:.0f} €/MWh" if cal else ""
        mv_fr = (f"{'gagne' if d > 0 else 'perd'} {fr_num(abs(d))} € sur la semaine") if abs(d) >= 0.5 else "bouge à peine sur la semaine"
        mv_en = (f"{'gains' if d > 0 else 'loses'} {abs(d):.1f} € over the week") if abs(d) >= 0.5 else "barely moves over the week"
        fr, en = f"Le {c['contrat']}{lvl_fr} {mv_fr}.", f"{c['contrat']}{lvl_en} {mv_en}."
        if cal and sp and sp["value"] >= 1.8 * cal["value"]:
            fr = fr[:-1] + ", moitié moins que le spot : le marché ne reporte pas la tension d’aujourd’hui sur l’an prochain."
            en = en[:-1] + ", half the spot: the market does not carry today's tightness into next year."
        f.append(("cal", fr, en))
    for x in structural(edition["date"]) or []:
        if "hydraul" in x.get("sujet", ""):
            fr = "À surveiller : des réservoirs hydrauliques au plus bas pour la saison, donc moins de flexibilité pour les pointes d’hiver."
            f.append(("hydro", fr.replace(" ,", ","), "To watch: hydro reservoirs are well below normal, a record low for the season; less flexibility for winter peaks."))
    return f


def brief_from_facts(facts):
    """the brief written straight from the computed conclusions (no AI): the spot and why, gas, the year ahead, the signal"""
    order = ["spot", "coverage", "gas", "cal", "hydro"]
    pick = [x for k in order for x in facts if x[0] == k]
    return " ".join(x[1] for x in pick), " ".join(x[2] for x in pick)


def expert_brief(day):
    """the brief as the Expert view writes it (js/market-brief.js and js/morning.js, the same computed sentences, ported
    here so the newsletter says what the site says; the owner, 25 Nov. 2026): the spot, power (Cal against gas alone),
    weather over 4 weeks, nuclear, gas, carbon. Only figures: the AI-written context and week-ahead notes are left out."""
    H = os.path.join(ROOT, "data", "history")
    def load(*a):
        try:
            return json.load(open(os.path.join(*a)))
        except (OSError, ValueError):
            return None
    cs = load(H, "commodities_series.json") or {}
    S = cs.get("series") or {}
    P = lambda k: [tuple(x) for x in (S.get(k) or {}).get("points") or [] if x[1] is not None]  # noqa: E731
    def back(pts, n):
        if not pts:
            return None
        k = (date.fromisoformat(pts[-1][0]) - timedelta(days=n)).isoformat()
        v = None
        for d, x in pts:
            if d <= k:
                v = x
            else:
                break
        return v
    def wk(pts):
        b = back(pts, 7)
        return (pts[-1][1] / b - 1) * 100 if pts and b else None
    def pos60(pts):
        if not pts:
            return None, None
        k = (date.fromisoformat(pts[-1][0]) - timedelta(days=60)).isoformat()
        v = [x for d, x in pts if d >= k]
        if len(v) < 10:
            return None, None
        x, lo, hi = v[-1], min(v), max(v)
        r = (x - lo) / ((hi - lo) or 1)
        if x >= hi - 1e-9:
            return "au plus haut sur 60 jours", "at a 60-day high"
        if x <= lo + 1e-9:
            return "au plus bas sur 60 jours", "at a 60-day low"
        if r > 0.85:
            return "près du plus haut sur 60 jours", "near its 60-day high"
        if r < 0.15:
            return "près du plus bas sur 60 jours", "near its 60-day low"
        return None, None
    n = lambda v, d=1: fr_num(v, d)  # noqa: E731
    sg = lambda v, d=1: ("+" if v >= 0 else "−") + fr_num(abs(v), d)  # noqa: E731
    sge = lambda v, d=1: ("+" if v >= 0 else "−") + f"{abs(v):.{d}f}"  # noqa: E731
    FR, EN = [], []
    # the spot of the day, and its week
    dl = load(H, "daily", day + ".json") or {}
    sp = ((dl.get("zones") or {}).get("FR") or {}).get("avg")
    sm = load(H, "summary_fr.json") or load(H, "summary.json") or {}
    rows = [r for r in ((sm.get("zones") or {}).get("FR") or []) if r.get("avg") is not None and (r.get("d") or r.get("date") or "") < day]
    if isinstance(sp, (int, float)):
        prev = rows[-1]["avg"] if rows else None
        mv = (sp / prev - 1) * 100 if prev else None
        FR.append(f"Spot France à {n(sp, 0)} €/MWh pour aujourd’hui" + (f" ({sg(mv, 0)} % sur la veille)." if mv is not None and abs(mv) >= 1 else "."))
        EN.append(f"France spot at {sp:.0f} €/MWh for today" + (f" ({sge(mv, 0)} % on the day before)." if mv is not None and abs(mv) >= 1 else "."))
    # power: the next calendar year against what gas alone would add, the two following years, the spot's direction
    ch = load(H, "fr_market_calchain.json") or {}
    yrs = (ch.get("FR") or {}).get("years") or {}
    ys = sorted(yrs)[:3]
    if ys:
        pts = lambda y: [(d, v) for d, v in zip(yrs[y]["dates"], yrs[y]["values"]) if v is not None]  # noqa: E731
        p1 = pts(ys[0])
        w0 = back(p1, 7)
        dFR = p1[-1][1] - w0 if p1 and w0 is not None else None
        ty = ((cs.get("calYears") or {}).get("ttf") or {}).get(ys[0])
        tP = [(d, v) for d, v in zip(ty["dates"], ty["values"]) if v is not None] if ty else []
        gas = (tP[-1][1] - back(tP, 7)) * 2 if tP and back(tP, 7) is not None else None
        if gas is not None and dFR is not None:
            if abs(dFR - gas) < 1:
                r_fr, r_en = "le mouvement français vient du gaz.", "the French move comes from gas."
            elif dFR > gas:
                r_fr, r_en = "la France monte plus que le gaz seul (nucléaire, demande).", "France rises more than gas alone (nuclear, demand)."
            else:
                r_fr, r_en = "la France monte moins que le gaz seul (nucléaire et demande détendus).", "France rises less than gas alone (nuclear and demand relaxed)."
            FR.append(f"Sur le Cal {ys[0]} ({n(p1[-1][1], 0)} €/MWh), le gaz seul pèserait ≈ {sg(gas)} € sur la semaine : {r_fr}")
            EN.append(f"On Cal {ys[0]} ({p1[-1][1]:.0f} €/MWh), gas alone would weigh ≈ {sge(gas)} € on the week: {r_en}")
        if len(ys) > 1:
            w1, wl = wk(p1), [x for x in (wk(pts(y)) for y in ys[1:]) if x is not None]
            if wl and w1 is not None:
                if max(abs(x) for x in wl) < abs(w1) / 2:
                    FR.append(f"Les années {' et '.join(ys[1:])} bougent beaucoup moins."); EN.append(f"{' and '.join(ys[1:])} move much less.")
                else:
                    FR.append(f"Les années {' et '.join(ys[1:])} suivent."); EN.append(f"{' and '.join(ys[1:])} follow.")
        rw = [r for r in ((sm.get("zones") or {}).get("FR") or []) if r.get("avg") is not None and (r.get("d") or r.get("date") or "") <= day]
        a7, b7 = rw[-7:], rw[-14:-7]
        if len(a7) and len(b7):
            # as js/market-brief.js: the week at ±5 %, then the last three days when they move by 25 % or more
            m, mb = sum(r["avg"] for r in a7) / len(a7), sum(r["avg"] for r in b7) / len(b7)
            wp = (m / mb - 1) * 100
            l3 = (rw[-1]["avg"] / rw[-4]["avg"] - 1) * 100 if len(rw) > 3 and rw[-4]["avg"] else None
            d3f = "" if l3 is None or abs(l3) < 25 else (", en forte hausse depuis trois jours" if l3 > 0 else ", en forte baisse depuis trois jours")
            d3e = "" if l3 is None or abs(l3) < 25 else (", sharply up over the last three days" if l3 > 0 else ", sharply down over the last three days")
            if wp < -5:
                FR.append(f"Le spot recule sur la semaine ({sg(wp, 0)} %){d3f}."); EN.append(f"Spot eases over the week ({sge(wp, 0)} %){d3e}.")
            elif wp > 5:
                FR.append(f"Le spot monte sur la semaine ({sg(wp, 0)} %){d3f}."); EN.append(f"Spot rises over the week ({sge(wp, 0)} %){d3e}.")
            else:
                FR.append(f"Le spot reste stable sur la semaine{d3f}."); EN.append(f"Spot holds over the week{d3e}.")
    # weather, the next 4 weeks against normal (js/morning.js)
    wx = load(ROOT, "data", "weather_outlook.json") or {}
    F = ((wx.get("countries") or {}).get("FR") or {}).get("series") or {}
    if F.get("temp"):
        days, today = F["temp"]["days"], wx.get("today") or day
        i0 = next((i for i, d in enumerate(days) if d > today), -1)
        weeks = []
        for w in range(4):
            if i0 < 0:
                break
            ix = [i for i in range(len(days)) if i0 + w * 7 <= i < i0 + (w + 1) * 7]
            if not ix:
                break
            def avg(k, f):
                v = [F[k][f][i] for i in ix if F.get(k) and F[k].get(f) and i < len(F[k][f]) and F[k][f][i] is not None]
                return sum(v) / len(v) if v else None
            t, tn, wm, wn = avg("temp", "mean"), avg("temp", "normal"), avg("wind", "mean"), avg("wind", "normal")
            weeks.append({"dT": t - tn if t is not None and tn is not None else None, "wind": (wm / wn - 1) * 100 if wm is not None and wn else None})
        cold = sum(1 for w in weeks if w["dT"] is not None and w["dT"] < -1)
        calm = sum(1 for w in weeks if w["wind"] is not None and w["wind"] < -10)
        windy = sum(1 for w in weeks if w["wind"] is not None and w["wind"] > 10)
        if cold or calm:
            k = max(cold, calm)
            FR.append(("Plus froid" if cold else "Moins de vent") + (" et moins de vent" if cold and calm else "") + f" que la normale sur {k} semaine{'s' if k > 1 else ''} : plus de gaz brûlé, des prix en hausse.")
            EN.append(("Colder" if cold else "Calmer") + (" and calmer" if cold and calm else "") + f" than normal in {k} week{'s' if k > 1 else ''}: more gas burnt, higher prices.")
        elif windy:
            FR.append(f"Plus de vent que la normale sur {windy} semaine{'s' if windy > 1 else ''} : des prix plus bas, plus d’heures négatives à midi.")
            EN.append(f"Windier than normal in {windy} week{'s' if windy > 1 else ''}: lower prices, more negative hours at midday.")
    # French nuclear: available, against the operator's forecast
    nu, nf = P("fr_nuc_avail"), P("fr_nuc_avail_fc")
    if nu:
        nl = nu[-1][1]
        w, yb = back(nu, 7), back(nu, 365)
        fr = f"Nucléaire disponible {n(nl / 1000)} GW" + (f" ({sg((nl - w) / 1000)} GW sur la semaine" + (f", {sg((nl - yb) / 1000)} GW sur un an)" if yb is not None else ")") if w is not None else "") + "."
        en = f"Nuclear available {nl / 1000:.1f} GW" + (f" ({sge((nl - w) / 1000)} GW on the week" + (f", {sge((nl - yb) / 1000)} GW on a year)" if yb is not None else ")") if w is not None else "") + "."
        if nf:
            gap, f1 = nl - nf[-1][1], nf[-1][1] / 1000
            if abs(gap) < 1000:
                fr += f" En ligne avec la prévision de l’exploitant ({n(f1)} GW)."; en += f" In line with the operator's forecast ({f1:.1f} GW)."
            elif gap < 0:
                fr += f" {n(-gap / 1000)} GW sous la prévision de l’exploitant ({n(f1)} GW) : plus de gaz appelé, un soutien aux prix."
                en += f" {-gap / 1000:.1f} GW below the operator's forecast ({f1:.1f} GW): more gas called, a support for prices."
            else:
                fr += f" {n(gap / 1000)} GW au-dessus de la prévision de l’exploitant ({n(f1)} GW) : moins de gaz appelé, des prix détendus."
                en += f" {gap / 1000:.1f} GW above the operator's forecast ({f1:.1f} GW): less gas called, softer prices."
        FR.append(fr); EN.append(en)
    # gas: TTF against its 60 days, EU storage against a year ago
    ttf, ag = P("ttf"), P("agsi")
    if ttf:
        pf, pe = pos60(ttf)
        mv = wk(ttf)
        fr = f"Gaz TTF à {n(ttf[-1][1], 0)} €/MWh" + (f" ({sg(mv)} % sur 7 jours)" if mv is not None else "") + (f", {pf}" if pf else "") + "."
        en = f"TTF gas at {ttf[-1][1]:.0f} €/MWh" + (f" ({sge(mv)} % on 7 days)" if mv is not None else "") + (f", {pe}" if pe else "") + "."
        ly = back(ag, 365) if ag else None
        if ag and ly is not None:
            d = ag[-1][1] - ly
            fr += f" Stocks UE {sg(d)} pts sur un an" + (" : moins de marge pour l’hiver, un soutien aux prix." if d < 0 else " : marge confortable pour l’hiver.")
            en += f" EU storage {sge(d)} pts on a year" + (": less margin for winter, a support for prices." if d < 0 else ": comfortable margin for winter.")
        FR.append(fr); EN.append(en)
    # carbon: what the week's EUA move does to a gas plant's cost
    eua = P("eua")
    if eua:
        b = back(eua, 7)
        d = eua[-1][1] - (b if b is not None else eua[-1][1])
        if abs(d) >= 0.5:
            FR.append(f"Carbone : {sg(0.37 * d)} € sur le coût d’une centrale gaz sur la semaine (EUA à {n(eua[-1][1])} €/t).")
            EN.append(f"Carbon: {sge(0.37 * d)} € on a gas plant's cost over the week (EUA at {eua[-1][1]:.1f} €/t).")
    return " ".join(FR), " ".join(EN)


def prices_line(day):
    """the day's prices in one sentence (what the market context does not give): spot, Cal, gas, carbon"""
    H = os.path.join(ROOT, "data", "history")
    def load(*a):
        try:
            return json.load(open(os.path.join(*a)))
        except (OSError, ValueError):
            return None
    fr, en = [], []
    sp = (((load(H, "daily", day + ".json") or {}).get("zones") or {}).get("FR") or {}).get("avg")
    rows = [r for r in (((load(H, "summary_fr.json") or {}).get("zones") or {}).get("FR") or []) if r.get("avg") is not None and (r.get("d") or "") < day]
    if isinstance(sp, (int, float)):
        mv = (sp / rows[-1]["avg"] - 1) * 100 if rows else None
        fr.append(f"spot France {fr_num(sp, 0)} €/MWh" + (f" ({'+' if mv >= 0 else '−'}{fr_num(abs(mv), 0)} % sur la veille)" if mv is not None and abs(mv) >= 1 else ""))
        en.append(f"France spot {sp:.0f} €/MWh" + (f" ({'+' if mv >= 0 else '−'}{abs(mv):.0f} % on the day before)" if mv is not None and abs(mv) >= 1 else ""))
    yrs = ((load(H, "fr_market_calchain.json") or {}).get("FR") or {}).get("years") or {}
    if yrs:
        y = sorted(yrs)[0]
        v = [x for x in yrs[y]["values"] if x is not None]
        if v:
            fr.append(f"Cal {y[2:]} {fr_num(v[-1], 0)} €/MWh"); en.append(f"Cal {y[2:]} {v[-1]:.0f} €/MWh")
    S = (load(H, "commodities_series.json") or {}).get("series") or {}
    for k, lf, le, u in (("ttf", "gaz TTF", "TTF gas", "€/MWh"), ("eua", "CO₂", "CO₂", "€/t")):
        pts = [x for x in (S.get(k) or {}).get("points") or [] if x[1] is not None]
        if pts:
            k7 = (date.fromisoformat(pts[-1][0]) - timedelta(days=7)).isoformat()
            old = [x for d, x in pts if d <= k7]
            mv = (pts[-1][1] / old[-1] - 1) * 100 if old else None
            fr.append(f"{lf} {fr_num(pts[-1][1], 0)} {u}" + (f" ({'+' if mv >= 0 else '−'}{fr_num(abs(mv), 0)} % sur 7 jours)" if mv is not None and abs(mv) >= 1 else ""))
            en.append(f"{le} {pts[-1][1]:.0f} {u}" + (f" ({'+' if mv >= 0 else '−'}{abs(mv):.0f} % on 7 days)" if mv is not None and abs(mv) >= 1 else ""))
    if not fr:
        return "", ""
    return "Les prix du jour : " + ", ".join(fr) + ".", "Today's prices: " + ", ".join(en) + "."


# the sections of the newsletter's articles, as « Ce qui fait bouger le marché » on the site (the owner, 25 Nov. 2026)
SECTIONS = ["regulation", "markets", "nuclear_grid", "deals", "projects", "supply"]


def section_of(tags):
    t = set(tags or [])
    if t & {"regulation", "support", "official"}:
        return "regulation"
    if t & {"deal"}:
        return "deals"
    if t & {"build"}:
        return "projects"
    if t & {"gas", "markets", "geopolitics", "carbon"}:
        return "markets"
    if t & {"renewables"}:
        return "projects"
    return "supply"


def claude_articles(day, weekly, items):
    """the articles Claude chose this morning (data/newsletter_brief.json › articles / articles_week), as stories: the
    title, link and outlets from data/news.json, Claude's short description (« what ») and neutral impact (« for_you »)"""
    try:
        nb = json.load(open(os.path.join(ROOT, "data", "newsletter_brief.json")))
    except (OSError, ValueError):
        return []
    if nb.get("asof") != day:
        return []
    by = {i.get("link"): i for i in items}
    out = []
    for a in nb.get("articles_week" if weekly else "articles") or []:
        i = by.get(a.get("link")) if isinstance(a, dict) else None
        if not i or not a.get("what"):
            continue        # only articles of the feed, never a link the model made up
        tags = (i.get("tags") or []) + (["fr"] if "FR" in (i.get("countries") or []) and "fr" not in (i.get("tags") or []) else [])
        out.append({"id": sid(i), "title": i["title"], "link": i["link"], "tags": tags,
                    "section": a.get("section") if a.get("section") in SECTIONS else section_of(tags),
                    "sources": [i["source"]] + [o["source"] for o in i.get("other_sources") or []],
                    "free": [{"source": o["source"], "link": o["link"]} for o in i.get("free") or []] or None,
                    "report_link": i.get("report_link"), "report_name": i.get("report_name"),
                    "what": clip(a.get("what"), 360), "what_en": clip(a.get("what_en"), 360) or None,
                    "for_you": clip(a.get("impact"), 260) or None, "for_you_en": clip(a.get("impact_en"), 260) or None})
    return out


def claude_brief(day, weekly=False):
    """the newsletter brief Claude wrote this morning (data/newsletter_brief.json: {asof, daily, weekly}, each a list of
    {topic, topic_en, text, text_en}), « Prix : … Couverture : … » as one paragraph, when it is of the edition's day"""
    try:
        nb = json.load(open(os.path.join(ROOT, "data", "newsletter_brief.json")))
    except (OSError, ValueError):
        return "", ""
    if nb.get("asof") != day:
        return "", ""
    items = [c for c in (nb.get("weekly" if weekly else "daily") or []) if isinstance(c, dict) and c.get("text")]
    if not weekly:
        # the daily reads as one flowing text, without topic names (the owner, 25 Nov. 2026)
        return " ".join(c["text"].strip() for c in items), " ".join((c.get("text_en") or c["text"]).strip() for c in items)
    # the weekly: one paragraph per topic (the mail and the site split the brief on blank lines)
    fr = "\n\n".join((f"{c['topic']} : " if c.get("topic") else "") + c["text"].strip() for c in items)
    en = "\n\n".join((f"{c.get('topic_en') or c.get('topic')}: " if (c.get("topic_en") or c.get("topic")) else "") + (c.get("text_en") or c["text"]).strip() for c in items)
    return fr, en


def brief_from_context(day, abroad=False, weekly=False):
    """the brief taken from the site's market context (data/market_digest.json, the Expert view), when it is from the
    day of the edition or the day before: the same text the site shows, numbers rounded as one says them"""
    try:
        md = json.load(open(os.path.join(ROOT, "data", "market_digest.json")))
        if (date.fromisoformat(day) - date.fromisoformat(md["asof"])).days > 1:
            return "", ""
    except (OSError, ValueError, KeyError, TypeError):
        return "", ""
    def tidy(t, fr):
        # 47001,18 MW -> 47,0 GW: a capacity is read in GW
        def big(m):
            v = float(m.group(1).replace("\u202f", "").replace(" ", "").replace(",", ".") if fr else m.group(1).replace(",", ""))
            g = {"MW": ("GW", 1e3), "MWh": ("GWh", 1e3), "GWh": ("TWh", 1e3)}.get(m.group(2))
            if g and v >= 1000:
                v, unit = v / g[1], g[0]
            else:
                unit = m.group(2)
            t = f"{v:.1f}" if v < 100 else f"{v:,.0f}"
            return (t.replace(",", "\u202f").replace(".", ",") if fr else t) + " " + unit
        num = r"(\d[\d\u202f ]{3,}(?:,\d+)?|\d{4,}(?:,\d+)?)" if fr else r"(\d[\d,]{3,}(?:\.\d+)?)"
        return re.sub(num + r"\s?(MW|GW|MWh|GWh|TWh)\b", big, (t or "").strip())
    items = [c for c in (md.get("context_week") if weekly else None) or md.get("context") or [] if not abroad or (c.get("topic_en") or c.get("topic") or "").lower() != "france"]
    # « France : … Norvège : … » inside one paragraph read badly (the owner, 26 Nov. 2026): the daily is one flowing text
    # without the topic names, as Claude's (each text names its subject); the weekly keeps them, one paragraph per topic
    # (the mail and the site split the brief on blank lines and set the topic in bold)
    if not weekly:
        fr = " ".join(tidy(c.get("text"), True) for c in items if c.get("text"))
        en = " ".join(tidy(c.get("text_en") or c.get("text"), False) for c in items if c.get("text_en") or c.get("text"))
        return fr, en
    fr = "\n\n".join(f"{c.get('topic')} : " * bool(c.get("topic")) + tidy(c.get("text"), True) for c in items if c.get("text"))
    en = "\n\n".join(f"{c.get('topic_en') or c.get('topic')}: " * bool(c.get("topic_en") or c.get("topic")) + tidy(c.get("text_en") or c.get("text"), False) for c in items if c.get("text_en") or c.get("text"))
    return fr, en


def overlap(a, b, n=5):
    """the share of a's five-word runs that are in b: a text that copies its model or yesterday's"""
    w = lambda t: re.findall(r"\w+", (t or "").lower())  # noqa: E731
    A, B = w(a), w(b)
    ga = {tuple(A[i:i + n]) for i in range(len(A) - n + 1)}
    gb = {tuple(B[i:i + n]) for i in range(len(B) - n + 1)}
    return len(ga & gb) / len(ga) if ga else 0.0


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
    facts = key_facts(edition)
    payload = {"conclusions_du_jour": [x[1] for x in facts], "marchés": mk, "fondamentaux_france": trends_only(fundamentals(edition["date"])), "indice_powerklock": pk_index(edition["date"]), "ce_qui_a_bougé": what_moved(), "signaux_structurants": structural(edition["date"]), "contexte": ctx, "tendances_semaine": trend, "actualités_marché": news, "météo": " · ".join(filter(None, [(w.get("label") or [""])[0], (w.get("sub") or [""])[0]]))}
    msg = {"max_tokens": 900, "system": brief_system(), "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
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
    many = len(re.findall(r"(?<![\w-])\d+(?:[.,]\d+)?", re.sub(r"\b(19|20)\d\d\b", "", market_par))) > 5
    hollow = re.search(r"(?i)restent volatils|reste volatil|influenc[ée]s par (des|les) facteurs|il faut retenir que les prix|pousse les centrales", b or "")
    hollow = hollow or len((b or "").split()) > 115
    hollow = hollow or len(re.findall(r"(?i)\ben hausse\b", b or "")) > 3      # the same words again and again
    hollow = hollow or any(len(re.findall(rf"(?i)\b{w}\b", b or "")) > 2 for w in ("gaz", "prix", "hausse", "march[ée]", "[ée]lectricit[ée]"))
    hollow = hollow or "\n\n" in (b or "")                                                 # one paragraph: the market only
    if payload.get("fondamentaux_france"):                                                  # consumption and residual demand always said
        hollow = hollow or not (re.search(r"(?i)consommation", b or "") and re.search(r"(?i)demande r[ée]siduelle", b or ""))
    hollow = hollow or not re.search(r"(?i)\bcal", b or "")                                  # the year ahead says whether the move lasts
    # its own words: not the model text's, not yesterday's (the owner, 25 Nov. 2026: the same text every morning)
    try:
        ex = json.load(open(os.path.join(ROOT, "config", "brief_example.json"))).get("fr", "")
    except (OSError, ValueError):
        ex = ""
    hollow = hollow or overlap(b, ex) > 0.12 or overlap(b, PREV_BRIEF) > 0.25
    # the coverage verdict, never the opposite of the data: France covering itself and exporting is not « gas plants set the price »
    cv = next((x for x in facts if x[0] == "coverage"), None)
    if cv and "couvre encore" in cv[1]:
        hollow = hollow or not re.search(r"(?i)voisin|export", b or "") or re.search(r"(?i)centrales au gaz (françaises )?(qui )?fixent|appellent davantage de centrales", b or "")
    elif cv:
        hollow = hollow or not re.search(r"(?i)centrales? au gaz", b or "")
    if not b or many or hollow or not numbers_ok(b, given) or not direction_ok(b, edition.get("markets") or []):
        why = [k for k, v in (("empty", not b), ("figures", many), ("hollow", hollow), ("numbers", b and not numbers_ok(b, given)), ("direction", b and not direction_ok(b, edition.get("markets") or []))) if v]
        raise ValueError(f"brief rejected ({', '.join(why)}): {b!r}")   # a figure that was not given: better no brief
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
    return mid(rows[-1]), (mid(prev[-1]) if prev else None), rows[-1]["year"], rows[-1]["mail_date"][:10], (prev[-1]["mail_date"][:10] if prev else None)


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

    # each tile says the dates it compares (« 24/11 vs 17/11 »): the values are not all of the same day (today's spot,
    # yesterday's close, last week's GO quote), so « vs J-1 » would mislead (the owner, 27 Nov. 2026)
    def iso(d):
        return str(d)[:10] if d else None

    def row(fr, en, value, unit, ref=None, src="", page="markets/spot", show="pct", d=None, ref_d=None):
        # show: pct = change in %; abs = change in the unit (a spread); h = change in hours (more hours at 0 € or below
        # is lower prices, shown green like a fall)
        rows.append({"label": [fr, en], "value": round(value, 1 if show == "h" else 2), "unit": unit, "page": page, "src": src,
                     "show": show, "hours": show == "h", "chg": None if ref is None else round(value - ref, 2),
                     "pct": None if (not ref or show != "pct") else round((value / ref - 1) * 100, 1),
                     "d": iso(d), "ref_d": iso(ref_d) if ref is not None else None})
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
            row("Spot France aujourd'hui", "France spot today", t["base"], "€/MWh", y["base"] if y else None, "ENTSO-E", d=today, ref_d=today - timedelta(days=1))
        if t:
            row("Pointe − base aujourd'hui", "Peak − base today", t["peak"] - t["base"], "€/MWh", (y["peak"] - y["base"]) if y else None, "ENTSO-E", show="abs", d=today, ref_d=today - timedelta(days=1))
        if tm:
            row("Heures ≤ 0 € demain", "Hours ≤ 0 € tomorrow", tm["neg"], "h", t["neg"] if t else None, "ENTSO-E", "markets/spot/negative", show="h", d=today + timedelta(days=1), ref_d=today)
        elif t:
            row("Heures ≤ 0 € aujourd'hui", "Hours ≤ 0 € today", t["neg"], "h", y["neg"] if y else None, "ENTSO-E", "markets/spot/negative", show="h", d=today, ref_d=today - timedelta(days=1))
    ch = dload("history", "fr_market_calchain.json") or {}
    y1 = str(today.year + 1)
    cy = ((ch.get("FR") or {}).get("years") or {}).get(y1)
    if cy:
        a, b = back(list(zip(cy["dates"], cy["values"])), days)
        if a:
            row(f"Cal {y1[2:]} France", f"Cal {y1[2:]} France", a[1], "€/MWh", b[1], "EEX", "markets/forwards", d=a[0], ref_d=b[0])
    cs = (dload("history", "commodities_series.json") or {}).get("series") or (dload("commodities.json") or {}).get("series") or {}
    if "peg" in cs:
        a, b = back(cs["peg"]["points"], days)
        if a:
            row("Gaz PEG", "PEG gas", a[1], "€/MWh", b[1], "PowerKlock", "markets/fuels", d=a[0], ref_d=b[0])
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
        row("Garanties d'origine " + go[2], "Guarantees of origin " + go[2], go[0], "€/MWh", go[1], "Commerg", "markets/go", d=go[3], ref_d=go[4])
    return rows


# ── PowerBrunch v2 (the owner's mockup, 27 Nov. 2026): a market analysis like the desks', written by the morning task
# (newsletter_brief.json › brunch), with 2 or 3 charts it picks in the catalogue (scripts/news_charts.py) and the week's
# figures computed here, never by the model ──
def _week_bounds(today):
    """Monday: the week before (Monday to Sunday); another day (a test edition): this week's Monday to yesterday"""
    if today.weekday() == 0:
        end = today - timedelta(days=1)
        return end - timedelta(days=6), end
    return today - timedelta(days=today.weekday()), today - timedelta(days=1)


def _zone_week(start, end, zone, field="avg"):
    v = []
    d = start
    while d <= end:
        z = ((dload("history", "daily", d.isoformat() + ".json") or {}).get("zones") or {}).get(zone) or {}
        if z.get(field) is not None:
            v.append(z[field])
        d += timedelta(days=1)
    return v


def _close_on(points, day):
    """the last close on or before a day: (date, value) or None"""
    p = [(str(d)[:10], v) for d, v in points if v is not None and str(d)[:10] <= day.isoformat()]
    return p[-1] if p else None


def week_figures(today):
    """the week's figures (Monday to Sunday before the edition) against the week before: spot by zone (average of the
    published daily averages), forwards and commodities (the last close of each week)"""
    s1, e1 = _week_bounds(today)
    s0, e0 = s1 - timedelta(days=7), e1 - timedelta(days=7)      # the same days a week earlier
    rows = []

    def add(key, label, unit, a, b, kind="pct"):
        if a is None or b is None:
            return
        rows.append({"key": key, "label": label, "unit": unit, "value": round(a, 2), "prev": round(b, 2),
                     "chg": round(a - b, 2), "pct": round((a / b - 1) * 100, 1) if b and kind == "pct" else None})
    for key, label, zone in (("spot_fr", "Spot France base", "FR"), ("spot_de", "Spot Allemagne base", "DE_LU"), ("spot_es", "Spot Espagne base", "ES")):
        a, b = _zone_week(s1, e1, zone), _zone_week(s0, e0, zone)
        if len(a) >= 5 and len(b) >= 5:
            add(key, label, "€/MWh", sum(a) / len(a), sum(b) / len(b))
    pk = _zone_week(s1, e1, "FR", "peakAvg")
    if len(pk) >= 5:
        rows.append({"key": "peak_fr", "label": "Spot France pointe", "unit": "€/MWh", "value": round(sum(pk) / len(pk), 2)})
    ng = _zone_week(s1, e1, "FR", "negH")
    if ng:
        rows.append({"key": "neg_fr", "label": "Heures à 0 € ou moins en France", "unit": "h", "value": round(sum(ng), 2)})
    ch = ((dload("history", "fr_market_calchain.json") or {}).get("FR") or {}).get("years") or {}
    for k, y in ((1, str(today.year + 1)), (2, str(today.year + 2))):
        cy = ch.get(y)
        if cy:
            pts = list(zip(cy["dates"], cy["values"]))
            a, b = _close_on(pts, e1), _close_on(pts, e0)
            if a and b:
                add(f"cal{k}", f"Cal-{y[2:]} France", "€/MWh", a[1], b[1])
    cs = (dload("history", "commodities_series.json") or {}).get("series") or {}
    for key, label, unit, kind in (("ttf", "Gaz TTF", "€/MWh", "pct"), ("peg", "Gaz PEG", "€/MWh", "pct"), ("eua", "CO₂ EUA", "€/t", "pct"),
                                   ("brent", "Brent", "$/b", "pct"), ("agsi", "Stockages de gaz UE", "%", "pt")):
        pts = (cs.get(key) or {}).get("points") or []
        a, b = _close_on(pts, e1), _close_on(pts, e0)
        if a and b:
            add(key, label, unit, a[1], b[1], kind)
    # decision marks (the owner, 27 Nov. 2026: an analysis that helps decide without telling what to do): where the year-ahead
    # contracts and gas stand in their three-month range, and a year before
    ranges = []

    def rng(key, label, pts):
        p = [(str(d)[:10], v) for d, v in pts if v is not None and str(d)[:10] <= e1.isoformat()]
        w = [v for d, v in p if d >= (e1 - timedelta(days=92)).isoformat()]
        ago = [v for d, v in p if d <= (e1 - timedelta(days=365)).isoformat()]
        if len(w) >= 20:
            lo, hi = min(w), max(w)
            ranges.append({"key": key, "label": label, "last": round(w[-1], 2), "min": round(lo, 2), "max": round(hi, 2), "avg": round(sum(w) / len(w), 2),
                           "pos": round((w[-1] - lo) / (hi - lo) * 100) if hi > lo else 50, "year_ago": round(ago[-1], 2) if ago else None})
    for k, y in ((1, str(today.year + 1)), (2, str(today.year + 2))):
        cy = ch.get(y)
        if cy:
            rng(f"cal{k}", f"Cal-{y[2:]} France", list(zip(cy["dates"], cy["values"])))
    rng("ttf", "Gaz TTF", (cs.get("ttf") or {}).get("points") or [])
    return {"from": s1.isoformat(), "to": e1.isoformat(), "rows": rows, "ranges": ranges}


EURO_BARE = re.compile(r"(?<!\d[\u202f\u00a0 ])(?<![\d,.])(\d{1,3}(?:,\d+)?)\s?€(?![/\w])")   # a price, not an amount (« 29 000 € »)


def fix_units(t):
    """« 114 € » → « 114 €/MWh » (the owner, 27 Nov. 2026: the unit of a power or gas price is €/MWh, never €); a carbon
    price keeps €/t"""
    def rep(m):
        before = t[max(0, m.start() - 60):m.start()].lower()
        last = lambda rx: max([x.end() for x in re.finditer(rx, before)] or [-1])  # noqa: E731   the nearest word decides
        co2 = last(r"co₂|co2|quota|eua|carbone")
        return m.group(1).rstrip() + (" €/t" if co2 > last(r"\bcal|spot|ttf|peg|gaz|[ée]lectricit|terme|base|pointe|prix|contrat|mois|trimestre") else " €/MWh")
    return EURO_BARE.sub(rep, t or "")


def build_brunch(today, wb):
    """the morning task's analysis (wb › brunch), checked and cleaned, its charts drawn; None when it is missing"""
    b = wb.get("brunch") if isinstance(wb.get("brunch"), dict) else None
    if not b or not b.get("title") or not b.get("lead"):
        return None
    txt = lambda x, n=900: clip(fix_units(str(x or "")), n)  # noqa: E731
    paras = lambda xs: [txt(x, 1200) for x in (xs if isinstance(xs, list) else [xs]) if x][:4]  # noqa: E731
    out = {"title": txt(b["title"], 200), "lead": paras(b["lead"]), "sections": [], "charts_used": []}
    t = today.isoformat()
    for sec in (b.get("sections") or [])[:5]:
        if not isinstance(sec, dict) or not sec.get("text"):
            continue
        item = {"key": sec.get("key") or "", "kicker": clip(sec.get("kicker") or "", 60), "title": txt(sec.get("title"), 200), "text": paras(sec["text"]), "chart": None}
        cid = sec.get("chart")
        if cid in news_charts.CATALOGUE and cid not in out["charts_used"]:
            spec = news_charts.CATALOGUE[cid][1](today)
            if spec:
                path = os.path.join(news_charts.IMG, f"{t}_brunch_{cid}.png")
                news_charts.draw2(spec, path)
                item["chart"] = {"id": cid, "img": os.path.relpath(path, os.path.join(ROOT, "data")), "title": spec["title"], "src": spec["src"], "page": spec["page"]}
                out["charts_used"].append(cid)
        out["sections"].append(item)
    dk = b.get("desks") if isinstance(b.get("desks"), dict) else {}
    views = {d["desk"]: d for d in (dload("desk_views.json") or {}).get("desks") or []}
    theses = []
    for x in dk.get("theses") or []:
        if isinstance(x, dict) and x.get("desk") and x.get("text"):
            v = views.get(x["desk"]) or {}
            theses.append({"desk": clip(x["desk"], 40), "date": x.get("date") or v.get("date"), "link": v.get("link"),
                           "lean": x.get("lean") if x.get("lean") in ("up", "down", "flat") else None, "text": txt(x["text"], 300)})
    out["desks"] = {"title": txt(dk.get("title"), 200), "theses": theses[:6], "reading": txt(dk.get("reading"), 800)} if theses else None
    out["you"] = None      # no advice box (the owner, 27 Nov. 2026: « intrusif »)
    mk = b.get("marks") if isinstance(b.get("marks"), dict) else {}
    out["marks"] = {"title": txt(mk.get("title"), 200), "text": paras(mk.get("text")) if mk.get("text") else [],
                    "up": txt(mk.get("up"), 400), "down": txt(mk.get("down"), 400)} if mk.get("text") or mk.get("up") or mk.get("down") else None
    out["watch"] = [{"label": clip(x.get("label") or "", 60), "text": txt(x.get("text"), 300)} for x in (b.get("watch") or [])[:5] if isinstance(x, dict) and x.get("text")]
    out["facts"] = [{"label": clip(x.get("label") or "", 60), "text": txt(x.get("text"), 300)} for x in (b.get("facts") or [])[:3] if isinstance(x, dict) and x.get("text")]
    out["figures"] = week_figures(today)
    # which charts each edition used: the morning task reads it to change charts from week to week
    hist_p = os.path.join(ROOT, "data", "brunch_charts_used.json")
    try:
        hist = json.load(open(hist_p))
    except (OSError, ValueError):
        hist = {}
    hist[t] = out["charts_used"]
    with open(hist_p, "w") as fh:
        json.dump(dict(sorted(hist.items())[-12:]), fh, ensure_ascii=False, indent=1)
    news_charts.catalogue_file()
    return out


def pinned(now):
    """the story the admin put at the top in the last 36 hours (public.news_pin, warehouse migration 027), or None"""
    db = os.environ.get("SUPABASE_DB_URL")
    if not db:
        return None
    try:
        import psycopg
        with psycopg.connect(db, connect_timeout=15, prepare_threshold=None) as conn, conn.cursor() as cur:
            cur.execute("select link, note from public.news_pin where pinned_at >= %s order by pinned_at desc limit 1", (now - timedelta(hours=36),))
            r = cur.fetchone()
            return (r[0], r[1]) if r else None
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
    items = [i for i in (load(os.path.join(ROOT, "data", "news.json"), {}) or {}).get("items") or [] if not i.get("noai")]   # AleaSoft refuses AI use
    # the earlier editions (not today's, rebuilt): their articles stay out of this one; the brief must not repeat theirs
    global PREV_BRIEF
    hist = load(HIST, {}) or {}
    past = {d: v for d, v in (hist.get("days") or {}).items() if d < today.isoformat() and d >= (today - timedelta(days=10)).isoformat()}
    if not weekly:
        seen_links = {l for v in past.values() for l in v.get("links") or []}
        seen_titles = [t for v in past.values() for t in v.get("titles") or []]
        fresh = lambda i: i.get("link") not in seen_links and not any(similar(i.get("title", ""), t) for t in seen_titles)  # noqa: E731
        before = len(items)
        items = [i for i in items if fresh(i)]
        print(f"{before - len(items)} articles already in an earlier edition, left out")
        PREV_BRIEF = (past[max(past)].get("brief") or "") if past else ""
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
    if digest and not weekly:
        digest["items"] = [x for x in digest["items"] if fresh(x)]   # an essential already given yesterday is not given again
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
                  # an event with its one-line explanation and its source (data/events.json › text, source): « Arrêt aux prix
                  # négatifs dès 5 MW » alone meant nothing to a reader who does not follow it (the owner, 26 Nov. 2026)
                  + [{"date": e["date"], "kind": "event", "title": (e.get("title") or [""])[0], "title_en": (e.get("title") or ["", ""])[-1],
                      "text": (e.get("text") or [""])[0], "text_en": (e.get("text") or ["", ""])[-1],
                      "link": (e.get("source") or [None, None])[-1] if str((e.get("source") or [None, None])[-1] or "").startswith("http") else None,
                      "source": (e.get("source") or [None])[0]}
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
    pin_link, pin_note = pinned(now) or (None, None)
    pin = next((i for i in items if i.get("link") == pin_link), None) if pin_link else None   # items without the earlier editions' articles: a pin leads one edition only
    if pin and pin_note and len(pin.get("snippet") or "") < 40:
        pin = dict(pin, snippet=pin_note)       # the admin's line under a pinned title (paid papers give none)
    edition["pinned"] = pin_link if pin else None
    for pid, prof in profiles.items():
        stories = pick(items, prof, now, hours, 8)   # more stories, more subjects (the owner, 25 Nov. 2026)
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
        cl = claude_articles(edition["date"], weekly, items)
        if cl:
            # the articles Claude chose this morning (config/market_context_task.md): every section, a short description
            # and a neutral impact under each (the owner, 25 Nov. 2026); every profile gets them, each reader's order follows
            # their subjects (scripts/morning_mail.py › tailor)
            out = cl
        edition["profiles"][pid] = {"hero_chart": hero, "name": prof["name"], "short": prof["short"], "order": prof["order"], "headline": clip(gen.get("headline"), 300) or None, "headline_en": clip(gen.get("headline_en"), 300) or None,
                                    "stories": out, "ai": bool(by)}
        print(f"{pid}: {len(out)} stories, AI text for {len(by)}")
    edition["brief"] = edition["brief_en"] = None
    edition["brief_links"] = []
    # the brief Claude wrote this morning (config/market_context_task.md, data/newsletter_brief.json) when it is today's:
    # short and analytical for 7 O'Klock, complete for PowerBrunch (the owner, 25 Nov. 2026); the models below only when
    # it is missing. The Expert view's context (data/market_digest.json) is not touched.
    nb = claude_brief(edition["date"], weekly)
    if weekly:
        # PowerBrunch's top (scripts/morning_mail.py › brunch): the week in one sentence and the three things to remember,
        # when Claude wrote them this morning (week_title, week_text, week_keys); the mail computes them otherwise
        try:
            wb = json.load(open(os.path.join(ROOT, "data", "newsletter_brief.json")))
            if wb.get("asof") == edition["date"]:
                if wb.get("week_title"):
                    edition["week_line"] = {"title": clip(wb["week_title"], 160), "text": clip(wb.get("week_text") or "", 400)}
                edition["week_keys"] = [{"bold": clip(k.get("bold") or "", 80), "text": clip(k.get("text") or "", 300)} for k in (wb.get("week_keys") or [])[:3] if isinstance(k, dict) and k.get("text")]
                edition["brunch"] = build_brunch(today, wb)
        except (OSError, ValueError):
            pass
    if nb[0]:
        edition["brief"], edition["brief_en"] = nb
        edition["brief_auto"] = "claude"
        # « À lire » under the brief (the owner, 27 Nov. 2026): up to 3 articles of data/news.json that the text relies on,
        # chosen by Claude (newsletter_brief.json › links); a link the feed does not have is left out
        try:
            by = {i.get("link"): i for i in items}
            lk = (json.load(open(os.path.join(ROOT, "data", "newsletter_brief.json"))).get("links_week" if weekly else "links") or [])
            edition["brief_links"] = [{"title": by[l]["title"], "source": by[l]["source"], "link": l} for l in dict.fromkeys(lk) if l in by][:3]
        except (OSError, ValueError, AttributeError, TypeError):
            pass
        print("brief: written by Claude this morning")
    if not edition["brief"]:
        # then the Expert view's market context of the day (data/market_digest.json), before the free models (the owner, 25 Nov. 2026)
        cfr, cen = brief_from_context(edition["date"], weekly=weekly)
        if cfr:
            edition["brief"], edition["brief_en"], edition["brief_auto"] = cfr, cen, "context"
            print("brief: the Expert view's market context")
    if use_ai and edition["profiles"] and not edition["brief"]:
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
    if not edition["brief"]:
        # no AI text passed the checks: the brief is the Expert view's market context, as the site shows it (the owner,
        # 25 Nov. 2026), then the day's prices it leaves out (spot, Cal, gas, carbon), from our figures; the Expert view's
        # computed text when the context is missing or more than a day old
        cfr, cen = brief_from_context(edition["date"], weekly=weekly)
        if cfr:
            # the tiles of the e-mail give the prices: the context alone, short for the day, complete for the week
            edition["brief"], edition["brief_en"] = cfr, cen
        else:
            edition["brief"], edition["brief_en"] = expert_brief(edition["date"])
        if not edition["brief"]:
            edition["brief"], edition["brief_en"] = brief_from_facts(key_facts(edition))
        edition["brief_auto"] = True
        print("brief written from the market context and the day's prices")
    with open(out_path, "w") as f:
        json.dump(edition, f, ensure_ascii=False, indent=1)
    if not weekly:
        carried = [s_ for p_ in edition["profiles"].values() for s_ in p_.get("stories") or []] + (edition.get("top") or []) + ((edition.get("digest") or {}).get("items") or [])
        days = {d: v for d, v in (hist.get("days") or {}).items() if d >= (today - timedelta(days=10)).isoformat()}
        days[today.isoformat()] = {"links": sorted({x.get("link") for x in carried if x.get("link")}), "titles": sorted({x.get("title") for x in carried if x.get("title")}), "brief": edition.get("brief") or ""}
        with open(HIST, "w") as f:
            json.dump({"_about": "links, titles and brief of the last 10 editions of 7 O'Klock (scripts/news_letter.py): never twice the same article", "days": days}, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
