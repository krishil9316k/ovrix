-- =====================================================================
-- Ovrix service agents on Vercel: database wiring. Run AFTER ops/schema.sql, in the "ovrix" project.
-- Safe to re-run.
--   * a new brief in `leads` immediately calls /api/ops/tick (Manager agent)
--   * every 5 min: catch-up tick; every 30 min: watchdog checks; 9:00 AM IST: daily digest
--   * calls carry a random secret that only the database and Vercel know
-- =====================================================================
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---- private settings (no public access at all) ----
create table if not exists public.ops_config (key text primary key, value text not null);
alter table public.ops_config enable row level security;
revoke all on public.ops_config from anon, authenticated;
insert into public.ops_config (key, value) values
  ('site_url', 'https://ovrix-kappo.vercel.app'),
  ('ops_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ---- small key/value memory for the agents (watchdog alert state) ----
create table if not exists public.ops_state (key text primary key, value jsonb, updated_at timestamptz default now());
alter table public.ops_state enable row level security;
revoke all on public.ops_state from anon, authenticated;
grant all on public.ops_state to service_role;

-- ---- call one of our Vercel functions ----
create or replace function public.ops_call(path text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s text; u text;
begin
  select value into s from public.ops_config where key = 'ops_secret';
  select value into u from public.ops_config where key = 'site_url';
  if s is null or u is null then return; end if;
  perform net.http_post(
    url := u || '/api/ops/' || path,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ops-secret', s),
    timeout_milliseconds := 55000
  );
end $$;
revoke all on function public.ops_call(text) from public, anon, authenticated;

-- ---- new brief -> Manager right away ----
create or replace function public.ops_on_new_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.ops_call('tick');
  return null;
end $$;
revoke all on function public.ops_on_new_lead() from public, anon, authenticated;
drop trigger if exists ops_new_lead on public.leads;
create trigger ops_new_lead after insert on public.leads for each statement execute function public.ops_on_new_lead();

-- ---- schedules (UTC): 9:00 AM IST = 03:30 UTC ----
select cron.unschedule(jobid) from cron.job where jobname in ('ovrix-tick', 'ovrix-watchdog', 'ovrix-digest');
select cron.schedule('ovrix-tick',     '*/5 * * * *',  $$ select public.ops_call('tick') $$);
select cron.schedule('ovrix-watchdog', '*/30 * * * *', $$ select public.ops_call('watchdog') $$);
select cron.schedule('ovrix-digest',   '30 3 * * *',   $$ select public.ops_call('watchdog?digest=1') $$);
