# PowerKlock: rules for anyone changing the site (people or AI agents)

PowerKlock is a French and European power-market dashboard: a static site (vanilla JS, Chart.js) fed by GitHub
Actions jobs that write JSON into `data/`. These rules come from the owner; follow them on every change.

## Before pushing
- **Run `scripts/check_before_push.sh`** before every push (or once per clone `git config core.hooksPath .githooks`:
  the pre-push hook runs it). It runs exactly the "Site tests" checks (lint, JS syntax, calculations, site logic,
  same figures everywhere and page weight, smoke test of every page in French and English). "Publish" only deploys
  when they pass: a red Site tests means nothing reaches the live site. The smoke test takes about 10 minutes; run it.
- After pushing, check that the commit's "Site tests" and "Publish" runs are green.
- Never skip, disable or loosen a test to get green: find the cause.

## Language
- **Every visible text exists in French and English**: static labels, generated sentences, chart legends and axes,
  widgets, messages. French is the default. Write English in the code and add the French to `assets/i18n_fr.json`
  (templates with numbers in `assets/i18n_fr_tpl.json`), or branch with a fr/en helper in the script.
- The brand **PowerKlock** is never translated (mark split wordmarks `translate="no"`).
- Code that finds a button or tab by its English text breaks in French: compare with `pkEN(text)`.

## Data
- **Only useful sources that update automatically**: APIs, open-data portals (ODRÉ, ENTSO-E, RTE Data Portal,
  Energy-Charts, CRE open data, EEX…), or official files republished in the same form every year (parsed by a job
  each year). No scraping of static pages, one-off reports or sites without a machine-readable source.
- Every figure shown is traceable: the source is named under the chart, and Methodology describes the calculation.
- Dates are **delivery days in Paris time** (`data/history/daily/<D>.json` = prices for delivery day D). A 25-hour
  day keeps 96 quarter-hours in its series: use the published daily average (`avg`), never the mean of the series.
- A dated event (regulation, market, geopolitics, nuclear, grid, weather) goes into `data/events.json` only with a
  date checked against its source.
- When two sources disagree (PowerKlock vs RTE, EEX, CRE…), find and write down the cause before showing both.

## Secrets
- No key, token or password in the repository, in a commit, in a log or in a chat. Secrets live in GitHub
  (Settings › Secrets › Actions) and jobs read them as `${{ secrets.NAME }}`.

## Design and layout
- **Mockup before any large change** (new page, redesign): show it, wait for the go.
- New pages follow Markets › Day-ahead: sticky bar `.pr-tabs-sticky > .pr-tabs-bar` (breadcrumb Section › Page, tabs,
  filters), then collapsible `.hist-section.hist-section-strong` sections, standard `.kpi-card`.
- Rising prices in red, falling in green, everywhere. Straight lines between data points (no smoothing that invents
  values). Charts side by side start at the same height; titles and units wrap, never cut.
- Check small screens: 390, 1024, 1180 and 1280 px wide, no horizontal scroll.
- Shared dashboards (`#solo=`) contain no link back to the rest of the site.

## How to work
- Non-structural changes (layout, texts, charts): do them and push. Structural changes (data pipeline, storage,
  backend, removing a feature): propose first.
- A question asking for information gets an answer, not a site change.
- Site notes (the "Note" button) arrive in `data/site_notes.json`; answer each in `config/note_replies.json`.
- Commit messages say what changed for the reader of the site, in plain words.
