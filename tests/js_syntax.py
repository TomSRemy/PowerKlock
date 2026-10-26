"""Syntax check of every site script, as CI's `node --check` does, for machines without Node:
each file is compiled (not run) by the browser. Exit 1 on the first error."""
import glob
import sys
from playwright.sync_api import sync_playwright

files = [f for f in sorted(glob.glob('js/*.js') + glob.glob('js/*/*.js')) if not f.startswith('js/vendor/')]
bad = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    for f in files:
        err = pg.evaluate("src => { try { new Function(src); return null; } catch (e) { return String(e); } }", open(f, encoding='utf-8').read())
        if err:
            bad.append(f'{f}: {err}')
    b.close()
for x in bad:
    print('FAIL', x)
print(f'{len(files) - len(bad)}/{len(files)} scripts parse')
sys.exit(1 if bad else 0)
