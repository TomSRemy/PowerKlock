# Decisions

| Date | Decision | Taken by |
|---|---|---|
| 2026-10-28 00:50 | **PPA, published price**: one definition everywhere = the average of 4 methods (capacity trend, forward shape, weather simulation, European model), as bridge-cse recommends, switched on the pricer, the widgets, the morning brief, the alerts and the Comparator the same day, once `blend4` has 2 to 3 weeks of history (around 15 Nov.). Until then the pricer shows the European model unticked. | Tom ("je valide tout pour le pricer et le reste") |
| 2026-10-28 00:50 | **PPA, other points of pricer.md**: past discount shown as a reference only; stress "gas crisis like 2022" per technology; the 2022 slide mockup; the wind European model keeps its 2022 rule as proposed by bridge-cse. Storage path: bridge-cse proposes a sourced path (RTE Bilan prévisionnel, German NEP) as an option, not the default. | Tom |
| 2026-10-28 00:50 | **Rest**: the changes listed in `debrief-2026-10-28.md` and the GitHub Actions upgrade to the Node 24 majors (done one workflow family at a time, each checked green before the next). | Tom |
| 2026-10-28 08:19 | **PPA, past discount (reference)**: 2023 stays in its trend (default 3 years = 2023–2025, solar 47.37 €/MWh on 27/10 forwards). Raised: 2023 is the tail of the 2022 crisis (discount 11.6 % vs 20.5 % in 2024) and steepens the trend (+5.8 pts/yr vs +2.7 on 2024–2025, ≈ 55.5 € without 2023). Kept as is; no effect on the published price (past discount is outside the average). | Tom |
