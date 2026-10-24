# PowerKlock

European power market dashboard: day-ahead and forward prices, generation, renewables capture, M0,
weather, news, PPA and carbon tools, custom dashboards. Static site; data refreshed by GitHub Actions.

## Architecture

| Part | Where | What |
|---|---|---|
| Site | `index.html`, `js/`, `assets/` | Plain HTML/JS, no build step. Libraries served from `js/vendor/` (no CDN dependency). |
| Data | `data/` | JSON/CSV files written by the workflows, read by the browser (`DATA_BASE = ./data/`). |
| Collection | `scripts/*.py`, `.github/workflows/*.yml` | One workflow per source, scheduled; each commits its files to `main`. |
| Hosting | GitHub Pages (`main`, root) and a Cloudflare Worker (`wrangler.jsonc`, `.assetsignore`) | Both serve the same files; the Worker sits behind Cloudflare Access (team only). |
| Accounts | Supabase (`js/account.js`, `warehouse/migrations/`) | Sign-in, dashboards, alerts, news votes, market notes (team only), visit counts. |
| Warehouse | Supabase Postgres, schemas `market` `analytics` `meta` `ops` (`warehouse/`) | SQL copy of the data, synced every 6 hours; migrations applied by `warehouse-sync`. |
| AI proxy | Cloudflare Worker `powerklock-ai` (code not in this repository) | Market analysis text, weekly context (`scripts/market_digest.py`). |

## Data quality

- `scripts/check_data_gaps.py` (every 2 hours) lists the holes inside the histories → `data/data_gaps.json`, shown on General › Data status and as a ⚠ badge on every chart covering one (`js/data-guard.js`).
- `scripts/verify_prices.py` compares every day-ahead day with a second source (Energy-Charts) → `data/history/price_check.json`.
- `scripts/heal_price_gaps.py` (after each data fetch) asks ENTSO-E again for missing or disagreeing days.
- `scripts/repair_prices.py` rebuilds a zone's day-ahead history (a year per request).
- Day-ahead readers keep the European coupling series (classification sequence 1) and place the clock-change days on the local clock (`scripts/pk_time.py`).

## Secrets (GitHub › Settings › Secrets and variables › Actions)

| Secret | Used by |
|---|---|
| `ENTSOE_TOKEN` | prices, generation, load, flows, activation, repairs |
| `SUPABASE_DB_URL` | warehouse sync, market notes, alerts, database backup |
| `GO_GMAIL_USER`, `GO_GMAIL_APP_PASSWORD` | GO prices, market notes, failure e-mails |
| `RTE_CLIENT_ID`, `RTE_CLIENT_SECRET` | RTE PP1/PP2 days (optional) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_FROM` | alert e-mails (optional) |
| `BACKUP_PASSPHRASE` | encryption of the nightly database backup |
| `OPEN_METEO_API_KEY` | (optional) paid Open-Meteo access |

## Install and run locally

```
pip install playwright==1.48.0 requests==2.33.1 ruff==0.17.2
python3 -m playwright install chromium
python3 -m http.server 8765          # then open http://localhost:8765/index.html
```
No build step: edit `index.html` or `js/*.js` and reload. The data in `data/` is the last one committed by the
workflows (`git pull` to refresh it).

## Tests

```
ruff check scripts tests warehouse   # Python: real errors only (ruff.toml)
python3 tests/test_calculations.py   # capture rate, currencies, second-source checks, M0 vs the CRE, daily averages
python3 tests/test_prices_dst.py     # day-ahead readers: clock-change days, two series a day, currencies
python3 tests/test_site_logic.py     # in a browser: French formats, table sorting, chart colours, navigation, pricer
python3 tests/smoke.py               # every page, view tab and catalogue chart, in English and in French
```
The test scripts serve the repository themselves (ports 8799 and 8800). All of them run in the Site tests
workflow on every code change, and before each publication.

## Publish

`main` receives code and data; the site is served from the `site` branch, which only the Publish workflow moves:
at once when only `data/` changed, after every test when code changed. To switch the hosting to it (once):
GitHub › Settings › Pages › Branch `site`, `/ (root)`; Cloudflare › Workers & Pages › powerklock › Settings ›
Build › Branch control › production branch `site`.

## Decisions

- **No build step, plain scripts.** Anyone can edit a file in the browser on GitHub and see it live; no
  toolchain to keep alive. The price: shared globals between scripts, so a name defined twice replaces the
  first (the tests check the colour helpers for that reason).
- **Data in git.** Free hosting, full history, every change reviewable; the limit is the file size Cloudflare
  accepts (25 MiB per file: `summary.json` is watched by the holes check from 20 MB).
- **Second sources and a holes check rather than trust.** Every day-ahead day is compared with Energy-Charts,
  production with Energy-Charts, Brent and EUR/USD with FRED; disagreements show on Data status.
- **French by default, English source.** The code and the data stay in English; `js/i18n.js` translates labels,
  computed sentences (templates) and number formats at display time.

## Disaster recovery

1. Fork or clone this repository (code and all market data are in it).
2. Recreate the secrets above.
3. Hosting: GitHub Pages on `main` (root), or connect the repository to a Cloudflare Worker (it reads `wrangler.jsonc`).
4. New Supabase project: run the `warehouse-sync` workflow (applies `warehouse/migrations/` and loads the warehouse).
5. Restore the accounts' data: download the latest `db-backup-*` artifact of the `Database backup` workflow, `gpg -d db.dump.gpg > db.dump`, `pg_restore --no-owner -d <database> db.dump`.
6. Put the new Supabase URL and publishable key in `js/account.js`, and the site address in Supabase › Authentication › URL Configuration.
7. Run by hand: `fetch`, `fetch_rte`, `fetch_fr_market`, `fetch_energy_charts`, `fetch_weather_outlook`, `data_gaps`.
8. Check General › Data status and run the tests.
