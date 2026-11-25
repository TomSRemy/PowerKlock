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
`{"asof": "<today, Paris>", "written": "<ISO time>", "daily": [...], "weekly": [...], "history": [...]}`, each item
`{"topic", "topic_en", "text", "text_en"}`; `history` keeps the `daily` of the last 10 days (`{"asof", "daily"}`, newest
first): add yesterday's, drop the oldest.

- `daily`: short and analytical. What changed since yesterday, why, and what it means for a buyer or a producer
  (hedging, PPA). The tiles and charts already give the figures: a number only to support an explanation. 2 to 4 topics,
  1 to 2 sentences each.
- `weekly`: rewrite it on Monday (the week before, complete: prices, weather, nuclear, gas, forwards, regulation,
  geopolitics, 2 to 3 sentences each); the other days keep the file's.
- Same text in English in `topic_en` / `text_en`.

Not the same text every day (the owner, 25 Nov. 2026):
- Read `history` first. Do not repeat an idea already written in the last days unless it changed (a new level, a
  reversal, a date that moved): then say what changed (« le vent revient plus tôt que prévu », « EDF repousse… »).
- No fixed list of topics: pick the 2 or 3 things that matter most today. The topics of the example are not a template;
  a quiet day can be 2 topics, a day with a CRE decision or a reversal starts with it.
- Vary the angle: one day the buyer's hedging, another the producer's capture price, the negative hours, a neighbour, the
  month ahead, a regulation's effect on PPAs. Lead with the surprise of the day, not with the spot by habit.
- Do not reuse a sentence of the example or of `history` word for word.
- A day with little change says so in one line and gives the one thing to watch.

Style (the owner's rules): simple French sentences, one idea each; no filler words (toutefois, néanmoins, en effet, par
ailleurs, autrement dit, dans ce contexte); a cause only when the figures or the news give it; never contradict the
figures; prices in €/MWh without decimals, capacity in GW with one decimal, moves in % without decimals; no source or
outlet named, nothing copied.

Example of a day (25 Nov. 2026), for the level of analysis only (not a template):
- Prix : Le spot continue de monter et la France devient plus chère que l'Allemagne. Le froid et le manque de vent
  obligent à faire tourner, aux heures de pointe, des centrales plus chères que le gaz. Le vent ne reviendra que vers le
  10 décembre : ce niveau devrait tenir jusque-là.
- Gaz : Le gaz monte encore (+3 % sur la veille) et les stocks européens sont bas. Si le froid dure, c'est le premier
  risque de nouvelle hausse.
- Couverture : Le Cal 27 bouge à peine : le marché voit une tension de court terme, pas un problème durable. Décembre se
  traite à 203 €, contre 193 € pour l'indice PowerKlock : acheter ce mois aujourd'hui revient à payer environ 10 € de prime.
- À surveiller : 3,8 GW de nucléaire annoncés par EDF manquent encore. Leur retour est le principal facteur de baisse à
  court terme.

## How to publish
Write that one file on `main` (one commit, message `data: newsletter brief <date> (Claude)`), nothing else. If a figure
is missing or a file is late, write without that topic; never invent a figure.
