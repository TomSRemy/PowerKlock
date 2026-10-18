# PowerKlock warehouse

A PostgreSQL copy of every PowerKlock dataset, for SQL analysis by the team
and by Claude. It lives in the PowerKlock Supabase project, next to the
dashboard accounts.

## Principles

- **The GitHub repository is the source of truth.** The fetch workflows write
  JSON files to `data/`; the warehouse only mirrors them. If the database is
  lost or moved, `python warehouse/sync.py --full` rebuilds it in under a
  minute.
- **Versioned schema.** Every change is a new file in `warehouse/migrations/`
  (never edit one that was applied: the sync warns if a checksum changes).
  Migrations are applied automatically by the sync.
- **Idempotent loads.** Every write is an upsert keyed on natural keys
  (zone + day, series + date…). Re-running a sync never duplicates anything.
  Only files whose content changed are re-read (hashes in `ops.file_state`).
- **Compact storage.** One row per zone and day, with the 96 quarter-hours
  in an array. Views unfold them when needed. Full history of 30 zones is
  about 20–30 MB per year, so the Supabase free tier (500 MB) holds well over
  a decade. `ops.sync_run.message` records the size after every run.
- **Same conventions as the site.** Delivery day and intraday slots on the
  Europe/Paris clock. Generation/load arrays fetched on a UTC window are
  realigned exactly like `js/gen-align.js`. Fuel-cost conventions in
  `meta.convention` match `js/commodities.js`.
- **Known problems are data.** `ops.run_quality_checks()` runs after each
  sync; `ops.quality_issue` lists flat-zero feeds, stale copies, missing
  days, out-of-range prices, stale commodity series. Days excluded from the
  analytics views keep a `flag` in `market.da_price_day`.

## Layout

| Schema | Content |
|---|---|
| `market` | Facts. `da_price_day`, `generation_day`, `load_day`, `commodity` / `commodity_close`, `forward_settlement`, `forward_contract_close`, `spot_reference`, `go_quote`, `go_auction` |
| `analytics` | Views. `da_price_15min`, `da_price_hourly`, `da_price_daily`, `negative_hours_monthly`, `bess_spread_daily`, `generation_slot`, `generation_daily`, `capture_price_daily`, `commodity_daily`, `clean_spread_daily`, `forward_curve`, `forward_curve_latest`, `coverage` |
| `meta` | `zone`, `fuel` (with CO2 factors), `convention`, and `dictionary` (every table / view / column with its description) |
| `ops` | `sync_run`, `file_state`, `quality_issue`, `schema_migrations` |

Start any analysis with `select * from meta.dictionary` and
`select * from analytics.coverage`: history depth differs per zone.

## Setup (once)

1. Supabase → **Connect** → **Session pooler** → copy the URI
   (`postgresql://postgres.<project>:<password>@aws-…pooler.supabase.com:5432/postgres`).
   Use the session pooler: the direct connection is IPv6-only and GitHub
   runners cannot reach it.
2. GitHub → repository **Settings → Secrets and variables → Actions → New
   repository secret**: name `SUPABASE_DB_URL`, value = that URI.
3. GitHub → **Actions → Warehouse sync (Supabase) → Run workflow**, tick
   **full**. The first run creates the schemas and loads everything.

From then on the sync runs after every data fetch and every 6 hours.

## Access

- **Claude (claude.ai)**: add the Supabase connector (Settings → Connectors)
  and authorise the PowerKlock project. Prefer read-only mode when the
  connector offers it. See `CLAUDE_GUIDE.md` for how to ask.
- **People and tools** (Excel, Power BI, Python, DBeaver): create one login
  per person with read-only rights, in the Supabase SQL editor:

  ```sql
  create role jane_doe login password 'a-long-random-password' in role pk_reader;
  ```

  Connect through the session pooler host with that user. `pk_reader` can
  read `market`, `analytics`, `meta` and `ops`, nothing else.
- The REST API does not expose these schemas (only `public` is exposed by
  default), so the site's public key cannot read them.

## Operations

- Sync status: `select * from ops.sync_run order by run_id desc limit 10;`
- Open issues: `select * from ops.quality_issue order by severity, day desc;`
- Local run: `WAREHOUSE_DB_URL=postgresql://… python warehouse/sync.py [--full]`
  (needs `pip install "psycopg[binary]"`).

## Adding a dataset

1. New table (and views) in a new migration `00N_<name>.sql`, with
   `comment on` for every table and non-obvious column.
2. A `load_<name>(conn)` function in `sync.py` and its file group in
   `main()`.
3. A quality check in a new migration if the data can go wrong in a known way.

## Coverage notes

- France day-ahead history starts on 2016-01-01 (2015 files are empty).
- Other zones: complete only where the multi-zone backfill has run; check
  `analytics.coverage`.
- Generation per fuel: FR, DE_LU, ES, BE, NL from the daily fetch onwards.
- Weather is not stored: Open-Meteo's free API is for non-commercial use
  only.
