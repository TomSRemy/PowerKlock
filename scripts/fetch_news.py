#!/usr/bin/env python3
"""
Fetch energy-market news from public RSS/Atom feeds and write data/news.json.

Runs server-side (GitHub Actions) so the site needs no CORS proxy. Items are
stored as plain text (tags stripped, entities decoded); the frontend escapes
them again before rendering. Only http(s) links are kept.
"""
import html
import json
import math
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

OUT = Path("data/news.json")
PER_SOURCE = 15
MAX_ITEMS = 450   # about 50 outlets and 60 press searches: 300 pushed out articles only a few days old
UA = {"User-Agent": "Mozilla/5.0 (PowerKlock news fetcher; +https://github.com/TomSRemy/PowerKlock)"}

CONFIG = Path("config/news_sources.json")
GNEWS = "https://news.google.com/rss/search"
PER_SEARCH = 8
DILA_JORF = "https://echanges.dila.gouv.fr/OPENDATA/JORF/"
EU_SPARQL = "https://publications.europa.eu/webapi/rdf/sparql"
# energy texts in the Journal officiel (title or ministry) and in EUR-Lex (English title)
JO_KEEP = re.compile(r"électricit|énergie|énergétique|\bCRE\b|commission de régulation|gaz naturel|biométhane|nucléaire|renouvelable|photovolta|éolien|hydroélectri|stockage d'énergie|réseau public de (transport|distribution)|tarif d'achat|complément de rémunération|capacité|hydrogène|carburant|chaleur renouvelable", re.I)
JO_SKIP = re.compile(r"index nationaux du bâtiment|indice des prix|nomination|délégation de signature|avis de vacance|liste des emplois|tableau d'avancement|admission à la retraite|concours", re.I)
EU_KEEP = r"electricit|energy|natural gas|gas (market|storage|supply)|renewable|hydrogen (?!peroxide)|nuclear|ACER|emission allowance|emissions trading|allowances surrendered|greenhouse gas|fuels"


def load_config():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    # sources added from the site (public.news_source, warehouse migration 012), when the database is reachable
    db = os.environ.get("SUPABASE_DB_URL")
    if db:
        try:
            import psycopg
            with psycopg.connect(db, connect_timeout=15) as conn, conn.cursor() as cur:
                cur.execute("select kind, name, url, query, tags from public.news_source where active order by created_at")
                rows = cur.fetchall()
            known = {f["url"] for f in cfg.get("feeds", [])} | {x["q"] for x in cfg.get("searches", [])}
            for kind, name, url, query, tags in rows:
                if (url if kind == "feed" else query) in known:
                    continue
                if kind == "feed":
                    cfg.setdefault("feeds", []).append({"name": name, "cls": "added", "url": url, "tags": list(tags or []), "added": True})
                else:
                    cfg.setdefault("searches", []).append({"q": query, "tags": list(tags or []), "added": True})
            print(f"  {len(rows)} source(s) added from the site")
        except Exception as e:   # the news must not depend on the database
            print("  site sources not read:", str(e)[:160])
    return cfg


# Keyword tagging on title + summary (word-ish boundaries, case-insensitive).
KEYWORDS = {
    # what moves prices or the renewable business (English and French)
    # support for renewables: complément de rémunération, obligation d'achat, tenders, negative prices, curtailment (important, not first)
    "support": r"\b(?:[ée]chelonnement|moratoire|compl[ée]ments? de r[ée]mun[ée]ration|obligations? d.achat|contrats? d.achat|tarifs? d.achat|tarif de rachat|arr[êe]t[ée]s? tarifaires?|guichet ouvert|prix n[ée]gatifs?|heures? (à prix )?n[ée]gatives?|negative (power )?prices?|negative hours|[ée]cr[êe]tement|curtail\\w*|modulation (de (la )?production|à la baisse)|\\bs21\\b|contrats? (pour|de) diff[ée]rence|contracts? for difference|\\bcfds?\\b|m[ée]canismes? de soutien|dispositifs? de soutien|soutien (public )?aux (énergies |énergies renouvelables|renouvelables|enr)|renewable support|support scheme|feed-in (tariffs?|premiums?)|appels? d.offres? (de la )?(cre|ppe)|\\bao (ppe|cre)\\b|\\bppe ?[23]\\b|ench[èe]res? (renouvelables|enr)|renewable auctions?|edf oa\\b|\\boa\\b)",
    "geopolitics": r"\b(russia\w*|russie|ukrain\w*|gazprom|sanction\w*|iran\w*|israel\w*|middle east|moyen-orient|qatar\w*|strait|détroit|hormuz|ormuz|red sea|mer rouge|opec|opep|houthi\w*|war|guerre|conflict|conflit|attack\w*|attaque\w*|embargo|tariff war|trade war|blockade|blocus|geopolit\w*|géopolit\w*|norway outage|supply disruption|force majeure)\b",
    "deal": r"\b(acqui\w*|rachat|rachète|rachete|cède|cede|cession|cèdent|takeover|buys?|bought|sells?|sold|stake|participation|merger|fusion|divest\w*|portfolio sale|deal|transaction|refinanc\w*|financing|financement|lève|raises? \S+ (m|bn)|joint venture|coentreprise)\b",
    "build": r"\b(commission(ed|ing)|mise en service|mis en service|inaugur\w*|energi[sz]ed|connected to the grid|raccord\w*|groundbreaking|first stone|première pierre|construction start\w*|starts? construction|breaks ground|enters? (commercial )?operation|comes? online|COD\b|repowering|permis de construire|building permit|consent\w* granted|approved|autoris\w*)\b",

    "gas": r"\b(gas|gaz|lng|gnl|ttf|pipeline|gazoduc|regasification|regazéification|storage level|stockages? de gaz|nbp|peg|grtgaz|terega|biométhane|biomethane)\b",
    "carbon": r"\b(carbon|co2|ets|eua|emission|decarboni[sz]|net[- ]zero|climate)\b",
    "regulation": r"\b(regulat\w*|réglement\w*|directive|commission de régulation|commission européenne|european commission|acer|cre|network code|code de réseau|tarifs? réglementés?|trve|tarif d.achat|tarif d.utilisation|loi|décret|decree|arrêté|consultation publique|public consultation|ministère de l.(énergie|économie)|auction design|appel d'offres|tender|ppe\d?|arenh|vnu|turpe|accise|capacity mechanism|mécanisme de capacité|cfd|complément de rémunération|remit|ofgem|bundesnetzagentur)\b",
    "markets": r"\b(wholesale|prix de gros|marché de gros|trading|futures|forward|spot|day-ahead|intraday|ppas?|power purchase|prix (de l.électricité|du gaz|négatifs?)|negative prices?|power prices?|gas prices?|eex|epex|ttf|peg|cal(endar)? 2\d|baseload)\b",
    # reference reports: periodic studies, barometers, observatories, outlooks, residual mix
    # a published report, not any article with « report » in it (« -report » wire titles, « reported »): a report noun with
    # a publishing word or a publisher, or the named reference series
    "report": r"\b((publie|publient|publishes?|published|releases?|annual|annuel|nouveau|new|latest|dernier) (un |une |son |sa |its |a |the )?(rapport|report|étude|study)|(rapport|report|étude) (annuel|annual|de la CRE|de RTE|de l.ADEME|of the IEA|de l.AIE)|baromètres?|barometers?|observatoires?|panorama|bilan (électrique|prévisionnel)|bulletin trimestriel|(energy|electricity|gas) outlook|residual mix(es)?|mix résiduel|économie du système|[eé]clairage sur)\b",
    "power": r"\b(power (price|market|grid|plant|station|demand|supply)\w*|electricity|grid|nuclear|hydro|battery|batteries|bess|tso|électricité|(réseau|raccordement|mix|système|parc|production|consommation|demande) électrique|réseau (électrique|de transport|de distribution|public)|nucléaire|centrales? (nucléaire|électrique|à gaz|à charbon|solaire)\w*|batterie\w*|rte|enedis|edf)\b",
    # renewables: production, support schemes, PPAs, guarantees of origin, storage beside them (English and French)
    "renewables": r"\b(renewable\w*|renouvelable\w*|enr|solar|solaire\w*|photovolta\w*|pv|wind\w*|éolien\w*|offshore wind|agrivolta\w*|hydrogène vert|green hydrogen|hydroélectri\w*|ppas?|garanties? d.origine|guarantees? of origin|complément de rémunération|obligation d.achat|appel d.offres (cre|ppe\w*)|repowering|autoconsommation|self-consumption|agrégat\w*|aggregat\w*|capture (price|rate)|prix de capture|cannibali\w*)\b",
}


