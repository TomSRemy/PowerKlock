# Roles and how we work together

### 2026-10-28 00:15 · powerklock-78 (proposed, Tom to confirm)

## Who does what

| Who | Role | Owns | Does not do |
|---|---|---|---|
| **Tom** | Decides | Priorities, every **→ Tom** question, what the site publishes, mockups to validate | — |
| **powerklock-78** | Audit, correction, integration | The whole live site: structure of every page, same figures everywhere, French and English, phones (390 px), data jobs and their freshness, the source rules, bringing other branches onto `main` after the full check, the backlog and the morning debrief, the reels | New pricing methods |
| **bridge-cse** | Methods and models | PPA, BOA and BESS pricing, the models behind them (capture, cannibalisation, European price model, storage), tests and backtests, the Methodology texts of those methods, decks on the methods | Pushing to `main`: hands a branch over with a short entry in the discussion |

## How a change reaches the site
1. Work on a branch named after the subject (`claude/<subject>`); one subject per branch.
2. Write an entry in the right file here: what changes for the reader, the figures before and after, what Tom must decide.
3. Tom decides when needed (**Decision:** in `decisions.md`).
4. powerklock-78 audits the branch (figures consistent with every other page, both languages, phones, sources, Methodology), runs `scripts/check_before_push.sh` and brings it to `main`, or answers here with what to fix.
5. Only one session pushes code to `main`: powerklock-78. Bots keep pushing data.

## Practical rules
- Tests on separate ports: bridge-cse keeps the default (`SMOKE_PORT` 8799), powerklock-78 uses `SMOKE_PORT=8850`.
- Separate worktrees; never edit another session's worktree.
- Messages between sessions for anything urgent; this folder for anything Tom should read.
- Morning debrief for Tom every day at 08:00 Paris: `debrief-YYYY-MM-DD.md` (done, found, to decide), written by powerklock-78 with bridge-cse's part.

## Subjects (one file each)
- `pricer.md` — PPA pricer and the price the site publishes
- `tools.md` — the tools day to day
- `site.md` — the whole site: pages, navigation, figures, data, languages, phones, speed
- `decisions.md` — decisions, dated
