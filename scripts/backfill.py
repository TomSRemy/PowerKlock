name: Backfill Historical Data

on:
  workflow_dispatch:
    inputs:
      date_mode:
        description: 'How to choose the date range'
        required: true
        default: 'year'
        type: choice
        options:
          - 'year'
          - 'range'
      year:
        description: 'If date_mode=year: which calendar year (e.g. 2024)'
        required: false
        default: '2024'
      date_from:
        description: 'If date_mode=range: start date YYYY-MM-DD (e.g. 2023-01-01)'
        required: false
        default: ''
      date_to:
        description: 'If date_mode=range: end date YYYY-MM-DD (inclusive)'
        required: false
        default: ''
      zones_preset:
        description: 'Zone preset (use "custom" to type your own list in the field below)'
        required: true
        default: 'all'
        type: choice
        options:
          - 'all'
          - 'FR'
          - 'DE_LU'
          - 'FR,DE_LU'
          - 'core-west (FR,DE_LU,BE,NL)'
          - 'iberia (ES,PT)'
          - 'italy (IT_NORD,IT_SICI)'
          - 'nordics (NO_1,DK_W,DK_E,SE,FI,EE,LV,LT)'
          - 'central-east (AT,CH,CZ,SK,PL,HU,SI,HR,RO,BG)'
          - 'balkans (GR,RS,MK,ME)'
          - 'custom'
      zones:
        description: 'Custom zones (used only if preset = custom). Comma-separated, e.g. FR,DE_LU,ES'
        required: false
        default: ''
      with_genmix:
        description: 'Also fetch generation mix (5x slower, adds renPct + domFuel)'
        required: true
        default: false
        type: boolean
      mode:
        description: 'How to treat existing files: fill = skip them | repair = regenerate corrupt files (< min-zones) | rebuild = redo all'
        required: true
        default: 'fill'
        type: choice
        options:
          - 'fill'
          - 'repair'
          - 'rebuild'
      min_zones:
        description: 'For mode=repair: regenerate any file with fewer than this many valid zones'
        required: false
        default: '10'
      dry_run:
        description: 'Dry run (just print the plan, no API calls)'
        required: true
        default: false
        type: boolean

concurrency:
  group: backfill-historical
  cancel-in-progress: false

jobs:
  backfill:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    timeout-minutes: 350
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install requests==2.33.1

      - name: Build CLI args
        id: args
        run: |
          ARGS="--fetch-historical"
          if [ "${{ inputs.date_mode }}" = "year" ]; then
            ARGS="$ARGS --year ${{ inputs.year }}"
          else
            if [ -z "${{ inputs.date_from }}" ] || [ -z "${{ inputs.date_to }}" ]; then
              echo "ERROR: date_mode=range requires both date_from and date_to" >&2
              exit 1
            fi
            ARGS="$ARGS --from ${{ inputs.date_from }} --to ${{ inputs.date_to }}"
          fi
          # Resolve zones from the preset dropdown; "custom" uses the free-text field.
          PRESET="${{ inputs.zones_preset }}"
          case "$PRESET" in
            custom)        ZONES_ARG="${{ inputs.zones }}" ;;
            "core-west "*) ZONES_ARG="FR,DE_LU,BE,NL" ;;
            "iberia "*)    ZONES_ARG="ES,PT" ;;
            "italy "*)     ZONES_ARG="IT_NORD,IT_SICI" ;;
            "nordics "*)   ZONES_ARG="NO_1,DK_W,DK_E,SE,FI,EE,LV,LT" ;;
            "central-east "*) ZONES_ARG="AT,CH,CZ,SK,PL,HU,SI,HR,RO,BG" ;;
            "balkans "*)   ZONES_ARG="GR,RS,MK,ME" ;;
            *)             ZONES_ARG="$PRESET" ;;
          esac
          # Strip any whitespace (e.g. "FR, DE_LU" → "FR,DE_LU") so word-splitting
          # never turns a space into a stray positional arg for argparse.
          ZONES_ARG="${ZONES_ARG// /}"
          # Expand "all" shortcut to full zone list (kept in sync with ZONES_EIC in enrich_summary.py)
          if [ "$ZONES_ARG" = "all" ] || [ "$ZONES_ARG" = "ALL" ]; then
            ZONES_ARG="FR,DE_LU,ES,BE,NL,GB,PT,IT_NORD,IT_SICI,GR,RS,MK,HU,CH,RO,BG,ME,HR,SI,AT,SK,CZ,PL,NO_1,DK_W,DK_E,LT,LV,FI,EE,SE"
          fi
          if [ -z "$ZONES_ARG" ]; then
            echo "::error::No zones resolved. Pick a preset or set preset=custom and fill the zones field."
            exit 1
          fi
          ARGS="$ARGS --zones $ZONES_ARG"
          if [ "${{ inputs.with_genmix }}" = "true" ]; then
            ARGS="$ARGS --with-genmix"
          fi
          ARGS="$ARGS --mode ${{ inputs.mode }}"
          if [ "${{ inputs.mode }}" = "repair" ]; then
            ARGS="$ARGS --min-zones ${{ inputs.min_zones }}"
          fi
          if [ "${{ inputs.dry_run }}" = "true" ]; then
            ARGS="$ARGS --dry-run"
          fi
          echo "args=$ARGS" >> $GITHUB_OUTPUT
          echo "Final args: $ARGS"

      - name: Run backfill
        env:
          ENTSOE_TOKEN: ${{ secrets.ENTSOE_TOKEN }}
        run: python scripts/enrich_summary.py ${{ steps.args.outputs.args }}

      - name: Commit and push
        if: ${{ inputs.dry_run == false }}
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          git add data/history/
          if git diff --cached --quiet; then
            echo "No changes to commit"
            exit 0
          fi
          if [ "${{ inputs.date_mode }}" = "year" ]; then
            RANGE="year=${{ inputs.year }}"
          else
            RANGE="${{ inputs.date_from }} to ${{ inputs.date_to }}"
          fi
          MSG="backfill[${{ inputs.mode }}]: $RANGE zones=${{ inputs.zones_preset }}"
          if [ "${{ inputs.with_genmix }}" = "true" ]; then
            MSG="$MSG +genmix"
          fi
          git commit -m "$MSG"
          for i in 1 2 3 4 5; do
            git pull --rebase origin main && git push && exit 0
            echo "Push attempt $i failed, retrying in 8s..."
            sleep 8
          done
          echo "Failed to push after 5 attempts"
          exit 1
