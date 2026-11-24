// PowerKlock scheduler (see wrangler.jsonc): woken every minute by Cloudflare, it starts the GitHub jobs due that
// minute according to schedule.json (UTC or Paris times), through GitHub's "run workflow" API.
import SCHEDULE from './schedule.json' with { type: 'json' };

const REPO = 'TomSRemy/PowerKlock';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// minute, hour, day of month, month, day of week (0 = Sunday) of an instant, in UTC or in Paris
export function fields(date, zone) {
  if (zone === 'utc') return [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', minute: 'numeric', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric', weekday: 'short',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return [Number(p.minute), Number(p.hour), Number(p.day), Number(p.month), DAYS.indexOf(p.weekday)];
}

// one cron field ("*", "5", "1-5", "*/3", "1-22/3", "6,16") against a value
function part(spec, v, lo, hi) {
  const one = (x) => spec.split(',').some((s) => {
    const [range, step] = s.split('/');
    const [a, b0] = range === '*' ? [lo, hi] : range.split('-').map(Number);
    const b = b0 === undefined ? (step ? hi : a) : b0;
    return x >= a && x <= b && (x - a) % Number(step || 1) === 0;
  });
  return one(v) || (hi === 7 && v === 0 && one(7));   // day of week: 7 is Sunday too
}

// standard cron: when both day of month and day of week are restricted, either one matching is enough
export function matches(cron, f) {
  const [mi, h, dom, mon, dow] = cron.trim().split(/\s+/);
  const d1 = part(dom, f[2], 1, 31), d2 = part(dow, f[4], 0, 7);
  const day = dom === '*' || dow === '*' ? d1 && d2 : d1 || d2;
  return part(mi, f[0], 0, 59) && part(h, f[1], 0, 23) && part(mon, f[3], 1, 12) && day;
}

// the jobs due at this minute: [workflow, inputs]
export function due(date) {
  const z = { utc: fields(date, 'utc'), paris: fields(date, 'paris') };
  const out = [];
  for (const j of SCHEDULE.jobs) {
    for (const zone of ['utc', 'paris']) {
      const hit = (j[zone] || []).find((c) => matches(c, z[zone]));
      if (hit && !out.some(([w]) => w === j.workflow)) out.push([j.workflow, { ...(j.inputs || {}), ...(j.pass_cron ? { cron: hit } : {}) }]);
    }
  }
  return out;
}

const gh = (env, path, init = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'powerklock-scheduler', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  },
});

async function dispatch(env, file, inputs, slot) {
  // Cloudflare may, rarely, wake the Worker twice for the same minute: a job already started for this minute is not started again
  try {
    const r = await gh(env, `/actions/workflows/${file}/runs?event=workflow_dispatch&per_page=1`);
    const last = r.ok ? (await r.json()).workflow_runs?.[0] : null;
    if (last && new Date(last.created_at) >= slot) { console.log(`${file}: already started this minute`); return; }
  } catch { /* the check is a nicety: start the job anyway */ }
  for (let i = 0; i < 3; i++) {
    const r = await gh(env, `/actions/workflows/${file}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });
    if (r.status === 204) { console.log(`${file}: started ${JSON.stringify(inputs)}`); return; }
    const msg = (await r.text()).slice(0, 200);
    console.error(`${file}: failed ${r.status} ${msg}`);
    if (r.status < 500 && r.status !== 429) return;   // a wrong token or input will not fix itself
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
}

export default {
  async scheduled(event, env) {
    if (!env.GITHUB_TOKEN) { console.error('GITHUB_TOKEN secret missing: nothing started'); return; }
    const slot = new Date(Math.floor(event.scheduledTime / 60000) * 60000);
    await Promise.all(due(slot).map(([file, inputs]) => dispatch(env, file, inputs, slot)));
  },
  // the Worker's address shows the time it reads and the jobs of the coming hour, without starting anything
  async fetch(request, env) {
    const now = new Date(Math.floor(Date.now() / 60000) * 60000);
    const next = [];
    for (let m = 0; m < 60; m++) {
      const t = new Date(now.getTime() + m * 60000);
      for (const [w] of due(t)) next.push(`${t.toISOString().slice(11, 16)} UTC  ${w}`);
    }
    return Response.json({ utc: now.toISOString(), paris: fields(now, 'paris'), token: Boolean(env.GITHUB_TOKEN), next_hour: next });
  },
};
