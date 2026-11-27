# Gaps of the news watch: what it missed and how it was fixed

Written by the morning brief task (config/market_context_task.md › « The watch learns every morning »): each subject or
article found on the web and missing from `data/news.json`, the cause, the fix in `config/news_sources.json`, and
whether the next news run caught it.

| Date | Subject | Missed | Cause | Fix | Caught |
|---|---|---|---|---|---|
| 2026-11-27 | Strait of Hormuz attacks (oil, LNG) | every article since 23 Nov. (in the Expert view only, from the e-mailed notes) | no press search on oil, gas or geopolitics; general outlets kept only titles on power, so oil titles were rejected | 9 press searches (Ormuz, Hormuz, Red Sea, Brent, TTF fr/en, LNG Europe, Norway gas, Russia sanctions); `pétrole`, `gnl`, `brent`, `ormuz`, `opep` added to 8 outlets' `require` | yes (run of 05:40 UTC: Hormuz and Brent articles) |
