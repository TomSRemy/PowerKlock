"""cours_*.md → cours_*.pdf (Markdown → HTML → Chromium). Lancer depuis la racine du dépôt : python3 docs/discussion/cours/build_pdf.py"""
import os, sys, markdown
from playwright.sync_api import sync_playwright

D = os.path.dirname(os.path.abspath(__file__))
CSS = """
@page { size: A4; margin: 16mm 15mm 16mm 15mm; }
body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1f2933; }
h1 { font-size: 21pt; color: #2f6db5; margin: 0 0 4mm; }
h2 { font-size: 15pt; color: #2f6db5; border-bottom: 2px solid #c9b48a; padding-bottom: 2mm; margin-top: 0; page-break-before: always; }
h1 + p + p + hr + h2, h1 + p + p + p + hr + h2 { page-break-before: avoid; }
h3 { font-size: 11.5pt; color: #7a5aa6; margin: 4mm 0 1.5mm; }
img { max-width: 100%; max-height: 105mm; display: block; margin: 3mm auto; page-break-inside: avoid; }
blockquote { background: #faf5ea; border-left: 4px solid #d08a1e; margin: 3mm 0; padding: 2mm 4mm; page-break-inside: avoid; }
blockquote p { margin: 1mm 0; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 3mm 0; page-break-inside: avoid; }
th, td { border: 1px solid #d5dbe3; padding: 1.5mm 2mm; vertical-align: top; }
th { background: #e8f0fa; }
code { font-size: 9pt; background: #f1f3f6; padding: 0 1mm; }
hr { border: none; border-top: 1px solid #d5dbe3; }
li, p, td { overflow-wrap: anywhere; }
"""

def build(name):
    md = open(os.path.join(D, name + '.md'), encoding='utf-8').read()
    import re
    md = re.sub(r'(?<![(<])(https?://[^\s)]+[^\s).,;])', r'<\1>', md)   # liens cliquables dans le PDF
    body = markdown.markdown(md, extensions=['tables', 'sane_lists'])
    html = f'<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}</body></html>'
    hp = os.path.join(D, name + '.html')
    open(hp, 'w', encoding='utf-8').write(html)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('file://' + hp); pg.wait_for_load_state('networkidle')
        pg.pdf(path=os.path.join(D, name + '.pdf'), format='A4', print_background=True,
               display_header_footer=True, header_template='<span></span>',
               footer_template='<div style="font-size:8px;color:#8a94a3;width:100%;text-align:center">PowerKlock · cours · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
               margin={'top': '14mm', 'bottom': '16mm', 'left': '14mm', 'right': '14mm'})
        b.close()
    os.remove(hp)
    print('ok', name)

for n in (sys.argv[1:] or ['cours_simple']):
    build(n)
