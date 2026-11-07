-- MONEXA real trading: one row per trade a user signed in their own wallet and the
-- gateway sent. Kept permanently (decision 0001: trades, fees and history are never
-- pruned), so a deleted account keeps its rows with the user cleared.
-- Users read their own rows; only the gateway (service role) writes.

create table if not exists public.real_trades (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  wallet text not null,
  mint text not null,
  symbol text not null default '',
  side text not null check (side in ('buy', 'sell')),
  signature text not null unique,
  status text not null default 'sent' check (status in ('sent', 'confirmed', 'failed', 'expired')),
  -- Buy: SOL spent including the platform fee. Sell: SOL expected out. Lamports.
  sol_lamports numeric not null,
  -- Tokens expected (buy) or sold (sell), raw units.
  token_amount numeric not null,
  -- Guaranteed minimum from the route: tokens for a buy, lamports for a sell.
  min_out numeric not null,
  platform_fee_lamports bigint not null,
  priority_fee_lamports bigint not null,
  tip_lamports bigint not null,
  slippage_bps int not null,
  speed text not null,
  mev boolean not null,
  route text not null default '',
  -- What actually happened on chain, read back after it landed.
  sol_change_lamports bigint,
  token_change numeric,
  slot bigint,
  latency_ms int,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists real_trades_user on public.real_trades (user_id, created_at desc);
create index if not exists real_trades_open on public.real_trades (status) where status = 'sent';

alter table public.real_trades enable row level security;
drop policy if exists "read own real trades" on public.real_trades;
create policy "read own real trades" on public.real_trades for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.real_trades from anon, authenticated;