# which countries an article is about (title + summary)
COUNTRIES = {
    "FR": r"\b(france|french|français\w*|française\w*|edf|rte|cre|hexagon\w*|paris)\b",
    "DE": r"\b(german\w*|allemagne|allemand\w*|deutsch\w*|berlin|bundes\w*|rwe|eon|e\.on|enbw|uniper)\b",
    "ES": r"\b(spain|spanish|espagne|espagnol\w*|iberdrola|endesa|madrid)\b",
    "BE": r"\b(belgi\w*|elia|engie belgium|bruxelles|brussels)\b",
    "UK": r"\b(uk|britain|british|england|royaume-uni|ofgem|national grid)\b",
    "IT": r"\b(ital\w*|enel)\b",
    "NL": r"\b(netherlands|dutch|pays-bas|néerlandais\w*|tennet)\b",
    "EU": r"\b(eu|europe\w*|européen\w*|brussels|bruxelles|acer|entso-e|commission)\b",
}
# the subjects shown on the News page, most telling first (an article about a CfD tender is « Régulation » before « Électricité »)
TOPIC_ORDER = ["regulation", "support", "renewables", "markets", "gas", "deal", "build", "geopolitics", "carbon", "power"]
# how much a category moves prices or the renewable business; readers' votes add to it (data/news_prefs.json)
CAT_W = {"geopolitics": 3.0, "support": 2.5, "regulation": 2.0, "deal": 2.0, "build": 1.5, "gas": 1.5, "renewables": 1.5, "markets": 1.0, "carbon": 1.0, "power": 0.5}
PREFS = Path(__file__).resolve().parent.parent / "data" / "news_prefs.json"
STOP = set("the a an of to in on for and with at by from is are was were be as its it this that new over after into more than les des une un du de la le et en au aux pour par sur dans avec est sont qui que plus son ses leur".split())


def words(t):
    return [w for w in re.findall(r"[a-zà-ÿ0-9]+", (t or "").lower()) if len(w) > 3 and w not in STOP]


