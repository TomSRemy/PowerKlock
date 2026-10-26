#!/usr/bin/env bash
# The same checks as the "Site tests" workflow, which gates "Publish": if one fails here, the site would not be
# published. Run before every push (the pre-push hook in .githooks does it):  git config core.hooksPath .githooks
# Data-only pushes (data/ alone) skip the browser tests.
set -eo pipefail   # a failing test fails the script even when its output is piped
cd "$(git rev-parse --show-toplevel)"
# the code that passed last time (everything but data/): a push that only adds the bots' data commits on top
# (git pull --rebase) does not run the 10 minutes again
sig=$( { git ls-tree -r HEAD | grep -v "	data/"; git diff HEAD -- . ':!data' ; } | sha1sum | cut -c1-40)
stamp="$(git rev-parse --git-dir)/pk-last-check"
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$sig" ]; then echo "✓ same code as the last full check that passed: safe to push"; exit 0; fi
changed=$(git diff --name-only origin/main...HEAD 2>/dev/null; git diff --name-only; git diff --name-only --cached)
echo "▸ Python lint";        ruff check scripts tests warehouse
if command -v node >/dev/null; then
  echo "▸ JavaScript syntax (node)"; for f in js/*.js js/*/*.js; do case "$f" in js/vendor/*) continue;; esac; node --check "$f"; done
else
  echo "▸ JavaScript syntax (browser)"; python3 tests/js_syntax.py
fi
echo "▸ Calculations";       python3 tests/test_calculations.py >/dev/null && python3 tests/test_prices_dst.py >/dev/null
if [ -n "$changed" ] && ! echo "$changed" | grep -qvE '^data/'; then echo "data only: browser tests skipped"; exit 0; fi
echo "▸ Site logic";         python3 tests/test_site_logic.py | tail -1 && python3 tests/test_ppa_frozen.py | tail -1
echo "▸ Smoke tests (about 10 minutes)"; python3 tests/smoke.py | tail -3
echo "$sig" > "$stamp"
echo "✓ all the checks of Site tests pass: safe to push"
