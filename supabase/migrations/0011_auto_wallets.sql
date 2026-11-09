-- Kixo auto-trade wallets (decision 0014, services/gateway/src/auto_wallet.rs).
-- A second, opt-in wallet per user whose key the server holds, sealed with AES-256-GCM
-- under a master key that is never stored in the database. Money in it can only go
-- back to owner_pubkey (the user's main Kixo wallet), fixed at creation.
-- Only the server (service role) reads or writes it: RLS on, no policies.

create table if not exists public.auto_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pubkey text not null unique check (length(pubkey) between 32 and 44),
  owner_pubkey text not null check (length(owner_pubkey) between 32 and 44),
  -- { v, alg, nonce, ct }: the sealed key. Useless without the master key.
  sealed jsonb not null,
  limits jsonb not null default '{}'::jsonb,
  paused boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auto_wallets enable row level security;
