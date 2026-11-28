# PowerKlock: rules for anyone changing the site (people or AI agents)

PowerKlock is a French and European power-market dashboard: a static site (vanilla JS, Chart.js) fed by GitHub
Actions jobs that write JSON into `data/`. These rules come from the owner; follow them on every change.

## Before pushing
- **Run `scripts/check_before_push.sh`** before every push (or once per clone `git config core.hooksPath .githooks`:
  the pre-push hook runs it). It runs the fast "Site tests" checks in about 2 minutes (lint, JS syntax, calculations,
  site logic, same figures everywhere and page weight). The smoke test of every page in French and English (four
  parts side by side, about 5 minutes; `SMOKE_SHARD=k/4` runs one part) runs in "Site tests"; add `--full` to run it locally too, for a change that touches many pages.
  "Publish" only deploys code that passed Site tests: a red Site tests means nothing reaches the live site. When the
  merged code is the same as a branch that already passed, Publish does not run the tests a second time.
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
  each year). Official pages republished in the same form (CRE, ministry consultations…) may be read when they have
  no feed. Paywalled press and sites that forbid automated collection (LinkedIn): titles, links and the page's public
  summary (its description) only, never the article's text; a site whose robots.txt or server refuses scripts is not read. Exception: a LinkedIn post the owner sends from
  their phone, which opens the page while sharing (like a link preview), may give its public description; the server never opens LinkedIn. A site whose robots.txt
  refuses AI crawlers but lets other readers see its pages (AleaSoft): titles and links only, from its pages or sitemap,
  items marked `noai`, never given to an AI step (brief, newsletter, week's context, Ask, MCP). Press-search outlets get a
  trust level (official, press, state, unverified: `config/news_sources.json` › vetting); state and unverified ones show a badge
  and are `noai` too; only off-topic sites, forums and social networks are left out. Free only: no paid API.
- Every figure shown is traceable: the source is named under the chart, and Methodology describes the calculation.
- Dates are **delivery days in Paris time** (`data/history/daily/<D>.json` = prices for delivery day D). A 25-hour
  day keeps 96 quarter-hours in its series: use the published daily average (`avg`), never the mean of the series.
- A dated event (regulation, market, geopolitics, nuclear, grid, weather) goes into `data/events.json` only with a
  date checked against its source.
- When two sources disagree (PowerKlock vs RTE, EEX, CRE…), find and write down the cause before showing both.

- **When jobs run**: in `workers/scheduler/schedule.json` (a Cloudflare Worker starts them on time), never a GitHub
  `schedule:` (late by hours, often dropped). A job reading its slot uses `inputs.cron`. `tests/test_scheduler.py` checks it.

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
- Group small changes into one push: each push to the site costs a test run of about 5 minutes.
