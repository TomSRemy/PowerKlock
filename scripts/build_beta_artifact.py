#!/usr/bin/env python3
"""
build_beta_artifact.py : fabrique une copie autonome de la bêta, à publier comme page claude.ai (Artifact).

La page publiée ne peut lire que ses propres fichiers (aucun appel vers un autre site) et un envoi est limité en
nombre de fichiers. Le script produit donc, dans --out :
  · index.html  : le contenu de index.html sans son squelette (la page est insérée dans celui de claude.ai), la
                  barrière « compte validé » ouverte, la bêta active par défaut (le bouton Bêta revient au site actuel) ;
  · css/, js/, assets/ : les fichiers du site, tels quels ;
  · pk/data-NN.json    : un instantané des fichiers de données lus par le site (liste relevée par
                  scripts/inventory_site.py --requests), regroupés en quelques paquets ; un petit script placé en
                  tête de page les sert à la place du réseau (les adresses data/… du code ne changent pas).
Les appels vers d'autres sites (Open-Meteo, RTE, Elia, comptes) sont refusés tout de suite : la page se comporte
comme le site hors ligne, sur les données du jour de l'instantané.

    python3 scripts/build_beta_artifact.py --out /chemin/artifact --requests audit_out/inventory_current.json audit_out/inventory_beta.json
"""
import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK_BYTES = 7_500_000      # taille visée d'un paquet (texte brut, avant échappement JSON)
CHUNK_CHARS = 6_000_000     # un fichier plus gros est coupé en morceaux de cette taille
EXTRA_DAILY = 45            # derniers jours de livraison ajoutés même si le relevé ne les a pas lus
# caractères qu'un envoi refuse dans un fichier texte (contrôle, remplacement U+FFFD, zone privée, marque d'ordre) :
# écrits \uXXXX, ce qui revient au même dans une chaîne JavaScript ou JSON
SPECIAL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u0080-\u009f\u2028\u2029\ue000-\uf8ff\ufeff\ufff0-\uffff]")


def plain(text):
    return SPECIAL.sub(lambda m: "\\u%04x" % ord(m.group(0)), text.lstrip("\ufeff"))

SHIM = r"""<script>/* claude.ai copy: data served from the snapshot packs, the beta on by default, other sites refused at once */
(function () {
  window.PK_ARTIFACT = __STAMP__;
  var IDX = __INDEX__, packs = {}, native = window.fetch.bind(window), base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
  function pack(n) { return packs[n] || (packs[n] = native('pk/data-' + n + '.json').then(function (r) { return r.json(); })); }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(base) === 0) url = url.slice(base.length);
    if (/^(https?:)?\/\//i.test(url)) return Promise.reject(new TypeError('Snapshot: no call to ' + url.replace(/^(https?:)?\/\//i, '').split('/')[0]));
    var path = url.replace(/^\.\//, '').split('#')[0].split('?')[0], parts = IDX[path];
    if (parts) return Promise.all(parts.map(function (p) { return pack(p[0]).then(function (o) { return o[p[1]]; }); })).then(function (a) {
      return new Response(a.join(''), { status: 200, headers: { 'Content-Type': /\.csv$/.test(path) ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8' } }); });
    if (/^(data|assets)\/.*\.(json|csv|ics|geojson)$/.test(path)) return Promise.resolve(new Response('', { status: 404, statusText: 'Not in the snapshot' }));
    return native(path, init && init.signal ? { signal: init.signal } : undefined);
  };
})();</script>
"""


def must_replace(s, a, b, what):
    if a not in s:
        sys.exit(f"build_beta_artifact: motif introuvable ({what})")
    return s.replace(a, b, 1)


