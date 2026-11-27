# Newsletter brief: written by Claude every morning

A scheduled Claude task (claude.ai, the owner's account) writes `data/newsletter_brief.json` every day at 05:47 Paris,
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
- `data/news.json`: the news of the last days (titles and summaries), for regulation and geopolitics. Leave out every item marked `"noai": true` (an outlet whose robots.txt refuses AI use, such as AleaSoft): never read, cite or choose it.
- `data/newsletter.json` › `markets`: the tiles of the day.

## When the site has no news on a subject: search the web (the owner, 27 Nov. 2026)
The site's news (`data/news.json`) misses subjects, geopolitics above all (27 Nov. 2026: the Strait of Hormuz attacks
were in the Expert view, from the e-mailed market notes, but in none of the site's news). Search the web every morning:
- always: the geopolitics that move gas, oil or power (Hormuz, Red Sea, Russia and Ukraine, Norway, LNG, sanctions),
  for the last 48 hours;
- each time the Expert view, a price move or a market note names an event that `data/news.json` does not have;
- for a cause the figures alone do not give (a gas jump, an outage, a regulation date).
Keep a fact only when two reputable outlets (press agencies, the business press, an official body) give it, and with
its date. Web figures never replace the site's: prices, forwards, storage and nuclear come from the files above; when the
web gives another level, keep the site's and leave the web's out (say it in your final message). Name no source in the
brief; the web is never used for `articles`, which stay chosen in `data/news.json`. In the final message, list the
subjects found only on the web: the owner adds the searches the news job lacks.

## The Expert view feeds the brief (the owner, 25 Nov. 2026)
Today › Expert is the first source of the brief, not only a check: start from what it shows the same morning (its
computed sentences, its market context, its week-ahead calls), keep its readings, and add what the newsletter brings:
why it moves, what changed since yesterday, how the market reads it. The other files below complete it.

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
`{"asof": "<today, Paris>", "written": "<ISO time>", "daily": [...], "weekly": [...], "history": [...], "articles": [...], "articles_week": [...]}`, each item
`{"topic", "topic_en", "text", "text_en"}`; `history` keeps the `daily` of the last 10 days (`{"asof", "daily"}`, newest
first): add yesterday's, drop the oldest.

- `daily`: a market analyst's reading (the owner, 27 Nov. 2026): what moved, which driver moved it (weather, wind,
  nuclear, gas, carbon, a neighbour, a regulation), whether the curve confirms it (spot against month-ahead and Cal, the
  shape of the curve) and what comes next. One line of reasoning from the first sentence to the last; no advice to a
  buyer or a producer (« pour un acheteur… », « se couvrir coûte… »): the reader draws it. The tiles and charts already give the figures: a number only to support an explanation. 2 to 4 topics,
  1 to 2 sentences each, about 90 words in all (French). The newsletter shows the daily as **one flowing text,
  without the topic names** (the owner, 25 Nov. 2026): write each topic's text so that it follows from the one before,
  as a single paragraph read from start to end; `topic` stays in the file for the order only. This is a guide, not a cap: good French comes first. A
  slightly longer text in full, natural sentences is better than a short one cut down into notes or broken French
  (the owner, 25 Nov. 2026). Cut a topic rather than squeeze the sentences.
- `weekly`: rewrite it on Monday: the week before, complete and longer (prices, weather, nuclear, gas, forwards,
  regulation, geopolitics, 2 to 4 sentences each, about 250 to 350 words, longer if the week needs it), with what it means for the weeks ahead. From
  one week to the next it may repeat a situation that lasts, saying so (« la situation reste la même : … », « le froid
  dure pour la troisième semaine »). The other days keep the file's.
- On Monday also write PowerBrunch's top (the owner's mockup v4, 25 Nov. 2026): `week_title` (the week in one sentence,
  a headline of 8 to 14 words, e.g. « Le spot a fondu de moitié, mais l'hiver revient dès ce lundi »), `week_text` (one or
  two sentences under it), and `week_keys`: three `{"bold", "text"}`, the three things to remember of the week, `bold` a
  few words that say it (« Le spot divisé par deux »), `text` one sentence with the figure or the date.
- Geopolitics: an event with a large effect on prices (gas or oil supply, a strait, a pipeline, sanctions, a conflict
  that moves TTF or Brent) is always in the daily the day it appears or changes, first if it is the day's main move; a
  geopolitical topic without an effect on prices is left out.
- Same text in English in `topic_en` / `text_en`.

Not the same text every day (the owner, 25 Nov. 2026):
- Read `history` first (the daily only; the weekly may repeat, see above). Do not repeat an idea already written in the last days unless it changed (a new level, a
  reversal, a date that moved): then say what changed (« le vent revient plus tôt que prévu », « EDF repousse… »).
- No fixed list of topics: pick the 2 or 3 things that matter most today. The topics of the example are not a template;
  a quiet day can be 2 topics, a day with a CRE decision or a reversal starts with it.
- Vary the angle: one day the curve, another the producers' capture price, the negative hours, a neighbour, the month
  ahead, a fuel, a regulation's effect on prices. Lead with the surprise of the day, not with the spot by habit.
