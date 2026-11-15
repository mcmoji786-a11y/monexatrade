-- Kixo demo perps: long or short with leverage on Hyperliquid's live prices, paid from
-- the same demo balance as spot trading. Isolated margin: a position can lose at most its
-- margin. Prices, fees, funding and liquidation are computed by the gateway (perps.rs);
-- this file only stores them, and only the gateway (service role) may call it.

create table if not exists public.demo_perps (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  coin text not null check (length(coin) between 1 and 20),
  side text not null check (side in ('long', 'short')),
  leverage numeric not null check (leverage >= 1 and leverage <= 50),
  margin_usd numeric not null check (margin_usd > 0),
  size numeric not null check (size > 0),
  entry_px numeric not null check (entry_px > 0),
  liq_px numeric not null check (liq_px > 0),
  open_fee_usd numeric not null default 0,
  opened_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'closed', 'liquidated')),
  exit_px numeric,
  close_fee_usd numeric,
  funding_usd numeric,
  pnl_usd numeric,
  closed_at timestamptz
);
create index if not exists demo_perps_user on public.demo_perps (user_id, status, id desc);
create index if not exists demo_perps_open on public.demo_perps (status) where status = 'open';

alter table public.demo_perps enable row level security;
revoke all on public.demo_perps from anon, authenticated;

-- Opens a position: margin and the opening fee leave the demo cash in one step.
create or replace function public.demo_perp_open(
  p_user uuid, p_coin text, p_side text, p_leverage numeric, p_margin numeric, p_size numeric,
  p_entry numeric, p_liq numeric, p_fee numeric, p_start numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  acc public.demo_accounts;
  new_id bigint;
begin
  insert into public.demo_accounts (user_id, cash_usd, start_usd) values (p_user, p_start, p_start) on conflict do nothing;
  select * into acc from public.demo_accounts where user_id = p_user for update;
  if acc.cash_usd < p_margin + p_fee then
    raise exception 'not enough demo balance';
  end if;
  update public.demo_accounts set cash_usd = cash_usd - p_margin - p_fee where user_id = p_user;
  insert into public.demo_perps (user_id, coin, side, leverage, margin_usd, size, entry_px, liq_px, open_fee_usd)
  values (p_user, p_coin, p_side, p_leverage, p_margin, p_size, p_entry, p_liq, p_fee)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'cash_usd', acc.cash_usd - p_margin - p_fee);
end $$;

-- Closes a position (or liquidates it): margin plus profit, minus the closing fee and
-- funding, goes back to cash. Isolated margin: never less than zero comes back. The
-- recorded profit counts both fees.
create or replace function public.demo_perp_close(
  p_user uuid, p_id bigint, p_exit numeric, p_fee numeric, p_funding numeric, p_status text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pos public.demo_perps;
  pnl numeric;
  back numeric;
begin
  select * into pos from public.demo_perps where id = p_id and user_id = p_user and status = 'open' for update;
  if not found then
    raise exception 'position not open';
  end if;
  pnl := (p_exit - pos.entry_px) * pos.size * (case when pos.side = 'long' then 1 else -1 end);
  if p_status = 'liquidated' then
    back := 0;
    pnl := -pos.margin_usd - pos.open_fee_usd;
  else
    back := greatest(0, pos.margin_usd + pnl - p_fee - p_funding);
    pnl := back - pos.margin_usd - pos.open_fee_usd;
  end if;
  update public.demo_accounts set cash_usd = cash_usd + back where user_id = p_user;
  update public.demo_perps
    set status = p_status, exit_px = p_exit, close_fee_usd = p_fee, funding_usd = p_funding, pnl_usd = pnl, closed_at = now()
    where id = p_id;
  return jsonb_build_object('pnl_usd', pnl, 'returned_usd', back);
end $$;

revoke execute on function public.demo_perp_open(uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.demo_perp_close(uuid, bigint, numeric, numeric, numeric, text) from public, anon, authenticated;