def build_page(stamp, index):
    html = (ROOT / "index.html").read_text()
    head = html[html.index("<head>") + 6: html.index("</head>")]
    body = html[html.index("<body>") + 6: html.rindex("</body>")]
    # la barrière « compte validé » : ouverte dans cette copie
    head = must_replace(head, "var pkGate = !pkBare", "var pkGate = false && !pkBare", "gate")
    # du <head> : le script de thème, les polices, la feuille de style ; ni icônes ni manifeste (inutiles dans le corps)
    keep = []
    m = re.search(r"<script>.*?</script>", head, re.S)
    keep.append(m.group(0))
    keep += re.findall(r'<link[^>]+fonts\.googleapis\.com/css2[^>]+>', head)
    keep += re.findall(r'<link rel="stylesheet" href="css/site\.css">', head)
    shim = SHIM.replace("__STAMP__", json.dumps(stamp)).replace("__INDEX__", json.dumps(index, separators=(",", ":")))
    top = '<title>PowerKlock Bêta</title>\n<meta name="description" content="PowerKlock, version bêta : menu par métier, recherche, plan du site. Instantané des données du ' + stamp + '.">\n'
    return top + shim + "\n".join(keep) + "\n" + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--requests", nargs="+", required=True, help="relevés de scripts/inventory_site.py --requests")
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # 1. fichiers du site, tels quels
    static = []
    for folder in ("css", "js", "assets"):
        for f in sorted((ROOT / folder).rglob("*")):
            if f.is_file() and f.name not in (".DS_Store",) and f.suffix != ".json":
                rel = f.relative_to(ROOT)
                (out / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, out / rel)
                static.append(str(rel))
                if f.suffix == ".js":   # bibliothèques minifiées : tables de codes d'xlsx, signatures zip
                    raw = (out / rel).read_text(encoding="utf-8")
                    fixed = plain(raw)
                    if fixed != raw:
                        (out / rel).write_text(fixed, encoding="utf-8")
    # la bêta est active par défaut dans cette copie (le bouton Bêta la coupe : comparaison avec le site actuel)
    for rel, a_, b_ in (("js/beta.js", "let on = false;\n  try { on = localStorage.getItem('pk-beta') === '1'; }", "let on = true;\n  try { on = localStorage.getItem('pk-beta') !== '0'; }"),
                        ("js/nav-v2.js", "let beta = false; try { beta = localStorage.getItem('pk-beta') === '1'; }", "let beta = true; try { beta = localStorage.getItem('pk-beta') !== '0'; }")):
        p = out / rel
        p.write_text(must_replace(p.read_text(), a_, b_, rel))

    # 2. données : les fichiers lus pendant les relevés, plus les derniers jours de livraison
    order, seen = [], set()
    for rq in a.requests:
        d = json.load(open(rq))
        for path, r in d.get("requests", {}).items():
            if r.get("status") == 200 and path not in seen and (ROOT / path).is_file():
                seen.add(path)
                order.append(path)
    for f in sorted((ROOT / "data/history/daily").glob("*.json"))[-EXTRA_DAILY:]:
        rel = str(f.relative_to(ROOT))
        if rel not in seen:
            seen.add(rel)
            order.append(rel)
    index, packs, cur, cur_size = {}, [], {}, 0

    def flush():
        nonlocal cur, cur_size
        if cur:
            packs.append(cur)
        cur, cur_size = {}, 0

    total = 0
    for path in order:
        text = (ROOT / path).read_text(encoding="utf-8", errors="replace")
        total += len(text)
        chunks = [text[i:i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)] or [""]
        index[path] = []
        for k, ch in enumerate(chunks):
            if cur_size and cur_size + len(ch) > PACK_BYTES:
                flush()
            key = path if len(chunks) == 1 else f"{path}#{k}"
            cur[key] = ch
            cur_size += len(ch)
            index[path].append([len(packs), key])
    flush()
    (out / "pk").mkdir()
    names = []
    for n, pk in enumerate(packs):
        p = out / "pk" / f"data-{n}.json"
        p.write_text(plain(json.dumps(pk, ensure_ascii=False, separators=(",", ":"))), encoding="utf-8")
        names.append(f"pk/data-{n}.json")

    # 3. la page
    stamp = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
    (out / "index.html").write_text(build_page(stamp, index), encoding="utf-8")
    files = static + names
    (out / "files.json").write_text(json.dumps(files, indent=0))
    size = sum((out / f).stat().st_size for f in files) + (out / "index.html").stat().st_size
    big = max(((out / f).stat().st_size, f) for f in files)
    print(f"{len(static)} fichiers du site, {len(order)} fichiers de données ({total / 1e6:.1f} Mo) en {len(packs)} paquets ; "
          f"total {size / 1e6:.1f} Mo, plus gros fichier {big[1]} {big[0] / 1e6:.1f} Mo ; page {(out / 'index.html').stat().st_size / 1e6:.2f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