- Every sentence must follow from the one before: no topic that drops in without a link (the owner, 27 Nov. 2026:
  « tombe comme un cheveu sur la soupe »). A sentence the reasoning does not need is cut.
- Do not reuse a sentence of the example or of `history` word for word.
- A day with little change says so in one line and gives the one thing to watch.

Style (the owner's rules): simple French sentences, one idea each; no filler words (toutefois, néanmoins, en effet, par
ailleurs, autrement dit, dans ce contexte); a cause only when the figures or the news give it; never contradict the
figures; prices in €/MWh without decimals, capacity in GW with one decimal, moves in % without decimals; no source or
outlet named, nothing copied.

Example of a day (25 Nov. 2026), for the level of analysis and the flow only (not a template), as the reader sees it:
> Le spot français monte à 255 €/MWh (+4 %) et dépasse l'Allemagne (246 €). À ce niveau, le prix est bien au-dessus
> du coût d'une centrale gaz : le marché est tendu aux heures de pointe. En cause, le froid, qui tire la consommation,
> et un vent faible qui ne reviendra que vers le 10 décembre. Le gaz a pris 9 % en une semaine avec des stocks
> européens sous l'an dernier. Le Cal 27 ne suit pas : le marché ne voit pas cette tension durer. À surveiller, les
> 3,8 GW de nucléaire qu'EDF attend encore, principal facteur de baisse à court terme.

## The articles (the owner, 25 Nov. 2026)
Also write `articles` (every day) and, on Monday, `articles_week`: the newsletter's articles, chosen in `data/news.json`.
- Daily: 10 to 12 articles published since the last edition sent (`data/newsletter_sent.json` › `daily`, sent at
  07:00 Paris that day; on Monday since Friday's), up to now; weekly: 14 to 18 of the last 7 days. Look at every article
  of that window. Cover several subjects: every section that has something useful gets 1 to 3 articles. Leave out only
  the articles already sent (the owner, 27 Nov. 2026): the links of the editions of `data/newsletter_history.json` up to
  the last day sent, and another article on a step already told. The edition built in the night for the site (today's
  key in the history) is not sent: its articles may be chosen. A new step of a story already sent (an amendment filed,
  a decision) is new.
- An article found only on the web (see above) and worth the newsletter is not in `data/news.json`, so it cannot be
  chosen yet: the watch must learn to catch it (see « The watch learns every morning » below), then choose it once the
  news run has brought it.
- `section`, one of: `regulation` (CRE, ministries, Brussels, tenders, support schemes), `markets` (prices, gas,
  geopolitics, carbon), `nuclear_grid` (EDF's fleet, RTE, networks, interconnections), `deals` (PPAs, acquisitions,
  contracts), `projects` (new capacity, storage, renewables), `supply` (suppliers, tariffs, consumers, industry).
- Leave out what does not touch the French or European power and gas business: general climate pieces, consumer tips,
  technical curiosities, adverts.
- Each article: `{"link" (exactly as in news.json), "section", "what", "what_en"}`.
  `what` (« À retenir »): a short description of the article, 1 to 2 sentences, what happens, who, how much, when; no
  analysis, no opinion, no « impact » line (the owner, 25 Nov. 2026). Use only the title and the public summary of
  news.json: never the text of a paid article.

## The watch learns every morning (the owner, 27 Nov. 2026)
Each interesting article or subject found on the web and missing from `data/news.json` is a gap of the watch: fix the
watch so it is caught from then on, every day, not only this morning.
1. Find why it is missing: no search on that subject, an outlet the watch does not read, or a `require` filter that
   rejects its title (`config/news_sources.json`; `scripts/fetch_news.py` › `add_items`).
2. Fix it in `config/news_sources.json`: add a press search in the same form as the others (`q`, `tags`, `lang`), a
   public RSS feed of the outlet (free, robots.txt allowing it), or widen the `require` filter of that outlet. Prefer a
   search on the subject (« Ormuz pétrole navires ») to one on the exact title. Never a paid source, never LinkedIn.
3. Push that file alone (message `News: the watch now catches <subject> (Claude)`): the push starts a news run (about
   10 minutes). Check in the new `data/news.json` that the article is there, then choose it.
4. A gap that needs a change of `scripts/fetch_news.py` (a new kind of source, a scoring that buries the subject) is
   not pushed: describe it in the final message for the owner.
5. Add a line to `config/news_gaps.md` (date, subject, the article missed, the cause, the fix, caught: yes/no), the
   watch's improvement log; when the same gap comes back after a fix, say it in the final message.
If the news run would end after 06:55 Paris, publish the brief without that article and keep the fix: tomorrow's
watch catches it.

## Tools for the checks
The session's container may be new: when `scripts/check_before_push.sh` stops on a missing module, install them with
`pip install -q "playwright==1.63.0" scipy "matplotlib==3.9.2"` (Playwright 1.63 matches the browser already in
`/opt/pw-browsers`) and run it again. Never push a config file with the checks failing.

## How to publish
Write `data/newsletter_brief.json` on `main` (one commit, message `data: newsletter brief <date> (Claude)`). The only
other files the task may change are `config/news_sources.json` and `config/news_gaps.md` (above). If a figure is
missing or a file is late, write without that topic; never invent a figure.
