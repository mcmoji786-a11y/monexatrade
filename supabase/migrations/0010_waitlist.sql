-- Kixo waitlist (apps/waitlist): emails collected before launch, with a referral code
-- each, so people can move up the list by inviting friends.
-- Only the server (service role) reads or writes it: RLS on, no policies.

create table if not exists public.waitlist (
  id bigserial primary key,
  email text not null unique check (email = lower(email) and length(email) between 5 and 254),
  code text not null unique check (code ~ '^[a-z0-9]{6,12}$'),
  referred_by text references public.waitlist (code) on delete set null,
  source text check (source is null or length(source) <= 64),
  created_at timestamptz not null default now()
);

create index if not exists waitlist_referred_by on public.waitlist (referred_by);

alter table public.waitlist enable row level security;
