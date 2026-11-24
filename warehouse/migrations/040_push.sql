-- requires: the alert tables (alert_rule, alert_event)
-- Alert notifications on phones (Web Push, js/app.js › PKPush, sw.js, scripts/alerts.py): each device a member turns
-- notifications on for leaves its push subscription here (an address at the browser's push service and its two public
-- keys: nothing that reads the device). The site's own key pair (VAPID) is made once by Actions › Push keys
-- (scripts/push_keys.py): the public key in push_config, the private key in the database's vault, read only by the job
-- that sends the alerts.
create table if not exists public.push_subscription (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now(),
  last_ok    timestamptz
);
alter table public.push_subscription enable row level security;
drop policy if exists "push: own" on public.push_subscription;
create policy "push: own" on public.push_subscription for select using (user_id = auth.uid());
grant select on public.push_subscription to authenticated;

-- a device subscribes or unsubscribes for the signed-in account (a phone that changes account moves with it)
create or replace function public.push_save(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then return false; end if;
  insert into push_subscription (endpoint, user_id, p256dh, auth, ua) values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_ua, 200))
    on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
  return true;
end $$;
create or replace function public.push_drop(p_endpoint text) returns boolean
language sql security definer set search_path = public as $$
  delete from push_subscription where endpoint = p_endpoint and user_id = auth.uid() returning true
$$;
revoke all on function public.push_save(text, text, text, text), public.push_drop(text) from public, anon;
grant execute on function public.push_save(text, text, text, text), public.push_drop(text) to authenticated;

-- the site's public key (the private one stays in vault.secrets, name pk_vapid_private)
create table if not exists public.push_config (k text primary key, v text not null);
alter table public.push_config enable row level security;
drop policy if exists "push config: read" on public.push_config;
create policy "push config: read" on public.push_config for select using (true);
grant select on public.push_config to anon, authenticated;
