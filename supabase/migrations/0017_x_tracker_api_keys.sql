-- X Tracker and the Kixo AI developer API.

-- X Tracker: the X accounts a user follows for contract-address posts (handles, no @).
-- Alerts go to the same channels as the other alerts (user_alerts).
alter table public.user_alerts add column if not exists x_accounts jsonb not null default '[]'::jsonb;

-- Developer API keys. Only a SHA-256 hash of each key is stored; the key itself is shown
-- to its owner once, when made. The gateway (devapi.rs) is the only reader.
create table if not exists public.api_keys (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '' check (length(name) <= 40),
  -- The first characters of the key, to tell keys apart ("kixo_3f9a…").
  prefix text not null check (length(prefix) between 8 and 16),
  key_hash text not null unique check (length(key_hash) = 64),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_keys_user on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
