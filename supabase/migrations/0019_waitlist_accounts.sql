-- Kixo waitlist, version 2 (2026-11-22): people join with a real Kixo account (Google or
-- an email code), the same account they use in the app after launch, not an email
-- address alone. Their number on the list is kept here. Referrals use the app's own
-- codes (profiles.ref_code, profiles.referred_by), so an invite link shared from the
-- waitlist keeps working in the app, and what it brought in shows there.
--
-- The email-only list of version 1 (migration 0010) is retired: founder decision
-- 2026-11-22, "puranii wala sab khatam kardo".
drop table if exists public.waitlist;

create table if not exists public.waitlist_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The order people joined in (1 = first), for the early offers.
  number bigint generated always as identity unique,
  -- Where they came from (utm_source), when the link said.
  source text check (source is null or length(source) <= 64),
  joined_at timestamptz not null default now()
);

-- Users can read their own place; every write goes through the waitlist server with the
-- service role.
alter table public.waitlist_members enable row level security;
drop policy if exists "read own waitlist place" on public.waitlist_members;
create policy "read own waitlist place" on public.waitlist_members
  for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.waitlist_members from anon, authenticated;
