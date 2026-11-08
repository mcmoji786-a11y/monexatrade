-- Kixo trading wallets (decision 0010).
-- The key is created in the user's browser and locked there with their wallet password
-- (PBKDF2-SHA256 + AES-256-GCM). This table holds only that locked copy, which Kixo
-- cannot open, plus the public address. Only the gateway (service role) reads or writes it.

create table if not exists public.kixo_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pubkey text not null unique,
  -- The locked key: { v, kdf, iterations, salt, iv, ciphertext }, base64 fields.
  locked jsonb not null,
  -- When on, a new device must enter a code sent to the account email before the
  -- locked copy is handed out.
  two_fa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kixo_wallets enable row level security;
-- No policies: browsers never read this table directly, only through the gateway.
revoke all on public.kixo_wallets from anon, authenticated;
