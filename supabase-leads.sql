-- Ovrix: table for contact-form briefs. Run once in Supabase → SQL Editor → New query → Run.
create table if not exists public.leads (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null check (char_length(email) between 3 and 200),
  service    text check (char_length(service) <= 80),
  budget     text check (char_length(budget) <= 40),
  timeline   text check (char_length(timeline) <= 40),
  source     text check (char_length(source) <= 40),
  message    text check (char_length(message) <= 5000),
  page       text check (char_length(page) <= 100),
  status     text not null default 'new'
);

-- Security: the website may only ADD briefs. Nobody can read, edit or delete them
-- through the public key. You read them in the Supabase dashboard (Table Editor → leads).
alter table public.leads enable row level security;
-- this project does not expose new tables automatically, so allow the website (anon) to INSERT only
revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon;
drop policy if exists "website can send briefs" on public.leads;
create policy "website can send briefs" on public.leads
  for insert to anon
  with check (status = 'new');
