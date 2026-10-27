# The whole site

### 2026-10-28 00:15 · powerklock-78

State after the audit of 27 Oct. (every page and view tab, French, 1 280 px and 390 px):
- no broken figure (NaN, empty, infinity), no sideways scroll on phones, no empty section;
- about 200 English texts left on the French site, translated; a finer pass on every page is running tonight;
- the tools reorganised (PPA, BOA, forecast); input hints now translated.

To discuss:
1. **One figure, one definition.** The PPA price is the first case (see `pricer.md`). Same check to run for the
   BESS index (index view, Europe view, BOA pricer, reels) and the spot averages (Today, reels, brief).
2. **Jobs that start late.** GitHub often starts scheduled jobs hours late (Energy-Charts 05:40 UTC started at
   10:54 on 27 Oct.). A Cloudflare Worker could trigger them on time. **→ Tom** (needs a Worker and a GitHub token
   on your side).
3. **Sources still missing**: French aFRR capacity prices (RTE Balancing Capacity API, subscription pending),
   Tempo and Ecowatt (parked by Tom).
4. **Section titles that state the finding** in Analysis (mockup to make).
5. **Navigation**: 31 pages; check that every page is reachable in two clicks and named the same in the menu,
   the breadcrumb and the search.
