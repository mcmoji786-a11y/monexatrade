-- MONEXA accounts: one row per signed-in user, holding the wallet they proved they own.
-- Writes happen only in the gateway with the service role; users can read their own row.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  wallet text unique check (wallet is null or (length(wallet) between 32 and 44)),
  wallet_verified_at timestamptz,
  login_method text check (login_method in ('google', 'email', 'phantom')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- No insert/update/delete policies: browsers cannot write; the service role bypasses RLS.
revoke insert, update, delete on public.profiles from anon, authenticated;
