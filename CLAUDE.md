# PowerKlock: rules for code changes

- **Before every push, run `scripts/check_before_push.sh`** (or set `git config core.hooksPath .githooks` once per clone:
  the pre-push hook runs it). It runs exactly the checks of the "Site tests" workflow, and "Publish" only deploys when
  they pass: a red Site tests means nothing reaches the live site. The smoke test takes about 10 minutes; run it anyway.
- After pushing, check that the "Site tests" and "Publish" runs of the commit are green.
- Every visible text exists in French and English (assets/i18n_fr.json, or a fr/en helper in the script).