def followed(cfg_db, limit=30):
    """the readers' keywords (public.news_keyword, « ★ Mots-clés »): each becomes a press search, so a subject a reader
    follows is looked for across the press, not only in the outlets read; only the words, no reader identity"""
    if not cfg_db:
        return []
    try:
        import psycopg
        with psycopg.connect(cfg_db, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("select lower(trim(keyword)), count(*) from public.news_keyword where length(trim(keyword)) >= 3 group by 1 order by 2 desc, 1 limit %s", (limit,))
            return [k for k, _ in cur.fetchall()]
    except Exception as e:
        print("  followed keywords not read:", str(e)[:160])
        return []


def learn_prefs(cfg_db):
    """readers' votes (public.news_vote) → weights of sources, categories and title words (no reader identity kept)"""
    if not cfg_db:
        return None
    try:
        import psycopg
        with psycopg.connect(cfg_db, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("select title, source, tags, vote from public.news_vote")
            rows = cur.fetchall()
    except Exception as e:
        print("  votes not read:", str(e)[:160])
        return None
    agg = {"sources": {}, "cats": {}, "words": {}}
    for title, source, tags, vote in rows:
        for key, vals in (("sources", [source or ""]), ("cats", list(tags or [])), ("words", set(words(title)))):
            for v in vals:
                a = agg[key].setdefault(v, [0, 0]); a[0] += vote; a[1] += 1
    prefs = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "votes": len(rows),
             "method": "weight = sum of votes ÷ (votes + 3), per source, category and title word (words seen in 2 votes or more, strongest 80)"}
    for key in ("sources", "cats"):
        prefs[key] = {k: round(a[0] / (a[1] + 3), 3) for k, a in agg[key].items() if k}
    wl = [(k, a[0] / (a[1] + 3)) for k, a in agg["words"].items() if a[1] >= 2]
    prefs["words"] = {k: round(w, 3) for k, w in sorted(wl, key=lambda x: -abs(x[1]))[:80]}
    PREFS.write_text(json.dumps(prefs, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(rows)} reader votes learnt")
    return prefs


# The major yearly publications of the sector. An article that names one is tagged "major": a strong boost, no penalty
# for a world-wide subject, and every article on it within a week becomes ONE story, led by the publisher's own page
# (the real report) when it was collected. "hint": the words of outlets that report on it without naming it
# (« l'AIE prévient »), counted only when an article naming it is in the same week. "pages": where the report itself
# lives ({y}: its year, {q}: its quarter); the first that answers becomes the story's "report_link". "href": the address
# of the report itself, looked for first in the articles on it (outlets link to the report they write about).
MAJOR = [
    {"key": "weo", "href": r"iea\.org/reports/world-energy-outlook-20\d\d", "pages": ["https://www.iea.org/reports/world-energy-outlook-{y}", "~https://www.iea.org/topics/world-energy-outlook"], "name": "World Energy Outlook (IEA)", "pub": r"iea\.org|international energy agency",
     "re": r"world energy outlook|\bweo ?20\d\d|perspectives [ée]nerg[ée]tiques mondiales", "hint": r"\b(aie|iea|agence internationale de l.[ée]nergie|international energy agency)\b.{0,80}\b(pr[ée]vient|pr[ée]dit|projette|anticipe|warns?|predicts?|projects?|says|rapport annuel|annual report|sc[ée]narios?)"},
    {"key": "iea-electricity", "href": r"iea\.org/reports/electricity-(20\d\d|mid-year-update)", "pages": ["https://www.iea.org/reports/electricity-{y}"], "name": "Electricity (IEA)", "pub": r"iea\.org|international energy agency",
     "re": r"\b(iea|aie)\b.{0,40}\belectricity (20\d\d|mid-year update)|electricity mid-year update"},
    {"key": "iea-renewables", "href": r"iea\.org/reports/renewables-20\d\d", "pages": ["https://www.iea.org/reports/renewables-{y}"], "name": "Renewables (IEA)", "pub": r"iea\.org|international energy agency",
     "re": r"\b(iea|aie)\b.{0,40}\b(renewables 20\d\d|renouvelables 20\d\d)|^renewables 20\d\d"},
    {"key": "iea-gas", "href": r"iea\.org/reports/gas-market-report", "pages": ["https://www.iea.org/reports/gas-market-report-q{q}-{y}"], "name": "Gas Market Report (IEA)", "pub": r"iea\.org|international energy agency", "re": r"gas market report"},
    {"key": "rte-bp", "href": r"rte-france\.com/[^\s\"'<>]*bilan-previsionnel", "pages": ["https://www.rte-france.com/analyses-tendances-et-prospectives/bilan-previsionnel"], "name": "Bilan prévisionnel (RTE)", "pub": r"rte-france|\brte\b", "re": r"bilan pr[ée]visionnel"},
    {"key": "rte-be", "href": r"rte-france\.com/[^\s\"'<>]*bilan-electrique", "pages": ["https://analysesetdonnees.rte-france.com/bilan-electrique-synthese", "https://www.rte-france.com/analyses-tendances-et-prospectives/bilan-electrique"], "name": "Bilan électrique (RTE)", "pub": r"rte-france|\brte\b", "re": r"bilan [ée]lectrique"},
    {"key": "cre-surv", "href": r"cre\.fr/[^\s\"'<>]*surveillance", "pages": ["https://www.cre.fr/documents/rapports-et-etudes.html"], "name": "Surveillance des marchés de gros (CRE)", "pub": r"cre\.fr|\bcre\b",
     "re": r"(rapport de )?surveillance (du fonctionnement )?des march[ée]s de gros|wholesale market monitoring"},
    {"key": "acer-mmr", "href": r"acer\.europa\.eu/[^\s\"'<>]*(monitoring|mmr|market-monitoring)", "pages": ["https://www.acer.europa.eu/monitoring/MMR"], "name": "Market Monitoring Report (ACER)", "pub": r"acer\.europa|\bacer\b", "re": r"\bacer\b.{0,60}market monitoring report|market monitoring report.{0,60}\bacer\b"},
    {"key": "eraa", "href": r"entsoe\.eu/[^\s\"'<>]*eraa", "pages": ["https://www.entsoe.eu/outlooks/eraa/"], "name": "ERAA (ENTSO-E)", "pub": r"entsoe|entso-e", "re": r"\beraa\b|european resource adequacy assessment"},
    {"key": "ember-eer", "href": r"ember-energy\.org/[^\s\"'<>]*(european|global)-electricity-review", "pages": ["https://ember-energy.org/latest-insights/european-electricity-review-{y}/", "https://ember-energy.org/latest-insights/global-electricity-review-{y}/"], "name": "European Electricity Review (Ember)", "pub": r"ember", "re": r"european electricity review|global electricity review"},
    {"key": "irena-weto", "href": r"irena\.org/[^\s\"'<>]*world-energy-transitions-outlook", "pages": ["~https://www.irena.org/Energy-Transition/Outlook"], "name": "World Energy Transitions Outlook (IRENA)", "pub": r"irena", "re": r"world energy transitions outlook"},
    {"key": "eurelectric", "href": r"eurelectric\.org/[^\s\"'<>]*power-barometer", "name": "Power Barometer (Eurelectric)", "pub": r"eurelectric", "re": r"power barometer"},
]


_page_ok = {}
_robots = {}


def robots_ok(url):
    """this fetcher may read the page (the site's robots.txt; RFC 9309: a missing file allows, a server error does not)"""
    import urllib.robotparser
    from urllib.parse import urlparse
    host = "{0.scheme}://{0.netloc}".format(urlparse(url))
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = requests.get(host + "/robots.txt", headers=UA, timeout=10)
            rp.parse([] if 400 <= r.status_code < 500 else r.text.splitlines() if r.ok else ["User-agent: *", "Disallow: /"])
        except requests.RequestException:
            rp.parse(["User-agent: *", "Disallow: /"])
        _robots[host] = rp
    return _robots[host].can_fetch(UA["User-Agent"], url)


def report_from_articles(m, links, limit=6):
    """the report's own address, as the outlets writing about it link to it: their pages are read (robots.txt
    respected, paid outlets and Google News redirects skipped) and only the link to the report is kept"""
    if not m.get("href"):
        return None
    found = {}
    for u in [x for x in links if x and "news.google." not in x and not PAYWALL.search(x)][:limit]:
        try:
            if not robots_ok(u):
                continue
            h = requests.get(u, headers=UA, timeout=15).text[:800_000]
        except requests.RequestException:
            continue
        for href in re.findall(r'href="(https?://[^"#]+)"', h):
            if re.search(m["href"], href, re.I):
                href = html.unescape(href).split("?")[0].rstrip("/")
                found[href] = found.get(href, 0) + 1
    return max(found, key=lambda k: (found[k], -len(k))) if found else None   # the link most outlets give, the shortest on a tie


def report_page(m, when):
    """the publisher's page of the report: the first candidate (this year's, then last year's) that answers"""
    for y in (when.year, when.year - 1):
        for u in m.get("pages") or []:
            # "~": the publisher's stable page on the report (no year in it); its site refuses robots (403: IEA, IRENA),
            # which says the page is there; a year's own page must answer 200
            stable = u.startswith("~")
            u = u.lstrip("~").format(y=y, q=(when.month - 1) // 3 + 1)
            if u not in _page_ok:
                try:
                    r = requests.get(u, headers=UA, timeout=15, allow_redirects=True)
                    _page_ok[u] = r.status_code == 200 or (stable and r.status_code == 403)
                except Exception:
                    _page_ok[u] = False
            if _page_ok[u]:
                return u
    return None


def tag_major(out):
    """mark the articles on a major publication (rec["major"] = its key), before the scores are computed"""
    named = {}
    for rec in out:
        blob = (rec["title"] + " " + (rec.get("snippet") or "")).lower()
        for m in MAJOR:
            if re.search(m["re"], blob):
                rec["major"] = m["key"]
                named.setdefault(m["key"], []).append(datetime.fromisoformat(rec["date"]))
                break
    for rec in out:
        if rec.get("major"):
            continue
        blob = (rec["title"] + " " + (rec.get("snippet") or "")).lower()
        d = datetime.fromisoformat(rec["date"])
        for m in MAJOR:
            if m.get("hint") and m["key"] in named and re.search(m["hint"], blob) and any(abs((d - x).days) <= 7 for x in named[m["key"]]):
                rec["major"] = m["key"]
                break
    for rec in out:
        if rec.get("major"):
            rec["tags"] = list(dict.fromkeys(rec["tags"] + ["report", "major"]))


def group_major(out):
    """one story per major publication and week: the publisher's own page leads (the link to the real report), the
    outlets that reported on it go under other_sources"""
    by = {}
    for rec in out:
        if rec.get("major"):
            by.setdefault(rec["major"], []).append(rec)
    drop = set()
    for key, recs in by.items():
        m = next(x for x in MAJOR if x["key"] == key)
        recs.sort(key=lambda r: r["date"])
        while recs:                     # the articles of one week around the first one form one story
            first = datetime.fromisoformat(recs[0]["date"])
            week = [r for r in recs if (datetime.fromisoformat(r["date"]) - first).days <= 7]
            recs = [r for r in recs if r not in week]
            own = [r for r in week if re.search(m["pub"], (r["source"] + " " + r["link"]).lower())]
            primary = max(own or week, key=lambda r: (len(r.get("snippet") or "") > 40, r["impact"], r["date"]))
            others = [r for r in week if r is not primary]
            primary["report_name"] = m["name"]
            if primary in own and "news.google." not in primary["link"]:
                primary["report_link"] = primary["link"]     # the publisher's own page: the report itself
            else:
                links = [r["link"] for r in week] + [o["link"] for r in week for o in r.get("other_sources") or []]
                primary["report_link"] = report_from_articles(m, links) or report_page(m, datetime.fromisoformat(primary["date"]))
            if not others:
                continue
            if len(primary.get("snippet") or "") < 40:      # the publisher's page often comes without an extract
                best = max(others, key=lambda r: len(r.get("snippet") or ""))
                primary["snippet"] = best.get("snippet") or primary.get("snippet") or ""
            primary["tags"] = list(dict.fromkeys(primary["tags"] + [t for r in others for t in r["tags"]]))
            primary["topics"] = sorted(set(primary.get("topics") or []) | {t for r in others for t in r.get("topics") or []}, key=TOPIC_ORDER.index)
            primary["countries"] = list(dict.fromkeys(primary["countries"] + [c for r in others for c in r["countries"]]))
            seen = {primary["link"]}
            os_ = []
            for r in others:
                for o in [{"source": r["source"], "link": r["link"], "cls": r.get("cls", "")}] + list(r.get("other_sources") or []):
                    if o["link"] not in seen:
                        seen.add(o["link"]); os_.append({"source": o["source"], "link": o["link"], "cls": o.get("cls", "")})
                drop.add(id(r))
            primary["other_sources"] = list(primary.get("other_sources") or []) + [o for o in os_ if o["link"] not in {x["link"] for x in primary.get("other_sources") or []}]
            primary["impact"] = round(max(r["impact"] for r in week) + 0.9 * math.log2(1 + len(primary["other_sources"])), 2)
    return [r for r in out if id(r) not in drop]


# a followed keyword is searched with energy words, and an article is kept only when it or its outlet is about energy
ENERGY_Q = "énergie OR électricité OR électrique OR photovoltaïque OR solaire OR éolien OR CRE OR gaz OR tarif OR raccordement"
ENERGY_OUTLET = r"green|watt|power|renew|environ|[ée]nergi|energy|solar|solaire|wind|[ée]olien|\bgaz\b|[ée]lectri|smartgrid|montel|contexte"
ENERGY_RE = r"[ée]nergi|[ée]lectri|photovolta|solaire|[ée]olien|\bcre\b|\bgaz\b|tarif|raccordement|\brte\b|enedis|nucl[ée]aire|hydro|batter|stockage|ppa\b|\bppe\b|biom[ée]thane|r[ée]seau"

def load_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def impact(rec, prefs):
    """market impact score of an article: its categories, plus what readers liked or not"""
    tags = rec["tags"]
    ws = sorted((CAT_W[t] for t in tags if t in CAT_W), reverse=True)
    s = (ws[0] + 0.5 * sum(ws[1:])) if ws else 0.0          # the strongest category, the others at half weight
    if "official" in tags:
        s += 1.0                                   # an energy text in the Journal officiel, EUR-Lex or from the CRE: on topic by construction
    elif not any(t in tags for t in ("power", "gas", "carbon", "markets", "geopolitics")):
        s -= 1.5                                   # off-topic for an energy market reader
    if rec.get("major"):
        s += 4.0                                   # a major yearly publication of the sector (MAJOR): not to be missed
    cs = rec.get("countries", [])
    s += 1.0 if rec.get("major") and not cs else 1.5 if "FR" in cs else 1.0 if any(c in cs for c in ("EU", "DE", "BE", "ES", "NL", "IT", "UK")) else (0 if "geopolitics" in tags else -1.0)   # the European market first
    s += 2.0 * prefs.get("sources", {}).get(rec["source"], 0)
    s += sum(prefs.get("cats", {}).get(t, 0) for t in tags)
    s += max(-3.0, min(3.0, sum(prefs.get("words", {}).get(w, 0) for w in set(words(rec["title"])))))
    return round(s, 2)


def text_of(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def clean(s, limit=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            # Drupal feeds (ACER): "Fri, 11/20/2026 - 15:03", month first, Brussels time
            m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2}))?", s)
            if not m:
                return None
            from zoneinfo import ZoneInfo
            mo, dd, y, hh, mi = (int(x) if x else 0 for x in m.groups())
            d = datetime(y, mo, dd, hh, mi, tzinfo=ZoneInfo("Europe/Brussels"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for el in root.iter():
        name = local(el.tag)
        if name not in ("item", "entry"):
            continue
        f = {local(c.tag): c for c in el}
        link = ""
        if "link" in f:
            link = f["link"].get("href") or text_of(f["link"])
        for c in el:
            if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate" and c.get("href"):
                link = c.get("href")
                break
        date = None
        for k in ("pubDate", "published", "updated", "date"):
            if k in f:
                date = parse_date(text_of(f[k]))
                if date:
                    break
        summary = text_of(f.get("description")) or text_of(f.get("summary")) or text_of(f.get("encoded"))
        items.append({"title": clean(text_of(f.get("title")), 220), "link": link.strip(),
                      "date": date, "snippet": clean(summary, 240)})
    return items


BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8"}


def read_feed(url, r):
    """A feed; when the address gives a web page instead: the feed the page announces (<link rel="alternate">),
    else one more try as a browser (some sites serve a bot check to automated readers)."""
    try:
        return parse_feed(r.content)
    except ET.ParseError:
        page = r.content.decode("utf-8", "ignore")
        if "<html" not in page[:2000].lower():
            raise
    m = re.search(r'<link[^>]+type="application/(?:rss|atom)\+xml"[^>]*>', page, re.I)
    href = re.search(r'href="([^"]+)"', m.group(0)) if m else None
    if href:
        r2 = requests.get(urljoin(url, html.unescape(href.group(1))), headers=UA, timeout=25)
        r2.raise_for_status()
        return parse_feed(r2.content)
    r3 = requests.get(url, headers=BROWSER_UA, timeout=25)
    r3.raise_for_status()
    try:
        return parse_feed(r3.content)
    except ET.ParseError:
        raise ValueError("the address gives a web page, not a feed (or a bot check for automated readers)")


def read_cre(content):
    """CRE news listing (no RSS): title, link and publication time of each card."""
    s = content.decode("utf-8", "ignore")
    out = []
    for url, title, when in re.findall(r'data-document-url="([^"]+)".*?<h3[^>]*>\s*<a[^>]*>(.*?)</a>.*?<time datetime="([^"]+)"', s, re.S):
        out.append({"title": clean(title, 220), "link": "https://www.cre.fr" + url if url.startswith("/") else url,
                    "date": parse_date(when), "snippet": ""})
    return out


def read_cre_consultations(content):
    """CRE consultations publiques listing (no RSS): title, link, status label and document date of each card."""
    s = content.decode("utf-8", "ignore")
    out = []
    for url, title, status, when in re.findall(
            r'data-document-url="([^"]+)".*?<h3[^>]*>\s*<a[^>]*>(.*?)</a>.*?<span class="label[^"]*">([^<]*)</span>.*?<time datetime="([^"]+)"',
            s, re.S):
        out.append({"title": clean(title, 220), "link": "https://www.cre.fr" + url if url.startswith("/") else url,
                    "date": parse_date(when), "snippet": clean(status, 60)})
    return out


READERS = {"cre": read_cre, "cre_consultations": read_cre_consultations}


def gnews(q, lang="fr"):
    """Press search over the last 7 days (Google News RSS: titles and links only, no article text is kept)."""
    loc = {"fr": dict(hl="fr", gl="FR", ceid="FR:fr"), "en": dict(hl="en-GB", gl="GB", ceid="GB:en")}[lang]
    for wait in (0, 20, 45):     # Google throttles bursts: wait and try again
        time.sleep(wait)
        r = requests.get(GNEWS, params=dict(q=q + " when:7d", **loc), headers=UA, timeout=25)
        if r.status_code != 429:
            break
    r.raise_for_status()
    items = []
    for el in ET.fromstring(r.content).iter("item"):
        src = el.find("source")
        name = (src.text or "").strip() if src is not None else ""
        if name.startswith("http"):   # some outlets have no name in the feed: their site instead
            name = urlparse(name).netloc.removeprefix("www.")
        title = clean(el.findtext("title"), 300)
        if name and title.endswith(" - " + name):      # Google appends " - Outlet" to every title
            title = title[: -len(name) - 3]
        items.append({"title": clean(title, 220), "link": (el.findtext("link") or "").strip(), "date": parse_date(el.findtext("pubDate")),
                      "snippet": "", "domain": name or "Google News"})
    return items


def jorf(days=7):
    """Energy texts of the Journal officiel (DILA open data, Licence Ouverte): the daily archives of the last days."""
    import io
    import tarfile
    listing = requests.get(DILA_JORF, headers=UA, timeout=30).text
    since = (datetime.now(timezone.utc).date().toordinal() - days)
    names = [n for n in sorted(set(re.findall(r'href="(JORF_(\d{8})-\d+\.tar\.gz)"', listing)))
             if datetime.strptime(n[1], "%Y%m%d").date().toordinal() >= since]
    items, seen = [], set()
    for name, _ in names:
        r = requests.get(DILA_JORF + name, headers=UA, timeout=60)
        r.raise_for_status()
        with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as tar:
            for m in tar.getmembers():
                if not (m.isfile() and "/texte/version/" in m.name and m.name.endswith(".xml")):
                    continue
                root = ET.fromstring(tar.extractfile(m).read())
                tid = root.findtext(".//ID") or ""
                title = clean(text_of(root.find(".//TITREFULL")), 400)
                ministry = clean(root.findtext(".//MINISTERE"))
                published = parse_date(root.findtext(".//DATE_PUBLI"))
                if (not tid.startswith("JORFTEXT") or tid in seen or not published or published.date().toordinal() < since
                        or JO_SKIP.search(title) or not JO_KEEP.search(title)):   # the title: the ministry of the economy also signs everything else
                    continue
                seen.add(tid)
                nature = (root.findtext(".//NATURE") or "").capitalize()
                items.append({"title": clean(title, 220), "link": "https://www.legifrance.gouv.fr/jorf/id/" + tid,
                              "date": published,
                              "snippet": " · ".join(x for x in (nature, ministry, clean(root.findtext(".//ORIGINE_PUBLI"))) if x)})
    return items


def eurlex(days=30):
    """EU acts on energy published in the last days (EUR-Lex / Cellar SPARQL, free reuse): French title when there is one."""
    since = datetime.fromordinal(datetime.now(timezone.utc).date().toordinal() - days).strftime("%Y-%m-%d")
    q = f"""PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?date ?en ?fr WHERE {{
  ?work cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date .
  ?e cdm:expression_belongs_to_work ?work ; cdm:expression_title ?en ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> .
  OPTIONAL {{ ?f cdm:expression_belongs_to_work ?work ; cdm:expression_title ?fr ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/FRA> . }}
  FILTER(?date >= "{since}"^^xsd:date) FILTER(REGEX(?celex, "^3")) FILTER(REGEX(?en, "{EU_KEEP}", "i")) FILTER(!REGEX(?en, "biocid|plant protection|food|feed additive|harmonised standards|statement of revenue|Joint Committee|corrigendum|correcting certain language|excise duty|safeguard measure|2024/573|fluorinated", "i"))
}} ORDER BY DESC(?date) LIMIT 40"""
    r = requests.get(EU_SPARQL, params={"query": q}, headers=dict(UA, Accept="application/sparql-results+json"), timeout=60)
    r.raise_for_status()
    items, seen = [], set()
    for b in r.json()["results"]["bindings"]:
        celex = b["celex"]["value"]
        if celex in seen:
            continue
        seen.add(celex)
        title = (b.get("fr") or b["en"])["value"]
        items.append({"title": clean(title, 220), "link": "https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:" + celex,
                      "date": parse_date(b["date"]["value"] + "T12:00:00+00:00"), "snippet": "CELEX " + celex})
    return items


CONSULT = Path("data/consultations.json")
MIN_ENERGY = "https://www.consultations-publiques.developpement-durable.gouv.fr/"


# theme of a consultation from its title, the first that matches (energy savings first: their titles also say « tarif »)
CONS_THEMES = [
    ("support", r"[ée]chelonnement|compl[ée]ments? de r[ée]mun[ée]ration|obligations? d.achat|contrats? d.achat|tarifs? d.achat|arr[êe]t[ée]s? tarifaires?|guichet ouvert|prix n[ée]gatifs?|[ée]cr[êe]tement|\bS21\b|m[ée]canismes? de soutien|dispositifs? de soutien"),
    ("cee", r"certificats? d.économies d.énergie|\bCEE\b|fiches? d.opérations? standardisées?|bonification|audit énergétique|précarité énergétique|programme PRO-"),
    ("tariffs", r"TURPE|ATR[DT]|\btarifs?\b|TRVE|péréquation|\bFPE\b|CRCP|dotation|prestations annexes"),
    ("grid", r"raccordement|ligne électrique|poste électrique|liaison|réseau public|\bRP[DT]\b|accès au réseau|SDDR|interconnexion|gestionnaires? de réseau|contrat d.accès|schéma décennal"),
    ("renewables", r"appel d.offres|\bAO\b|\bPPE\d?\b|photovolta|éolien|biométhane|biogaz|hydrogène|complément de rémunération|garanties d.origine|renouvelable"),
    ("market", r"capacité|équilibre|réserves?|marché|enchères?|ARENH|parc nucléaire|production nucléaire|hydroélectri|flexibilit|effacement|stockage"),
    ("gas", r"\bgaz\b|GRTgaz|Teréga|NaTran|GRDF|méthane"),
]


def cons_theme(title):
    for key, rx in CONS_THEMES:
        if re.search(rx, title, re.I):
            return key
    return "other"


FR_MONTHS = {"janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "août": 8, "aout": 8,
             "septembre": 9, "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12}
FR_DATE = r"(\d{1,2})(?:er)?\s+(" + "|".join(FR_MONTHS) + r")(?:\s+(\d{4}))?"


def rte_consultations(now, days=75):
    """RTE's public consultations and concertations (grid projects, offshore connections, regional schemes): the site's
    sitemap gives each page and its last change; the page gives the end date, from its title (« du 17 août au 28
    septembre ») or else the first « jusqu'au … » of its text. Results and reviews of past concertations are left out."""
    sm = requests.get("https://www.rte-france.com/sitemap.xml", headers=BROWSER_UA, timeout=30).text
    since = datetime.fromordinal(now.date().toordinal() - days).strftime("%Y-%m-%d")
    out = []
    for loc, lastmod in re.findall(r"<loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>", sm):
        slug = loc.rsplit("/", 1)[-1]
        if lastmod[:10] < since or not re.search(r"concertation|consultation|enquete-publique|participez|contribution", slug) \
                or re.search(r"bilan|avis|resultat|instance|reunion|carrieres|garant|/formulaire-concertation/", loc):   # forms repeat the news page
            continue
        page = html.unescape(requests.get(loc, headers=BROWSER_UA, timeout=30).text)
        title = re.sub(r"\s*\|\s*RTE\s*$", "", clean((re.findall(r"<title>(.*?)</title>", page, re.S) or [""])[0]))
        text = clean(re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S))

        def iso(m, year=None):
            return f"{m.group(3) or year or now.year}-{FR_MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
        m = (re.search(r"\bau\s+" + FR_DATE, title, re.I) or re.search(r"\bdu\s+" + FR_DATE + r"\s+au\s+" + FR_DATE, text, re.I)
             or re.search(r"(?:jusqu.au|avant le|prendra fin le|se termine le)\s+(?:\w+\s+)?" + FR_DATE, text, re.I))
        if m and m.re.pattern.startswith("\\bdu"):     # « du 1er octobre au 22 novembre 2026 »: the end date is the second
            m = re.search(FR_DATE + r"\s*$", m.group(0), re.I)
        out.append({"source": "RTE", "title": clean(title, 260), "link": loc, "opened": lastmod[:10], "deadline": iso(m) if m else None})
    return out


def consultations(now):
    """Public consultations with their deadline: the CRE (listing, then the deadline written on each open consultation's
    page) and the ministry's « Énergies et climat » consultations (period on the listing, two pages). Both sites have no
    feed with the dates; their listings are official pages republished in the same form."""
    out, errors = [], []
    try:
        s = requests.get("https://www.cre.fr/documents/consultations-publiques.html", headers=BROWSER_UA, timeout=30).text
        for url, title, status, when in re.findall(r'data-document-url="([^"]+)".*?<h3[^>]*>\s*<a[^>]*>(.*?)</a>.*?<span class="label[^"]*">([^<]*)</span>.*?<time datetime="([^"]+)"', s, re.S):
            if "cours" not in status.lower():
                continue
            link = "https://www.cre.fr" + url if url.startswith("/") else url
            page = html.unescape(requests.get(link, headers=BROWSER_UA, timeout=30).text)
            m = re.search(r"Date limite de dépôt des réponses\W*(?:<[^>]+>\W*)*(\d{2})/(\d{2})/(\d{4})", page)
            out.append({"source": "CRE", "title": clean(title, 260), "link": link, "opened": (parse_date(when) or now).date().isoformat(),
                        "deadline": f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None})
    except Exception as e:
        errors.append("CRE: " + str(e)[:100])
    try:
        for start in (0, 8):
            s = html.unescape(requests.get(MIN_ENERGY + "energies-et-climat-r4.html" + (f"?debut_listearticles={start}" if start else ""), headers=BROWSER_UA, timeout=30).text)
            for url, title, a, b in re.findall(r'<a href="([^"]+a\d+\.html)" class="fr-card__link">(.*?)</a>.*?Consultation du (\d{2}/\d{2}/\d{4}) au (\d{2}/\d{2}/\d{4})', s, re.S):
                iso = lambda d: "-".join(reversed(d.split("/")))
                out.append({"source": "Ministère · Énergies et climat", "title": clean(title, 260), "link": urljoin(MIN_ENERGY, url),
                            "opened": iso(a), "deadline": iso(b)})
    except Exception as e:
        errors.append("ministry: " + str(e)[:100])
    try:
        out += rte_consultations(now)
    except Exception as e:
        errors.append("RTE: " + str(e)[:100])
    today = now.astimezone(timezone.utc).date().isoformat()
    seen, keep = set(), []
    for c in out:
        if c["link"] in seen:
            continue
        seen.add(c["link"])
        c["open"] = c["deadline"] >= today if c["deadline"] else c["opened"] >= datetime.fromordinal(now.date().toordinal() - 45).strftime("%Y-%m-%d")
        c["theme"] = cons_theme(c["title"])
        keep.append(c)
    keep.sort(key=lambda c: (not c["open"], c["deadline"] or "9999"))
    return keep, errors


def rte_news(now, days=14):
    """RTE's national publications (reports, market and grid analyses, press releases) from its dated sitemap; local
    works news (worksites, roads, archaeology, drills) are left out. One page read per item, for its title."""
    sm = requests.get("https://www.rte-france.com/sitemap.xml", headers=BROWSER_UA, timeout=30).text
    since = datetime.fromordinal(now.date().toordinal() - days).strftime("%Y-%m-%d")
    keep = re.compile(r"rapport|panorama|observatoire|marche|prix|bilan|barometre|consommation|production|hiver|ete-|ecowatt|nucleaire|interconnex|flexibilit|stockage|"
                      r"raccordement|previsionnel|futurs|analyse|equilibre|capacite|europe|record|export|negatif|tarif|investiss|obligataire|schema|surete", re.I)
    skip = re.compile(r"travaux|chantier|archeolog|pompier|plage|riverain|route|circulation|deviation|formation|recrut|carrieres|concertation|enquete", re.I)
    items = []
    for loc, lastmod in re.findall(r"<loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>", sm):
        path = loc.replace("https://www.rte-france.com", "")
        if lastmod[:10] < since or not path.startswith(("/actualites/", "/donnees-publications/")) or skip.search(path) \
                or not (path.startswith("/donnees-publications/") or keep.search(path)):
            continue
        page = requests.get(loc, headers=BROWSER_UA, timeout=30).text
        title = re.sub(r"\s*\|\s*RTE\s*$", "", clean(html.unescape((re.findall(r"<title>(.*?)</title>", page, re.S) or [""])[0])))
        desc = clean(html.unescape((re.findall(r'<meta name="description" content="([^"]*)"', page) or [""])[0]), 240)
        if title:
            items.append({"title": clean(title, 220), "link": loc, "date": parse_date(lastmod.replace("Z", ":00+00:00")), "snippet": desc})
    return items


def eex_news(now):
    """EEX newsroom (press releases and customer information on power, gas, guarantees of origin, ETS): the data alerts
    and technical notices of the exchange are left out."""
    s = html.unescape(requests.get("https://www.eex.com/en/newsroom/news", headers=BROWSER_UA, timeout=30).text)
    items = []
    for d, title, href in re.findall(r'<time itemprop="datePublished" datetime="([^"]+)">.*?<a title="([^"]+)" href="([^"]+)"', s, re.S):
        if re.search(r"data alert|data amendment|reminder|T7|C7|datasource|maintenance|trading calendar|holiday", title, re.I):
            continue
        if not re.search(r"press release|guarantee|origin|\bGOs?\b|auction|french|france|power|electricity|gas|ETS|emission|PPA|capacity|renewable|volumes", title, re.I):
            continue
        items.append({"title": clean(title, 220), "link": urljoin("https://www.eex.com", href), "date": parse_date(d + "T12:00:00+00:00"), "snippet": ""})
    return items


MODO_SITEMAP = "https://modoenergy.com/research/sitemap.xml"
MODO_CACHE = Path("data/news_modo.json")
# Modo Energy's research articles about France and the rest of Europe (their slug names the market); US, Australian and
# other markets are left out. robots.txt allows every reader; their terms forbid copying or framing the content, so only
# the title (from the page's <title>) and the link are kept, as for every outlet.
MODO_EUROPE = re.compile(r"france|french|europe|european|germany|german|spain|spanish|iberia|italy|italian|belgium|belgian|netherlands|dutch|"
                         r"nordic|poland|polish|austria|switzerland|swiss|\bgb\b|great-britain|britain|entso|\beu\b", re.I)


def modo_news(now, days=21, max_pages=12):
    """Modo Energy research: the research sitemap (every article with its last change), the French version of each recent
    European article; the page is read once for its title and publication date (cached in data/news_modo.json)."""
    try:
        cache = json.loads(MODO_CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    r = requests.get(MODO_SITEMAP, headers=UA, timeout=40)
    r.raise_for_status()
    since = (now - timedelta(days=days)).isoformat()
    recent = []
    for loc, mod in re.findall(r"<loc>(https://modoenergy\.com/research/fr/[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", r.text):
        slug = loc.rsplit("/", 1)[-1]
        if mod >= since and MODO_EUROPE.search(slug.replace("-", " ")):
            recent.append((mod, loc))
    items, fetched = [], 0
    for mod, loc in sorted(recent, reverse=True):
        c = cache.get(loc)
        if not c and fetched < max_pages:
            fetched += 1
            time.sleep(1)
            try:
                page = requests.get(loc, headers=UA, timeout=30).text
                title = html.unescape((re.search(r"<title>([^<]+)</title>", page) or [None, ""])[1]).split(" - Research | Modo")[0].strip()
                pub = (re.search(r'article:published_time" content="([^"]+)"', page) or [None, mod])[1]
                c = cache[loc] = {"title": title, "date": pub}
            except requests.RequestException:
                continue
        if c and c.get("title"):
            items.append({"title": clean(c["title"], 220), "link": loc, "date": parse_date(c["date"]), "snippet": ""})
    MODO_CACHE.write_text(json.dumps({k: v for k, v in cache.items() if any(k == x[1] for x in recent)}, ensure_ascii=False, separators=(",", ":")))
    return items


OPERA_INDEX = "https://opera-energie.com/sitemap_index.xml"
OPERA_CACHE = Path("data/news_opera.json")
# Opéra Énergie (energy broker for businesses): its weekly « Notes d'analyse » on French power and gas prices, a page
# each Monday with the analysis as a PDF. robots.txt allows the sitemap and the pages (only its feeds are closed to
# scripts); the title and link go into the feed, the note itself into the market notes (scripts/fetch_market_notes.py).


def opera_notes(days=21):
    """[(lastmod, url)] of the recent weekly notes, from the media sitemaps"""
    idx = requests.get(OPERA_INDEX, headers=BROWSER_UA, timeout=30)
    idx.raise_for_status()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    out = []
    for sm in re.findall(r"<loc>(https://opera-energie\.com/opera_media-sitemap\d*\.xml)</loc>", idx.text):
        t = requests.get(sm, headers=BROWSER_UA, timeout=30).text
        for loc, mod in re.findall(r"<loc>(https://opera-energie\.com/media/notes-analyse-prix-[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", t):
            if mod >= since:
                out.append((mod, loc))
    return sorted(out, reverse=True)


def opera_news(now, max_pages=6):
    """Opéra Énergie's weekly notes: title (the page's og:title) and link; the page is read once (data/news_opera.json)"""
    try:
        cache = json.loads(OPERA_CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    recent, items, fetched = opera_notes(), [], 0
    for mod, loc in recent:
        c = cache.get(loc)
        if not c and fetched < max_pages:
            fetched += 1
            time.sleep(1)
            try:
                page = requests.get(loc, headers=BROWSER_UA, timeout=30).text
                title = html.unescape((re.search(r'og:title" content="([^"]+)"', page) or [None, ""])[1]).split(" - Opéra")[0].strip()
                c = cache[loc] = {"title": f"Note d’analyse hebdo : {title}" if title else "", "date": mod}
            except requests.RequestException:
                continue
        if c and c.get("title"):
            items.append({"title": clean(c["title"], 220), "link": loc, "date": parse_date(c["date"]), "snippet": ""})
    OPERA_CACHE.write_text(json.dumps({k: v for k, v in cache.items() if any(k == x[1] for x in recent)}, ensure_ascii=False, separators=(",", ":")))
    return items


# ── Research: recent papers on power markets from open scholarly APIs (OpenAlex, arXiv, HAL), titles and links only,
# plus the paper alerts received by e-mail (Academia.edu…) in the team mailbox ──
# a paper is kept when its title speaks of a market (prices, contracts, auctions, market design…) AND of power
RESEARCH_MKT = re.compile(r"market|pric(e|es|ing)|tariff|\bppas?\b|purchase agreement|auction|tender|bidding|trading|arbitrage|day-ahead|intraday|"
                          r"balancing|ancillary|capacity (market|mechanism|remuneration|payment)|merit.order|contracts? for difference|\bcfds?\b|"
                          r"subsid|cannibali|capture (price|rate)|wholesale|retail|revenue|investment|hedg|"
                          r"march[ée]|prix|tarif|ench[èe]re|appel d.offres|soutien|r[ée]mun[ée]ration|contrat", re.I)
RESEARCH_PWR = re.compile(r"electric|power|renewable|solar|photovolta|wind|storage|batter|grid|nuclear|hydro|flexib|demand response|"
                          r"[ée]lectri|[ée]nergie|renouvelable|[ée]olien|solaire|stockage|r[ée]seau", re.I)


def research_ok(title):
    return bool(RESEARCH_MKT.search(title) and RESEARCH_PWR.search(title))


RESEARCH_DAYS = 45


def _authors(names, n=3):
    names = [x for x in names if x]
    return ", ".join(names[:n]) + (" et al." if len(names) > n else "")


def openalex_research(now):
    """OpenAlex (open catalogue of scholarly works, CC0): articles of the last weeks on power markets"""
    since = (now - timedelta(days=RESEARCH_DAYS)).date().isoformat()
    items = []
    for q in ("electricity market", "electricity prices", "power purchase agreement", "day-ahead market", "capacity market electricity", "battery arbitrage electricity"):
        r = requests.get("https://api.openalex.org/works", headers=UA, timeout=40,
                         params={"search": q, "filter": f"from_publication_date:{since},type:article", "sort": "publication_date:desc", "per-page": 50,
                                 "select": "title,publication_date,doi,primary_location,authorships,open_access"})
        r.raise_for_status()
        for w in r.json().get("results") or []:
            loc = w.get("primary_location") or {}
            link = (w.get("open_access") or {}).get("oa_url") or loc.get("landing_page_url") or w.get("doi")
            venue = ((loc.get("source") or {}).get("display_name")) or ""
            who = _authors([(a.get("author") or {}).get("display_name") for a in w.get("authorships") or []])
            d = parse_date(w.get("publication_date"))
            if w.get("title") and link and d and d <= now and research_ok(w["title"]):   # an issue dated in the future is left out
                items.append({"title": clean(w["title"], 220), "link": link, "date": d,
                              "snippet": " · ".join(x for x in (who, venue) if x), "domain": venue or "OpenAlex"})
        time.sleep(1)
    return items


def arxiv_research(now):
    """arXiv (open preprints): economics, systems and finance categories, on power markets"""
    q = ('(cat:econ.GN OR cat:econ.EM OR cat:eess.SY OR cat:q-fin.GN OR cat:q-fin.ST OR cat:math.OC) AND '
         '(abs:"electricity market" OR abs:"power market" OR abs:"electricity price" OR abs:"energy storage" OR abs:"power purchase agreement" OR abs:"balancing market")')
    r = requests.get("https://export.arxiv.org/api/query", headers=UA, timeout=60,
                     params={"search_query": q, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": 40})
    r.raise_for_status()
    ns = {"a": "http://www.w3.org/2005/Atom"}
    items, since = [], now - timedelta(days=RESEARCH_DAYS)
    for e in ET.fromstring(r.content).findall("a:entry", ns):
        d = parse_date(text_of(e.find("a:published", ns)))
        title = clean(text_of(e.find("a:title", ns)), 220)
        link = text_of(e.find("a:id", ns))
        if d and d >= since and title and link and research_ok(title):
            who = _authors([text_of(a.find("a:name", ns)) for a in e.findall("a:author", ns)])
            items.append({"title": title, "link": link, "date": d, "snippet": who + " · arXiv (prépublication)", "domain": "arXiv"})
    return items


def hal_research(now):
    """HAL (French open archive): recent papers and theses on electricity markets"""
    r = requests.get("https://api.archives-ouvertes.fr/search/", headers=UA, timeout=40,
                     params={"q": '"marché de l\'électricité" OR "electricity market" OR "prix de l\'électricité" OR "electricity prices" OR "power purchase agreement" OR "stockage d\'électricité"',
                             "fq": f"producedDate_tdate:[NOW-{RESEARCH_DAYS}DAYS/DAY TO NOW]", "fl": "title_s,uri_s,producedDate_tdate,journalTitle_s,authFullName_s",
                             "sort": "producedDate_tdate desc", "rows": 30, "wt": "json"})
    r.raise_for_status()
    items = []
    for d in (r.json().get("response") or {}).get("docs") or []:
        t = (d.get("title_s") or [""])[0]
        if t and d.get("uri_s") and research_ok(t):
            who = _authors(d.get("authFullName_s") or [])
            items.append({"title": clean(t, 220), "link": d["uri_s"], "date": parse_date(d.get("producedDate_tdate")),
                          "snippet": " · ".join(x for x in (who, d.get("journalTitle_s") or "HAL") if x), "domain": "HAL"})
    return items


def mail_alerts(now, cfg):
    """paper alerts and newsletters received in the team mailbox (config "mail_alerts": sender, link pattern): the title and
    link of each paper they list; the mail itself is neither kept nor shown. Needs GO_GMAIL_USER / GO_GMAIL_APP_PASSWORD."""
    import email as email_lib
    import imaplib
    from email.utils import parsedate_to_datetime
    user, pw = os.environ.get("GO_GMAIL_USER"), os.environ.get("GO_GMAIL_APP_PASSWORD")
    if not user or not pw or not cfg:
        return []
    im = imaplib.IMAP4_SSL("imap.gmail.com")
    im.login(user, pw)
    im.select("INBOX", readonly=True)
    since = (now - timedelta(days=14)).strftime("%d-%b-%Y")
    items = []
    for a in cfg:
        typ, data = im.search(None, f'(FROM "{a["from"]}" SINCE {since})')
        for num in (data[0].split() if typ == "OK" and data and data[0] else [])[-30:]:
            typ, msg = im.fetch(num, "(RFC822)")
            m = email_lib.message_from_bytes(msg[0][1])
            try:
                d = parsedate_to_datetime(m.get("Date"))
            except (TypeError, ValueError):
                d = now
            for part in m.walk():
                if part.get_content_type() != "text/html":
                    continue
                h = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore")
                for href, txt in re.findall(r'(?is)<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', h):
                    t = clean(txt, 220)
                    if re.search(a["link"], href) and len(t) >= 25 and not re.search(r"(?i)unsubscribe|désinscri|settings|param[èe]tres|view in browser", t + href):
                        items.append({"title": t, "link": html.unescape(href), "date": d, "snippet": a["name"] + " (alerte e-mail)", "domain": a["name"]})
    im.logout()
    seen, out = set(), []
    for i in items:
        if i["title"].lower() not in seen:
            seen.add(i["title"].lower()); out.append(i)
    return out


PUBLISHERS = {"rte": ("RTE", "rte", rte_news, ["fr", "power", "markets"]), "eex": ("EEX", "eex", eex_news, ["markets"]),
              "modo": ("Modo Energy", "modo", modo_news, ["power", "markets"]),
              "opera": ("Opéra Énergie", "opera", opera_news, ["fr", "power", "gas", "markets"])}


OFFICIAL = {"jorf": ("Journal officiel", jorf, ["fr", "regulation", "official"]), "eurlex": ("EUR-Lex", eurlex, ["regulation", "official"])}


def add_items(out, items, src, now, limit, extra=None):
    kept = 0
    seen = {i["link"] for i in out} | {i["title"].lower() for i in out}
    for it in sorted([i for i in items if i["title"] and i["link"].startswith(("http://", "https://")) and i["date"]],
                     key=lambda i: i["date"], reverse=True):
        if kept >= limit:
            break
        if it["link"] in seen or it["title"].lower() in seen:
            continue
        if it["date"] > now:            # some feeds publish future-dated items
            it["date"] = now
        blob = (it["title"] + " " + it["snippet"]).lower()
        # general-interest feeds ("require": a regex on the title, in config): keep only the energy-market articles
        if src.get("require") and not re.search(src["require"], it["title"].lower()):
            continue
        # a followed keyword: the outlet or the article must be about energy (its title, extract or the outlet's name)
        if src.get("require_text") and not (re.search(src["require_text"], blob) or re.search(ENERGY_OUTLET, (it.get("domain") or "").lower())):
            continue
        found = [t for t, rx in KEYWORDS.items() if re.search(rx, blob)]
        tags = list(dict.fromkeys(src.get("tags", []) + found))
        countries = [c for c, rx in COUNTRIES.items() if re.search(rx, blob)]
        if "fr" in src.get("tags", []) and "FR" not in countries:
            countries.insert(0, "FR")
        rec = {"source": it.get("domain") or src["name"], "cls": src.get("cls", "search"), "title": it["title"], "link": it["link"],
               "snippet": it["snippet"], "date": it["date"].isoformat(timespec="seconds"), "tags": tags, "countries": countries,
               # the article's own subjects, from its words only (not the outlet's), most telling first: the subject pills
               # and the sections of the News page
               "topics": sorted((t for t in found if t in TOPIC_ORDER), key=TOPIC_ORDER.index)}
        if extra:
            rec.update(extra)
        out.append(rec)
        seen.add(it["link"]); seen.add(it["title"].lower())
        kept += 1
    return kept


def cluster_stories(out, threshold=0.42):
    """Group records that cover the same story across outlets (published within 72 h of each other): titles compared by
    character 4–5-grams (TF-IDF cosine), which also pairs a French and an English title about the same event. The most
    relevant record stays, the others go under other_sources, so one card shows "+N sources" instead of near-duplicates."""
    import unicodedata
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    if len(out) < 2:
        return out
    norm = [unicodedata.normalize("NFKD", r["title"].lower()).encode("ascii", "ignore").decode() for r in out]
    sim = cosine_similarity(TfidfVectorizer(analyzer="char_wb", ngram_range=(4, 5), sublinear_tf=True).fit_transform(norm))
    dates = [datetime.fromisoformat(r["date"]) for r in out]
    parent = list(range(len(out)))

    def root(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a in range(len(out)):
        for b in range(a + 1, len(out)):
            if sim[a, b] >= threshold and out[a]["source"] != out[b]["source"] and abs((dates[a] - dates[b]).total_seconds()) <= 72 * 3600:
                parent[root(b)] = root(a)
    groups = {}
    for k in range(len(out)):
        groups.setdefault(root(k), []).append(k)
    groups = list(groups.values())
    merged = []
    for g in groups:
        if len(g) == 1:
            merged.append(out[g[0]])
            continue
        recs = [out[k] for k in g]
        primary = max(recs, key=lambda r: (r["impact"], r["date"]))
        others = [r for r in recs if r is not primary]
        primary["tags"] = list(dict.fromkeys(primary["tags"] + [t for r in others for t in r["tags"]]))
        primary["countries"] = list(dict.fromkeys(primary["countries"] + [c for r in others for c in r["countries"]]))
        primary["impact"] = round(primary["impact"] + 0.9 * math.log2(len(recs)), 2)   # covered by several outlets: the real story of the day (5 outlets: +2.1)
        primary["other_sources"] = [{"source": r["source"], "link": r["link"], "cls": r.get("cls", "")} for r in others]
        merged.append(primary)
    return merged


# Paid outlets: for each of their recent articles, the same story at outlets readable for free (titles and links only).
# First the outlets already collected (the story groups), else one press search on the title's key words; a result must
# share two key words with the title. Cached in data/news_free.json, so an article is searched again at most once after 12 h.
PAYWALL = re.compile(r"greenunivers|montel|wind ?power ?monthly|les echos|lesechos|contexte|recharge ?news|rechargenews", re.I)
# words too common in energy news to tie two articles together, and words a search does not need
GENERIC = set("wind power energy energie energetique solar solaire eolien eolienne eoliennes offshore france francais francaise french "
              "project projet projects projets prix price prices market marche marches electricite electricity says nouveau nouvelle "
              "first chief week semaine mwh eur gw mw year annee transition".split())
QUERY_SKIP = set("malgre comment pourquoi apres avant entre selon face aussi encore toujours amid after before over how why what "
                 "will could would should faces".split())
# recurring columns of the paid outlets: nothing to look for elsewhere
COLUMNS = re.compile(r"agenda de la transition|documents de la semaine|^round-up|^wind power patents|^montel news$|^l.essentiel", re.I)
FREE_CACHE = Path("data/news_free.json")
MAX_FREE_SEARCHES = 20


def _norm_words(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", re.sub(r"\b(?:qu|[cdjlmnst])['’]", "", (t or "").lower())).encode("ascii", "ignore").decode()
    return {w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 3 and w not in STOP and w not in GENERIC} | set(re.findall(r"\b[a-z]*\d[a-z0-9]+\b", t))


def _key_query(title):
    """the title's names and key words (capitalised words, then the longest), at most four: more would find nothing"""
    t = re.sub(r"\b(?:[Qq]u|[CDJLMNSTcdjlmnst])['’]", "", re.sub(r"\s*\[[^\]]*\]?\s*$", "", title or ""))   # elisions; a trailing [Marchés] tag
    toks = [w.strip("«»“”\"'’:,.()[]") for w in re.split(r"[\s/–]+", t)]
    plain = lambda w: (w.isupper() and w.lower() not in GENERIC) or (_norm_words(w) and not _norm_words(w) <= QUERY_SKIP)  # noqa: E731
    toks = [w for w in toks if len(w) > 2 and w.lower() not in STOP and not re.fullmatch(r"[\d.,%]+", w) and plain(w)
            and not re.fullmatch(r"\[?[A-Z]{1,2}\]?", w)]
    # names: a capital letter, except the first word of the title unless it is an acronym or has a digit
    caps = [w for k, w in enumerate(toks) if (w[:1].isupper() and (k or w.isupper() or len(toks) < 3)) or any(c.isdigit() for c in w)]
    rest = sorted((w for w in toks if w not in caps), key=len, reverse=True)
    return " ".join(list(dict.fromkeys(caps + rest))[:4])


def free_coverage(out, now):
    try:
        cache = json.loads(FREE_CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    searches = 0
    for rec in out:
        if not PAYWALL.search(rec["source"] + " " + rec["link"]) or COLUMNS.search(rec["title"]):
            continue
        found = [{"source": o["source"], "link": o["link"]} for o in rec.get("other_sources") or [] if not PAYWALL.search(o["source"] + " " + o["link"])]
        c = cache.get(rec["link"]) or {}
        age = (now - datetime.fromisoformat(rec["date"])).total_seconds() / 3600
        due = age <= 96 and (not c or (c.get("tries", 0) < 2 and (now - datetime.fromisoformat(c["at"])).total_seconds() > 12 * 3600))
        if not found and due and searches < MAX_FREE_SEARCHES:
            q, key = _key_query(rec["title"]), _norm_words(rec["title"])
            res = []
            if q:
                searches += 1
                time.sleep(3)
                try:
                    lang = "en" if re.search(r"montel|windpower", rec["source"], re.I) and not re.search(r"[éèàçù]", rec["title"]) else "fr"
                    for it in gnews(q, lang):
                        if PAYWALL.search(it["domain"] + " " + it["link"]) or len(key & _norm_words(it["title"])) < 2:
                            continue
                        if it["domain"] not in {r["source"] for r in res}:
                            res.append({"source": it["domain"], "link": it["link"], "title": it["title"]})
                except Exception as e:
                    print(f"  free coverage: {q!r}: {str(e)[:80]}")
            c = {"at": now.isoformat(timespec="seconds"), "tries": c.get("tries", 0) + 1, "free": res[:3]}
            cache[rec["link"]] = c
        found += [f for f in c.get("free") or [] if f["link"] not in {x["link"] for x in found}]
        if found:
            rec["free"] = found[:3]
    links = {r["link"] for r in out}
    FREE_CACHE.write_text(json.dumps({k: v for k, v in cache.items() if k in links}, ensure_ascii=False, separators=(",", ":")))
    n = sum(1 for r in out if PAYWALL.search(r["source"] + " " + r["link"]))
    print(f"  free coverage: {sum(1 for r in out if r.get('free'))} of {n} paid articles, {searches} searches")


def main():
    now = datetime.now(timezone.utc)
    cfg = load_config()
    prefs = learn_prefs(os.environ.get("SUPABASE_DB_URL")) or load_prefs()
    out, status = [], []
    for src in cfg.get("feeds", []) + cfg.get("pages", []):
        try:
            r = requests.get(src["url"], headers=UA, timeout=25)
            r.raise_for_status()
            items = READERS[src["reader"]](r.content) if src.get("reader") else read_feed(src["url"], r)
            n = add_items(out, items, src, now, PER_SOURCE)
            status.append({"name": src["name"], "kind": "page" if src.get("reader") else "feed", "url": src["url"], "ok": True, "n": n, "added": bool(src.get("added"))})
        except Exception as e:
            status.append({"name": src["name"], "kind": "page" if src.get("reader") else "feed", "url": src["url"], "ok": False, "error": str(e)[:120], "added": bool(src.get("added"))})
    for s in cfg.get("searches", []):
        if re.match(r"^https?://", s["q"]):   # a press search follows a phrase, not a web address (add those as an RSS feed instead)
            status.append({"name": s["q"], "kind": "search", "ok": False, "error": "not a search phrase (looks like a web address)", "added": bool(s.get("added"))})
            continue
        time.sleep(3)
        try:
            n = add_items(out, gnews(s["q"], s.get("lang", "fr")), {"name": "Search", "cls": "search", "tags": s.get("tags", []) + ["watch"], "require": s.get("require")}, now, PER_SEARCH, {"query": s["q"]})
            status.append({"name": s["q"], "kind": "search", "ok": True, "n": n, "added": bool(s.get("added"))})
        except Exception as e:
            status.append({"name": s["q"], "kind": "search", "ok": False, "error": str(e)[:120], "added": bool(s.get("added"))})
    # the subjects readers follow (their keywords): one press search each, titles and links only
    have = {x["q"].lower() for x in cfg.get("searches", [])}
    for kw in followed(os.environ.get("SUPABASE_DB_URL")):
        if kw in have:
            continue
        time.sleep(3)
        try:
            # in the energy press only: « échelonnement » alone also finds debt reschedulings and harvests
            n = add_items(out, gnews(f'"{kw}" ({ENERGY_Q})', "fr"), {"name": "Search", "cls": "search", "tags": ["watch", "follow"], "require_text": ENERGY_RE},
                          now, PER_SEARCH, {"query": kw})
            status.append({"name": f"suivi : {kw}", "kind": "search", "ok": True, "n": n})
        except Exception as e:
            status.append({"name": f"suivi : {kw}", "kind": "search", "ok": False, "error": str(e)[:120]})
    for name, fn in (("OpenAlex", openalex_research), ("arXiv", arxiv_research), ("HAL", hal_research),
                     ("alertes e-mail", lambda t: mail_alerts(t, cfg.get("mail_alerts")))):
        try:
            n = add_items(out, fn(now), {"name": name, "cls": "research", "tags": ["research"]}, now, 25)
            status.append({"name": f"recherche : {name}", "kind": "research", "ok": True, "n": n})
        except Exception as e:
            status.append({"name": f"recherche : {name}", "kind": "research", "ok": False, "error": str(e)[:120]})
    for key, (name, cls, fn, tags) in PUBLISHERS.items():
        try:
            n = add_items(out, fn(now), {"name": name, "cls": cls, "tags": tags}, now, 20)
            status.append({"name": name, "kind": "page", "ok": True, "n": n})
        except Exception as e:
            status.append({"name": name, "kind": "page", "ok": False, "error": str(e)[:120]})
    for key, (name, fn, tags) in OFFICIAL.items():
        try:
            n = add_items(out, fn(), {"name": name, "cls": "official", "tags": tags}, now, 30, {"official": True})
            status.append({"name": name, "kind": "official", "ok": True, "n": n})
        except Exception as e:
            status.append({"name": name, "kind": "official", "ok": False, "error": str(e)[:120]})
    for st in status:
        print(f"  {st['kind']:6s} {st['name'][:40]:40s} " + (f"{st['n']} items" if st["ok"] else "ERROR " + st["error"]))
    if not out:
        sys.exit("No news fetched — keeping the previous file.")
    tag_major(out)
    for rec in out:
        rec["impact"] = impact(rec, prefs)
        if {"official", "report"} & set(rec["tags"]):
            rec["theme"] = cons_theme(rec["title"])     # the same themes as the consultations (Official texts tab)
    out = group_major(cluster_stories(out))
    free_coverage(out, now)
    out.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cons, errs = consultations(now)
    if cons:   # keep the previous file when both sites failed
        CONSULT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": cons, "errors": errs}, ensure_ascii=False, separators=(",", ":")))
    print(f"  consultations: {sum(c['open'] for c in cons)} open, {len(cons)} listed" + (f" · {errs}" if errs else ""))
    # the newest articles, but official texts and reports of the last 30 days always stay: with many outlets, a Journal
    # officiel text of a few days back would otherwise fall out of the file
    month = (now - timedelta(days=30)).isoformat(timespec="seconds")
    keep = [r for r in out if r["date"] >= month and ({"official", "report", "research"} & set(r["tags"]))]
    rest = [r for r in out if r not in keep][: max(0, MAX_ITEMS - len(keep))]
    items = sorted(keep + rest, key=lambda i: i["date"], reverse=True)
    OUT.write_text(json.dumps({"updated": now.isoformat(timespec="seconds"), "items": items, "sources": status},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT}: {len(items)} items ({len(keep)} official texts and reports kept)")


if __name__ == "__main__":
    main()
