"""Temporary: how many Google News results each candidate search gives (last 7 and 30 days), from GitHub's network."""
import time, requests, xml.etree.ElementTree as ET
UA = {"User-Agent": "Mozilla/5.0 (PowerKlock news fetcher; +https://github.com/TomSRemy/PowerKlock)"}
G = "https://news.google.com/rss/search"
Q = [("ANODE fournisseurs électricité", "fr"), ('"ANODE" énergie fournisseurs alternatifs', "fr"), ('"Naima Idir"', "fr"),
     ('"France Gaz Renouvelables"', "fr"), ('"France Agrivoltaïsme"', "fr"), ('"France Renouvelables"', "fr"),
     ("site:france-renouvelables.fr", "fr"), ('AMORCE énergie collectivités', "fr"), ("site:amorce.asso.fr", "fr"),
     ('"réseau CLER"', "fr"), ("site:reseau-cler.org", "fr"), ("Hespul", "fr"), ("site:hespul.org", "fr"),
     ("GIMELEC", "fr"), ("site:gimelec.fr", "fr"), ("Eurelectric", "en"), ("site:eurelectric.org", "en"),
     ('"SolarPower Europe"', "en"), ("site:solarpowereurope.org", "en"), ("IFIEC Europe", "en"),
     ('"Modo Energy"', "en"), ("site:modoenergy.com", "en"), ("site:wattselse.com", "fr")]
def n(q, lang, when):
    loc = {"fr": dict(hl="fr", gl="FR", ceid="FR:fr"), "en": dict(hl="en-GB", gl="GB", ceid="GB:en")}[lang]
    for wait in (0, 20, 45):
        time.sleep(wait)
        r = requests.get(G, params=dict(q=f"{q} when:{when}", **loc), headers=UA, timeout=25)
        if r.status_code != 429: break
    if r.status_code != 200: return f"HTTP {r.status_code}"
    items = ET.fromstring(r.content).findall(".//item")
    return len(items), [i.findtext("title")[:80] for i in items[:2]]
for q, lang in Q:
    print(f"{q!r:50} 7d={n(q, lang, '7d')}  30d={n(q, lang, '30d')[0] if isinstance(n(q, lang, '30d'), tuple) else '?'}")
    time.sleep(3)
for u in ["https://timera-energy.com/rss.xml"]:
    r = requests.get(u, headers=UA, timeout=20); print(u, r.status_code, len(ET.fromstring(r.content).findall('.//item')))
