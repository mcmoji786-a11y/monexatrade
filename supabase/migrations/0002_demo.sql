-- MONEXA demo trading: a virtual balance per user, open positions and every trade.
-- Prices and fills are computed by the gateway from live market data; this file only
-- stores them. Users can read their own rows; all writes go through demo_fill and
-- demo_reset, which only the gateway (service role) may call.

create table if not exists public.demo_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cash_usd numeric not null check (cash_usd >= 0),
  start_usd numeric not null,
  resets int not null default 0,
  created_at timestamptz not null default now(),
  reset_at timestamptz
);

create table if not exists public.demo_positions (
  user_id uuid not null references auth.users (id) on delete cascade,
  mint text not null,
  symbol text not null default '',
  tokens numeric not null check (tokens > 0),
  cost_usd numeric not null,
  opened_at timestamptz not null default now(),
  primary key (user_id, mint)
);

create table if not exists public.demo_trades (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mint text not null,
  symbol text not null default '',
  side text not null check (side in ('buy', 'sell')),
  tokens numeric not null,
  usd numeric not null,
  sol numeric not null,
  price_usd numeric not null,
  fee_usd numeric not null,
  impact_pct numeric not null,
  source text not null default 'manual' check (source in ('manual', 'sniper')),
  realized_usd numeric,
  round int not null default 0,
  ts timestamptz not null default now()
);
create index if not exists demo_trades_user_ts on public.demo_trades (user_id, ts desc);

alter table public.demo_accounts enable row level security;
alter table public.demo_positions enable row level security;
alter table public.demo_trades enable row level security;

drop policy if exists "read own demo account" on public.demo_accounts;
create policy "read own demo account" on public.demo_accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "read own demo positions" on public.demo_positions;
create policy "read own demo positions" on public.demo_positions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "read own demo trades" on public.demo_trades;
create policy "read own demo trades" on public.demo_trades for select to authenticated using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.demo_accounts, public.demo_positions, public.demo_trades from anon, authenticated;

-- One fill, all or nothing: balance, position and trade history change together.
create or replace function public.demo_fill(
  p_user uuid, p_mint text, p_symbol text, p_side text, p_tokens numeric, p_usd numeric,
  p_sol numeric, p_price_usd numeric, p_fee_usd numeric, p_impact numeric, p_source text, p_start numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acc public.demo_accounts;
  pos public.demo_positions;
  frac numeric;
  realized numeric := null;
begin
  insert into public.demo_accounts (user_id, cash_usd, start_usd) values (p_user, p_start, p_start) on conflict do nothing;
  select * into acc from public.demo_accounts where user_id = p_user for update;
  if p_tokens <= 0 or p_usd < 0 then raise exception 'invalid order'; end if;
  if p_side = 'buy' then
    if acc.cash_usd < p_usd then raise exception 'insufficient demo balance'; end if;
    update public.demo_accounts set cash_usd = cash_usd - p_usd where user_id = p_user;
    insert into public.demo_positions (user_id, mint, symbol, tokens, cost_usd) values (p_user, p_mint, p_symbol, p_tokens, p_usd)
      on conflict (user_id, mint) do update set tokens = demo_positions.tokens + excluded.tokens, cost_usd = demo_positions.cost_usd + excluded.cost_usd, symbol = excluded.symbol;
  elsif p_side = 'sell' then
    select * into pos from public.demo_positions where user_id = p_user and mint = p_mint for update;
    if not found or pos.tokens < p_tokens * 0.999999 then raise exception 'not enough tokens'; end if;
    frac := least(1, p_tokens / pos.tokens);
    realized := p_usd - pos.cost_usd * frac;
    update public.demo_accounts set cash_usd = cash_usd + p_usd where user_id = p_user;
    if frac >= 0.999999 then
      delete from public.demo_positions where user_id = p_user and mint = p_mint;
    else
      update public.demo_positions set tokens = tokens - p_tokens, cost_usd = cost_usd * (1 - frac) where user_id = p_user and mint = p_mint;
    end if;
  else
    raise exception 'invalid side';
  end if;
  insert into public.demo_trades (user_id, mint, symbol, side, tokens, usd, sol, price_usd, fee_usd, impact_pct, source, realized_usd, round)
    values (p_user, p_mint, p_symbol, p_side, p_tokens, p_usd, p_sol, p_price_usd, p_fee_usd, p_impact, p_source, realized, acc.resets);
  return jsonb_build_object('cash_usd', (select cash_usd from public.demo_accounts where user_id = p_user), 'realized_usd', realized);
end $$;

-- Start again: positions cleared, balance back to the start. Trades are kept, tagged
-- with their round, so past rounds can still be analysed.
create or replace function public.demo_reset(p_user uuid, p_start numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.demo_accounts (user_id, cash_usd, start_usd) values (p_user, p_start, p_start)
    on conflict (user_id) do update set cash_usd = p_start, start_usd = p_start, resets = demo_accounts.resets + 1, reset_at = now();
  delete from public.demo_positions where user_id = p_user;
end $$;

revoke execute on function public.demo_fill(uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric) from public, anon, authenticated;
revoke execute on function public.demo_reset(uuid, numeric) from public, anon, authenticated;
