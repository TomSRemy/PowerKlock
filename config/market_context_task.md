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

## The Expert view feeds the brief (the owner, 25 Nov. 2026)
Today › Expert is the first source of the brief, not only a check: start from what it shows the same morning (its
computed sentences, its market context, its week-ahead calls), keep its readings, and add what the newsletter brings:
why it moves, what changed since yesterday, what it means for a buyer or a producer. The other files below complete it.

## Never against the Expert view
The newsletter and Today › Expert are read by the same people: the brief never says the opposite of what the Expert
view shows the same morning. Before writing, read what it shows:
- its computed sentences, the same as the site's (spot, Cal against gas alone, weather, nuclear, gas, carbon):
  `python3 -I -c "import sys; sys.path.insert(0, 'scripts'); import news_letter as n; print(n.expert_brief('<today>'))"`
  from the repository's root (with a clone; with the GitHub tools only, compute them from the same files);
- its market context and week-ahead calls in `data/market_digest.json` (`context`, `outlook`: tone up / down / flat).
Then check each sentence of the brief against them: same direction for each market (a market shown rising is not
« en baisse »), same cause where the Expert view gives one (if it says « nucléaire et demande détendus » on the Cal,
do not write that demand drives the Cal up). When the figures disagree with an Expert sentence, leave that point out
rather than contradict it, and say why in your final message so the owner can fix the site. Say the horizon of a move
(« sur la veille », « depuis trois jours », « sur la semaine »): the Expert view's « stable sur la semaine » compares two
7-day averages, and a three-day rise inside it is not a contradiction once the horizon is written.

## What to write
`{"asof": "<today, Paris>", "written": "<ISO time>", "daily": [...], "weekly": [...], "history": [...]}`, each item
`{"topic", "topic_en", "text", "text_en"}`; `history` keeps the `daily` of the last 10 days (`{"asof", "daily"}`, newest
first): add yesterday's, drop the oldest.

- `daily`: short and analytical. What changed since yesterday, why, and what it means for a buyer or a producer
  (hedging, PPA). The tiles and charts already give the figures: a number only to support an explanation. 2 to 4 topics,
  1 to 2 sentences each, about 90 words in all (French). This is a guide, not a cap: good French comes first. A
  slightly longer text in full, natural sentences is better than a short one cut down into notes or broken French
  (the owner, 25 Nov. 2026). Cut a topic rather than squeeze the sentences.
- `weekly`: rewrite it on Monday: the week before, complete and longer (prices, weather, nuclear, gas, forwards,
  regulation, geopolitics, 2 to 4 sentences each, about 250 to 350 words, longer if the week needs it), with what it means for the weeks ahead. From
  one week to the next it may repeat a situation that lasts, saying so (« la situation reste la même : … », « le froid
  dure pour la troisième semaine »). The other days keep the file's.
- Geopolitics: an event with a large effect on prices (gas or oil supply, a strait, a pipeline, sanctions, a conflict
  that moves TTF or Brent) is always in the daily the day it appears or changes, first if it is the day's main move; a
  geopolitical topic without an effect on prices is left out.
- Same text in English in `topic_en` / `text_en`.

Not the same text every day (the owner, 25 Nov. 2026):
- Read `history` first (the daily only; the weekly may repeat, see above). Do not repeat an idea already written in the last days unless it changed (a new level, a
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
- Prix : Le spot monte pour le troisième jour (+4 % sur la veille) et la France devient plus chère que l'Allemagne. Le froid et le manque de vent
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
