-- Kixo orders: limit buys and sells, trailing stops, and the trade sources of the newer
-- features (Quick Buy, limit and trailing orders, grid and copy trading). Additive only:
-- existing take profit and stop loss orders keep working unchanged.

-- 1. Order kinds. 'limit_buy' buys `usd` when the price falls to the trigger;
--    'limit_sell' sells when it rises to it; 'trail' sells when the price falls
--    `trail_pct` below the highest price seen since the order was placed (`peak_price_usd`).
alter table public.demo_orders drop constraint if exists demo_orders_kind_check;
alter table public.demo_orders add constraint demo_orders_kind_check
  check (kind in ('tp', 'sl', 'limit_buy', 'limit_sell', 'trail'));

alter table public.demo_orders add column if not exists usd numeric check (usd is null or usd > 0);
alter table public.demo_orders add column if not exists trail_pct numeric check (trail_pct is null or (trail_pct > 0 and trail_pct < 100));
alter table public.demo_orders add column if not exists peak_price_usd numeric check (peak_price_usd is null or peak_price_usd > 0);
-- Grid and copy orders belong to a strategy; null for single orders.
alter table public.demo_orders add column if not exists strategy text check (strategy is null or char_length(strategy) <= 64);

-- 2. Where a demo trade came from.
alter table public.demo_trades drop constraint if exists demo_trades_source_check;
alter table public.demo_trades add constraint demo_trades_source_check
  check (source in ('manual', 'sniper', 'tp', 'sl', 'limit_buy', 'limit_sell', 'trail', 'quick', 'grid', 'copy'));
