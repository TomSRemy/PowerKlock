"""Temporary: tries candidate feed addresses for the failing news sources, from GitHub's network (plain bot UA)."""
import re, requests, xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
UA = {"User-Agent": "Mozilla/5.0 (PowerKlock news fetcher; +https://github.com/TomSRemy/PowerKlock)"}
C = {
 "ANODE": ["https://www.anode-asso.fr", "https://anode-asso.fr", "https://www.anode.asso.fr", "https://anode.asso.fr", "https://www.anode.fr"],
 "France Renouvelables": ["https://france-renouvelables.fr", "https://www.france-renouvelables.fr"],
 "France Gaz Renouvelables": ["https://www.francegazrenouvelables.fr", "https://francegazrenouvelables.fr", "https://www.france-gaz-renouvelables.fr", "https://france-gaz-renouvelables.fr"],
 "AMORCE": ["https://amorce.asso.fr", "https://www.amorce.asso.fr"],
 "CLER": ["https://cler.org", "https://www.cler.org"],
 "Hespul": ["https://www.hespul.org", "https://hespul.org"],
 "GIMELEC": ["https://www.gimelec.fr", "https://gimelec.fr"],
 "France Agrivoltaïsme": ["https://www.france-agrivoltaisme.fr", "https://france-agrivoltaisme.fr", "https://www.franceagrivoltaisme.org", "https://franceagrivoltaisme.org", "https://www.france-agrivoltaisme.org"],
 "Eurelectric": ["https://www.eurelectric.org", "https://eurelectric.org"],
 "SolarPower Europe": ["https://www.solarpowereurope.org", "https://solarpowereurope.org"],
 "IFIEC Europe": ["https://www.ifieceurope.org", "https://ifieceurope.org"],
 "Modo Energy": ["https://modoenergy.com"],
 "Timera Energy": ["https://timera-energy.com"],
 "SMARD": ["https://www.smard.de"],
}
PATHS = ["/feed/", "/rss", "/rss.xml", "/feed.xml", "/fr/feed/", "/actualites/feed/", "/news/feed/", "/feed/rss/", "/index.xml", "/atom.xml", "/en/feed/", "/research/rss.xml", "/service/rss/en/feed.rss", "/service/rss/de/feed.rss"]
def feed_info(b):
    try: root = ET.fromstring(b)
    except ET.ParseError: return None
    items = [e for e in root.iter() if e.tag.split('}')[-1] in ("item", "entry")]
    dates = []
    for it in items:
        for e in it:
            if e.tag.split('}')[-1] in ("pubDate", "published", "updated", "date"): dates.append((e.text or "")[:31]); break
    return len(items), dates[:1]
def get(u):
    try:
        r = requests.get(u, headers=UA, timeout=20); return r.status_code, r.content, r.url
    except Exception as e: return type(e).__name__, b"", u
for name, bases in C.items():
    print(f"\n### {name}")
    for base in bases:
        st, body, final = get(base + "/")
        print(f"  home {base} -> {st} {final}")
        if st == "ConnectionError" or st == "ConnectTimeout": continue
        rb = get(base + "/robots.txt")
        if rb[0] == 200:
            dis = [l.strip() for l in rb[1].decode('utf-8','ignore').splitlines() if l.lower().startswith(('user-agent','disallow'))][:12]
            print("   robots:", " | ".join(dis))
        page = body.decode("utf-8", "ignore")
        for m in re.finditer(r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*>', page, re.I):
            h = re.search(r'href=["\']([^"\']+)', m.group(0))
            if h:
                u = urljoin(final, h.group(1)); s, b, _ = get(u); print(f"   announced {u} -> {s} {feed_info(b) if s == 200 else ''}")
        for p in PATHS:
            s, b, f = get(base + p)
            if s == 200:
                fi = feed_info(b)
                if fi: print(f"   FEED {base+p} -> items={fi[0]} newest={fi[1]}")
        break
