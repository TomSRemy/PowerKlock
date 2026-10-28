# Roles and how we work together

### 2026-10-28 00:15 · powerklock-78 (proposed, Tom to confirm)

## Who does what

| Who | Role | Owns | Does not do |
|---|---|---|---|
| **Tom** | Decides | Priorities, every **→ Tom** question, what the site publishes, mockups to validate | — |
| **powerklock-78** | Audit, correction, integration | The whole live site: structure of every page, same figures everywhere, French and English, phones (390 px), data jobs and their freshness, the source rules, auditing what reaches `main`, the backlog and the morning debrief, the reels | New pricing methods |
| **bridge-cse** | Methods and models | PPA, BOA and BESS pricing, the models behind them (capture, cannibalisation, European price model, storage), tests and backtests, the Methodology texts of those methods, decks on the methods | Publishing a new definition of a site figure without Tom's decision |

## How a change reaches the site (Tom, 28 Oct.: push, keep a backup, debrief in detail)
1. Work on a branch named after the subject, or straight on `main` for small fixes.
2. Before a batch of pushes, a backup tag on `main`: `sauvegarde-YYYY-MM-DD-HHMM` (the first one:
   `sauvegarde-2026-10-28-0030`). Going back = `git revert` of the listed commits, or a reset to the tag if Tom asks.
3. Both sessions push to `main`, each after its own full `scripts/check_before_push.sh` (separate ports), so Tom
   can check everything on the live site.
4. Every change goes into the next morning debrief, in detail: what changed for the reader, figures before and
   after, the commit, how to undo it. Tom validates or not; what he refuses is reverted the same day.
5. powerklock-78 audits what bridge-cse pushed (figures consistent with every other page, both languages, phones,
   sources, Methodology) and corrects or reports here.
6. What changes a published figure or its definition (the PPA benchmark, the BESS index) waits for Tom's decision.

## Practical rules
- Never rebase or merge `main` with `-X theirs` / `-X ours`: it silently drops the other session's work. The
  translation files (`assets/i18n_fr.json`, `assets/i18n_fr_tpl.json`) are one JSON line: resolve a conflict as a
  key union (load both sides, merge), never by taking a side (lesson of 28 Oct., 01:10).
- Tests on separate ports: bridge-cse keeps the default (`SMOKE_PORT` 8799), powerklock-78 uses `SMOKE_PORT=8850`.
- Separate worktrees; never edit another session's worktree.
- Messages between sessions for anything urgent; this folder for anything Tom should read.
- Morning debrief for Tom every day at 08:00 Paris: `debrief-YYYY-MM-DD.md` (done, found, to decide), written by powerklock-78 with bridge-cse's part.

## Subjects (one file each)
- `pricer.md` — PPA pricer and the price the site publishes
- `tools.md` — the tools day to day
- `site.md` — the whole site: pages, navigation, figures, data, languages, phones, speed
- `decisions.md` — decisions, dated
