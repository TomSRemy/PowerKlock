# Newsletter brief: written by Claude every morning

A scheduled Claude task (claude.ai, the owner's account) writes `data/newsletter_brief.json` every day at 06:17 Paris,
before the newsletter (07:00). The owner asked for it on 25 Nov. 2026: the free models of the site write vague French and
wrong causes. It is « Le point du matin » of the newsletter: `daily` for 7 O'Klock, `weekly` for PowerBrunch on Monday
(scripts/news_letter.py › claude_brief). The Expert view (data/market_digest.json) is not touched: the owner likes it as it is.

## What to read (branch `main` of TomSRemy/PowerKlock)
- `data/newsletter_brief.json`: yesterday's text (do not repeat it).
- `data/market_digest.json`: the site's market context and week-ahead calls (a source among others; check it against the figures).
- `data/history/daily/<today>.json` and `<yesterday>.json`: spot of every zone (`zones.<Z>.avg`, never the mean of the series).
- `data/history/summary_fr.json`: French spot by day (`zones.FR`, `d`, `avg`).
- `data/history/commodities_series.json`: `series.ttf`, `agsi` (EU gas storage %), `eua`, `brent`, `fr_nuc_avail` and
  `fr_nuc_avail_fc` (MW: available and the operator's forecast).
- `data/history/fr_market_calchain.json`: `FR.years` (Cal prices by day).
- `data/history/fr_forward_monthly.json`: month-ahead forwards.
- `data/weather_outlook.json`: `countries.FR.series` temp / wind / solar, `mean` against `normal`, by day.
- `data/news.json`: the news of the last days (titles and summaries), for regulation and geopolitics.
- `data/newsletter.json` › `markets`: the tiles of the day.

## What to write
`{"asof": "<today, Paris>", "written": "<ISO time>", "daily": [...], "weekly": [...]}`, each item
`{"topic", "topic_en", "text", "text_en"}`.

- `daily`: short and analytical. What changed since yesterday, why, and what it means for a buyer or a producer
  (hedging, PPA). The tiles and charts already give the figures: a number only to support an explanation. 2 to 4 topics,
  1 to 2 sentences each.
- `weekly`: rewrite it on Monday (the week before, complete: prices, weather, nuclear, gas, forwards, regulation,
  geopolitics, 2 to 3 sentences each); the other days keep the file's.
- Same text in English in `topic_en` / `text_en`.

Style (the owner's rules): simple French sentences, one idea each; no filler words (toutefois, néanmoins, en effet, par
ailleurs, autrement dit, dans ce contexte); a cause only when the figures or the news give it; never contradict the
figures; prices in €/MWh without decimals, capacity in GW with one decimal, moves in % without decimals; no source or
outlet named, nothing copied.

Example of a day (25 Nov. 2026):
- Prix : La hausse continue et la France passe au-dessus de l'Allemagne. Le gaz seul ne l'explique pas : le froid et le
  vent faible font appeler des centrales de pointe plus chères. Le vent ne reviendra pas avant le 10 décembre, ce niveau
  devrait donc tenir.
- Couverture : Le Cal 27 ne suit pas, le marché voit une tension de court terme. Pour un acheteur, c'est l'hiver qui
  coûte cher : décembre se traite au-dessus de ce que les fondamentaux justifient.
- À surveiller : les 3,8 GW de nucléaire qu'EDF attend encore. Leur retour est le principal facteur de baisse d'ici Noël.

## How to publish
Write that one file on `main` (one commit, message `data: newsletter brief <date> (Claude)`), nothing else. If a figure
is missing or a file is late, write without that topic; never invent a figure.
