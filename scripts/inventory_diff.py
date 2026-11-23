#!/usr/bin/env python3
"""
inventory_diff.py : preuve « zéro perte » entre deux relevés de scripts/inventory_site.py.

Compare le relevé du site actuel et celui de la bêta : chaque graphique, tableau, carte KPI, section, carte,
réglage et bloc de texte vu sur le site actuel doit se retrouver dans au moins une vue de la bêta. Un graphique
affiché sur le site actuel doit être affiché (et dessiné) dans la bêta aussi.

    python3 scripts/inventory_diff.py audit_out/inventory_current.json audit_out/inventory_beta.json \
        [--json audit_out/zero_loss.json] [--md audit_out/zero_loss.md]

Les graphiques nourris en direct par Open-Meteo dans le navigateur (DJU, prévision d'un site) sont limités en débit
par adresse : si un passage reçoit des refus (429), relever ces pages à nouveau, seules, et donner les deux fichiers
séparés par une virgule (les vues relevées à nouveau remplacent les premières) :
    python3 scripts/inventory_site.py --beta --only system/weather tools/forecast --out audit_out/beta_meteo.json
    python3 scripts/inventory_diff.py audit_out/inventory_current.json audit_out/inventory_beta.json,audit_out/beta_meteo.json

Sortie : code 0 si rien ne manque, 1 sinon. Les regroupements voulus (une adresse devenue un onglet, une section
renommée) sont listés à part : ils ne sont pas des pertes.
"""
import argparse
import json
import re
import sys
from collections import defaultdict

KINDS = ["chart", "table", "kpi", "section", "map", "figure", "control", "text"]
NAMES = {"chart": "graphiques", "table": "tableaux", "kpi": "cartes KPI", "section": "sections", "map": "cartes",
         "figure": "schémas", "control": "réglages", "text": "blocs de texte"}
# textes qui changent d'une minute à l'autre ou d'un passage à l'autre (horloge, « il y a 3 min », files d'actualités)
# graphiques nourris en direct par Open-Meteo dans le navigateur, limité en débit par adresse (même liste que
# tests/smoke.py, LIVE_CANVASES) : affiché mais non dessiné pendant un passage qui a reçu des refus 429 = non comparable
LIVE = {"wx-forecast-canvas", "hdd-canvas", "hdd-cum", "hdd-weekly", "fc-hourly", "fc-daily"}
VOLATILE = re.compile(r"il y a|ago|mis à jour|updated|chargement|loading|\bmin\b|maintenant|now", re.I)


def load(paths):
    # plusieurs fichiers séparés par des virgules : les vues relevées à nouveau (--only) remplacent celles du premier
    files = paths.split(",")
    d = json.load(open(files[0]))
    for extra in files[1:]:
        e = json.load(open(extra))
        redo = {v["label"] for v in e["views"]}
        d["views"] = [v for v in d["views"] if v["label"] not in redo] + e["views"]
        d["errors"] = [x for x in d["errors"] if x.get("view") not in redo] + e["errors"]
        d["meta"]["views"] = len(d["views"])
    items = {}
    where = defaultdict(list)
    for v in d["views"]:
        for it in v["items"]:
            k = it["key"]
            where[k].append(v["label"])
            cur = items.get(k)
            if cur is None:
                items[k] = dict(it)
                items[k]["shown"] = bool(it.get("shown", True))
                items[k]["drawn"] = bool(it.get("drawn", True))
            else:
                if it.get("shown", True) and not cur["shown"]:
                    cur.update(w=it.get("w"), h=it.get("h"))
                cur["shown"] = cur["shown"] or bool(it.get("shown", True))
                cur["drawn"] = cur["drawn"] or bool(it.get("drawn", True))
                if it.get("title") and not cur.get("title"):
                    cur["title"] = it["title"]
    return d, items, where


