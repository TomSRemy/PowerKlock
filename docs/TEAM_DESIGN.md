# PowerKlock for a team of ten — design proposal

Status: **proposal, nothing implemented**. Written 2026-10-19 for review.
Everything here builds on what exists: Supabase accounts (e-mail link
sign-in), `public.user_dashboards`, the chart catalogue (`js/widgets.js`),
the warehouse (`warehouse/`).

## 1. Goals

1. Several people use the same numbers and see the same context.
2. Work is shared without copy-paste: dashboards, notes on charts, alerts.
3. Nothing internal is exposed on a public URL.
4. It stays maintainable by one person and cheap (free tiers where possible).

## 2. Access

| Question | Proposal |
|---|---|
| Who can sign in? | Allow-list of e-mail domains (company domain) + explicit invitations. Supabase: disable open sign-up, invite users from the dashboard or an `invites` table. |
| Roles | `admin` (manages members, team dashboards, alert channels), `editor` (creates team dashboards and annotations), `viewer` (reads, keeps personal dashboards). Stored in `public.team_member.role`. |
| Is the site private? | Today it is public (GitHub Pages). Public market data is fine there; team notes, annotations and shared dashboards live in Supabase behind sign-in and RLS, so they are never in the public files. If the whole site must be private: Cloudflare Pages + Cloudflare Access (free up to 50 users) in front of the same static files. |
| Sign-in e-mails | Supabase's built-in mailer sends a few e-mails per hour. Before onboarding ten people: custom SMTP (Resend or Brevo, free at this volume). |

## 3. Data model (Supabase, all with row-level security)

```sql
-- members and roles
create table public.team_member (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','editor','viewer')) default 'viewer',
  created_at timestamptz not null default now()
);

-- dashboards: personal (owner only) or shared with the team
create table public.dashboard (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  name text not null,
  layout jsonb not null,               -- same item format as js/dashboard.js
  visibility text not null check (visibility in ('private','team')) default 'private',
  is_template boolean not null default false,
  updated_at timestamptz not null default now()
);

-- annotations: a dated note attached to a zone / chart, visible to the team
create table public.annotation (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users,
  day date not null,                   -- or a range: day_from / day_to
  zone text,                           -- FR, DE_LU… null = market-wide
  widget_id text,                      -- catalogue id, null = every chart of that zone
  text text not null check (length(text) <= 500),
  created_at timestamptz not null default now()
);

-- alerts: rule + channel; evaluated server-side after each data fetch
create table public.alert_rule (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  kind text not null,                  -- price_above, price_below, negative_hours, spread_tb2, css_below…
  zone text not null,
  threshold double precision,
  channel text not null check (channel in ('email','teams','slack')),
  active boolean not null default true
);
create table public.alert_event (
  id bigserial primary key,
  rule_id uuid references public.alert_rule on delete cascade,
  day date not null,
  value double precision,
  sent_at timestamptz
);
```

RLS in one line each: members read everything with `visibility = 'team'`
and their own private rows; only owners (or admins) update/delete; viewers
cannot insert team dashboards or annotations.

Migration from today: `public.user_dashboards` (one JSON blob per user)
is split into `dashboard` rows on first sign-in after the release; the old
table is kept read-only for one release.

## 4. Features, in delivery order

1. **Team dashboards** — "Share with team" switch on a dashboard; a *Team*
   tab lists shared ones; editors can mark one as a template (shown in
   *New dashboard*). Personal copies stay possible ("Duplicate").
2. **Annotations** — on any catalogue chart: click a day → add a note
   ("Flamanville 2 trip", "Strike at RTE"). Drawn as a small marker on the
   time axis of every chart showing that zone and day; listed on a
   *Market log* page. This is the team's memory of why prices moved.
3. **Alerts** — rules per user evaluated by a GitHub Action (or Supabase
   Edge Function) right after each fetch: day-ahead above / below a level,
   negative hours, TB2 spread, clean spark below zero, data source late
   (reuses `js/status.js` logic server-side). Delivery: e-mail first, then
   Teams/Slack incoming webhook (one per team, stored by an admin).
4. **Morning brief** — 07:30 Paris e-mail/Teams post generated from the
   warehouse: D+1 prices vs D, forwards move, fuels, nuclear availability,
   largest anomalies, open data issues. Optional short narrative by Claude
   through the existing AI proxy once that proxy requires a signed-in user.
5. **Ask Claude in the site** — a panel that sends the question plus the
   warehouse schema to Claude through the proxy, returns SQL + answer.
   Needs: proxy accepting only Supabase-authenticated users, a per-user
   daily quota, read-only database role for the generated SQL.

## 5. Security notes

- The AI proxy (`powerklock-ai.tom-s-remy.workers.dev`) currently accepts
  any caller that sends the site's Origin header (spoofable outside a
  browser): anyone can spend the API credits. Before team rollout: verify
  the Supabase JWT in the Worker, rate-limit per user, cap tokens.
- Webhook URLs (Teams/Slack) and SMTP keys live in Supabase secrets or
  GitHub secrets, never in the static files.
- Warehouse access for people and BI tools: one login role per person in
  `pk_reader` (see `warehouse/README.md`).

## 6. Effort (indicative)

| Block | Size |
|---|---|
| Access (allow-list, roles, SMTP) | small — mostly configuration |
| Team dashboards + migration | medium |
| Annotations (store, markers on charts, log page) | medium |
| Alerts (rules UI, evaluator, e-mail/Teams) | medium–large |
| Morning brief | small once alerts' evaluator exists |
| Ask Claude in the site | medium, after the proxy is secured |

## 7. Decisions needed

1. Company e-mail domain(s) for the allow-list; who is admin.
2. Whole site private (Cloudflare Access) or public data + private team layer.
3. Alert channel: e-mail only, or Teams / Slack (which one).
4. Data licences before any commercial use: Open-Meteo (commercial plan or
   another source); confirm the Energy-Charts CC BY attribution placement.
