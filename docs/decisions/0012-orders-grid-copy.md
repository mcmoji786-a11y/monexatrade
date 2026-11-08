# 0012: Orders, grid and copy trading run the same on demo and real

Date: 2026-11-08. Decided by the founder; built the same day.

## Decision

- Every trading feature behaves the same on demo and real: same card, same rules, same
  trigger price. One trade path (`apps/web/src/lib/execute.ts`) places every buy and sell.
- Real automatic trading (limit orders, stop loss, trailing stop, grid, copy trading)
  runs **only while Kixo is open in the user's browser**, signed with the unlocked
  Kixo wallet. No pre-signed or server-held orders: the key never leaves the browser
  (decision 0010).
- Demo orders (limit buy and sell, take profit, stop loss, trailing) are watched by the
  gateway around the clock. Demo grids and copies run in the browser like real ones.
- Both engines fire on the same price: `GET /price`, the price the demo engine fills at.
- Copy trading starts on demo. A copy moves to real only after 5 closed copies in profit,
  and never for a wallet whose followers lose while it wins (exit liquidity).

## Built

- Wallet labels (dev, sniper, bundler by slot, whale, smart money) and a Track button on
  every wallet address; Show filter on the trade page.
- Quick Buy on Discover and Sol Radar.
- Orders card on the trade page; `supabase/migrations/0009_orders.sql` adds the newer
  demo order kinds (limit buy, trailing) and trade sources. Until it is applied, those
  two answer with a clear message.
- Grid trading on the trade page.
- Copy trading on Smart Money: backtest, safety filter, consensus, copy cost, auto-pause,
  mirror sells.
- Streamer mode (Shift+S): balances, P&L and own wallet address blurred for videos.

Each has an admin switch.