def shown_views(d, key):
    return [v["label"] for v in d["views"] for it in v["items"] if it["key"] == key and it.get("shown", True)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("current")
    ap.add_argument("beta")
    ap.add_argument("--json")
    ap.add_argument("--md")
    a = ap.parse_args()
    dc, cur, wc = load(a.current)
    db, bet, wb = load(a.beta)

    summary, missing, weaker, moved, renamed, live = {}, [], [], [], [], []
    throttled = any("429" in json.dumps(e) or "open-meteo" in json.dumps(e) for e in db["errors"])
    for kind in KINDS:
        ck = [k for k, it in cur.items() if it["kind"] == kind]
        bk = {k for k, it in bet.items() if it["kind"] == kind}
        miss = [k for k in ck if k not in bk]
        if kind == "text":   # un texte horodaté ou réécrit entre deux passages n'est pas une perte s'il est volatil
            miss = [k for k in miss if not VOLATILE.search(cur[k].get("title", ""))]
        summary[kind] = {"current": len(ck), "beta": len(bk), "found": len(ck) - len(miss), "missing": len(miss), "added": len(bk - set(ck))}
        for k in miss:
            missing.append({"kind": kind, "key": k, "title": cur[k].get("title", ""), "views": wc[k][:3]})
    # graphiques : affichés et dessinés au moins autant
    for k, it in cur.items():
        if it["kind"] != "chart" or k not in bet:
            continue
        b = bet[k]
        if (it["shown"] and not b["shown"]) or (it["drawn"] and it["shown"] and not b["drawn"]):
            w = {"key": k, "title": it.get("title", ""), "current": {"shown": it["shown"], "drawn": it["drawn"]},
                 "beta": {"shown": b["shown"], "drawn": b["drawn"]}, "views": shown_views(dc, k)[:2]}
            (live if k.split("|", 1)[1] in LIVE and b["shown"] and throttled else weaker).append(w)
    # où chaque graphique se trouve : vue actuelle → vue bêta (premières vues où il est affiché)
    for k, it in cur.items():
        if it["kind"] != "chart" or not it["shown"] or k not in bet:
            continue
        vc, vb = shown_views(dc, k), shown_views(db, k)
        moved.append({"key": k[6:], "title": it.get("title", ""), "current": vc[0] if vc else "", "beta": vb[0] if vb else "",
                      "size_current": [it.get("w"), it.get("h")], "size_beta": [bet[k].get("w"), bet[k].get("h")]})
    for k, it in cur.items():
        if it["kind"] == "section" and k in bet and (it.get("title") or "") != (bet[k].get("title") or ""):
            renamed.append({"key": k[8:], "current": it.get("title", ""), "beta": bet[k].get("title", "")})

    hard = [m for m in missing if m["kind"] != "text"]
    ok = not hard and not weaker
    out = {"ok": ok, "current": dc["meta"], "beta": db["meta"], "summary": summary, "missing": missing, "weaker_charts": weaker,
           "renamed_sections": renamed, "charts": moved, "live_not_comparable": live,
           "errors": {"current": len(dc["errors"]), "beta": len(db["errors"]),
                      "beta_page_errors": [e for e in db["errors"] if "error" in e][:20]}}
    if a.json:
        json.dump(out, open(a.json, "w"), ensure_ascii=False, indent=1)

    lines = ["# Preuve zéro perte : site actuel → bêta", "",
             f"Relevé du site actuel : {dc['meta']['views']} vues ({dc['meta']['date']}). Relevé de la bêta : {db['meta']['views']} vues ({db['meta']['date']}).", "",
             "| Élément | Site actuel | Retrouvés dans la bêta | Manquants | En plus dans la bêta |", "|---|---|---|---|---|"]
    for kind in KINDS:
        s = summary[kind]
        lines.append(f"| {NAMES[kind]} | {s['current']} | {s['found']} | {s['missing']} | {s['added']} |")
    lines += ["", f"Graphiques affichés sur le site actuel et moins bien servis dans la bêta (cachés ou non dessinés) : {len(weaker)}.", ""]
    for w in weaker:
        lines.append(f"- `{w['key']}` {w['title']} : actuel {w['current']}, bêta {w['beta']} ({', '.join(w['views'])})")
    if live:
        lines += ["", "Graphiques nourris en direct par Open-Meteo, affichés dans la bêta mais non dessinés pendant le relevé parce que "
                  f"Open-Meteo a refusé des appels (429, limite de débit par adresse) : {len(live)}. Non comparables, comme dans tests/smoke.py.", ""]
        for w in live:
            lines.append(f"- `{w['key']}` {w['title']} ({', '.join(w['views'])})")
    if missing:
        lines += ["", "## Manquants", ""]
        for m in missing:
            lines.append(f"- {NAMES[m['kind']]} `{m['key']}` {m['title'][:80]} (vu dans : {', '.join(m['views'])})")
    if renamed:
        lines += ["", "## Sections renommées (même contenu)", ""]
        for r in renamed:
            lines.append(f"- `{r['key']}` : « {r['current']} » → « {r['beta']} »")
    lines += ["", "## Résultat", "", ("**Zéro perte** : tout graphique, tableau, carte KPI, section, carte et réglage du site actuel est présent dans la bêta."
                                     if ok else "**À corriger** : des éléments manquent ou sont moins bien servis (voir plus haut).")]
    if a.md:
        open(a.md, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:14 + len(weaker)]))
    print(f"\nmanquants hors texte : {len(hard)} · textes manquants : {len(missing) - len(hard)} · graphiques moins bien servis : {len(weaker)}"
          f" · Open-Meteo non comparables : {len(live)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
