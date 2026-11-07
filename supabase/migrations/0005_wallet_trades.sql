-- MONEXA portfolio history: the swaps of each wallet a portfolio has shown, kept so a
-- trader sees at least their last 30 days, not only the latest 100 transactions the
-- history API returns. These are public on-chain facts; only the gateway (service role)
-- reads and writes the table, browsers get them through the gateway.

create table if not exists public.wallet_trades (
  wallet text not null,
  signature text not null,
  ts timestamptz not null,
  mint text not null,
  symbol text not null default '',
  buy boolean not null,
  -- SOL spent (buy) or received (sell), fees included.
  sol numeric not null,
  -- Token amount in raw units.
  raw numeric not null,
  primary key (wallet, signature)
);
create index if not exists wallet_trades_recent on public.wallet_trades (wallet, ts desc);

alter table public.wallet_trades enable row level security;
-- No policies: nothing is readable or writable from browsers directly.
revoke all on public.wallet_trades from anon, authenticated;
