// PowerKlock scheduler (see wrangler.jsonc). Each hour it decides, from the hour in Paris, which GitHub jobs to start:
//   News collection (fetch_news.yml)   weekdays every hour 06:00 to 20:00, weekends every 3 hours
//   Newsletter (morning_mail.yml)      weekdays 07:00 (7 O'Klock), Monday 10:00 (PowerBrunch), with one retry an hour
//                                      later; the job itself sends each edition once a day (data/newsletter_sent.json)
const REPO = 'TomSRemy/PowerKlock';

function paris(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 };
}

export function plan(date) {
  const { hour, day } = paris(date);
  const weekday = day <= 5;
  const jobs = [];
  if (weekday ? hour >= 6 && hour <= 20 : hour % 3 === 0) jobs.push(['fetch_news.yml', {}]);
  if ((weekday && (hour === 7 || hour === 8)) || (day === 1 && (hour === 10 || hour === 11))) jobs.push(['morning_mail.yml', { auto: 'true' }]);
  return jobs;
}

async function dispatch(env, file, inputs) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'powerklock-scheduler',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  const ok = r.status === 204;
  console.log(`${file}: ${ok ? 'started' : `failed ${r.status} ${(await r.text()).slice(0, 200)}`}`);
  return ok;
}

export default {
  async scheduled(event, env) {
    if (!env.GITHUB_TOKEN) { console.log('GITHUB_TOKEN secret missing'); return; }
    for (const [file, inputs] of plan(new Date(event.scheduledTime))) await dispatch(env, file, inputs);
  },
  // opening the Worker's address shows what it would start now, without starting anything
  async fetch() {
    const now = new Date();
    return Response.json({ paris: paris(now), would_start: plan(now).map(([f]) => f) });
  },
};
