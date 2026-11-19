-- =====================================================================
-- Ovrix automation schema. Run in Supabase -> SQL Editor, in the NEW "ovrix" project.
-- Run supabase-leads.sql from the website repo FIRST (it creates the `leads` table),
-- then run this file. Safe to re-run.
--
-- SECURITY MODEL
--   * The public website key (publishable/anon) can ONLY insert into `leads`.
--   * Every automation table has RLS on and NO policy for anon/authenticated, and the public roles
--     have no grants, so only the server-side secret (service_role) key can read or write them.
--   * The secret key lives ONLY in automation/.env on your server, never on the website.
-- =====================================================================

-- ---- 1. Extend leads with workflow columns ----------------------------
-- (the website form fills: name, email, service, budget, timeline, source, message, page)
alter table public.leads add column if not exists payment_status   text default 'unpaid';  -- unpaid | deposit_paid | paid
alter table public.leads add column if not exists priority         text default 'normal';
alter table public.leads add column if not exists manager_summary  text;
alter table public.leads add column if not exists assigned_channel text;
alter table public.leads add column if not exists triaged_at       timestamptz;
alter table public.leads add column if not exists client_questions text;
alter table public.leads add column if not exists quote_range      text;
-- status flow: new -> triaging -> awaiting_approval -> approved -> in_progress -> review -> delivered
--              | rejected | triage_failed | needs_attention
create index if not exists leads_status_idx on public.leads(status);

-- ---- 2. Tasks: one row per unit of work given to a specialist agent ---
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  order_id    bigint references public.leads(id) on delete cascade,
  agent       text not null,
  title       text not null,
  details     text,
  status      text default 'proposed',   -- proposed -> approved -> running -> done | failed | rejected
  output      text,                      -- specialist's draft/plan (never auto-sent to clients)
  error       text,
  updated_at  timestamptz default now()
);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_order_idx  on public.tasks(order_id);

-- ---- 3. Agent log: audit trail of everything an agent did ------------
create table if not exists public.agent_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  agent       text not null,
  order_id    bigint,
  task_id     uuid,
  event       text not null,
  detail      jsonb
);
create index if not exists agent_logs_order_idx on public.agent_logs(order_id);

-- ---- 4. Approvals: every human decision, tied to a Discord message ---
create table if not exists public.approvals (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  order_id         bigint references public.leads(id) on delete cascade,
  discord_message  text,
  decision         text,         -- 'approved' | 'rejected'
  decided_by       text,         -- Discord user id
  decided_at       timestamptz
);

-- ---- 5. Payments: verified webhook events from Stripe / Razorpay -----
-- Money truth stays in Stripe/Razorpay. This is only an idempotent inbox of verified events.
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  provider    text not null,                    -- 'stripe' | 'razorpay'
  event_id    text not null unique,             -- provider event id => webhooks are idempotent
  kind        text not null default 'payment',  -- 'payment' | 'refund'
  amount      numeric,
  currency    text,
  email       text,
  reference   text,
  status      text default 'pending'            -- pending -> confirmed | ignored
);
create index if not exists payments_status_idx on public.payments(status);

-- ---- 6. Row Level Security + grants ----------------------------------
alter table public.leads      enable row level security;
alter table public.tasks      enable row level security;
alter table public.agent_logs enable row level security;
alter table public.approvals  enable row level security;
alter table public.payments   enable row level security;

-- This project does not expose new tables automatically, so grant explicitly:
-- the server (service_role) gets everything, the public roles get nothing except INSERT on leads.
revoke all on public.leads, public.tasks, public.agent_logs, public.approvals, public.payments from anon, authenticated;
grant all on public.leads, public.tasks, public.agent_logs, public.approvals, public.payments to service_role;
grant usage, select on all sequences in schema public to service_role;
grant insert on public.leads to anon;

-- leads: the website may INSERT only, and can never set workflow fields itself.
drop policy if exists "website can send briefs" on public.leads;
create policy "website can send briefs" on public.leads
  for insert to anon with check (
    coalesce(status,'new') = 'new'
    and coalesce(payment_status,'unpaid') = 'unpaid'   -- a visitor can't mark their own order paid
    and coalesce(priority,'normal') = 'normal'
    and manager_summary is null
    and assigned_channel is null
    and triaged_at is null
    and client_questions is null
    and quote_range is null
  );

-- tasks / agent_logs / approvals / payments: intentionally NO policies => only service_role can touch them.

-- ---- 7. Verify (use the PUBLIC key; each must return an error or zero rows, never real data) ----
-- select * from leads;      select * from tasks;      select * from payments;
