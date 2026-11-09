# 0014: Automatic trading runs 24/7 from an auto-trade wallet

Date: 2026-11-09. Decided by the founder; replaces the "only while Kixo is open" rule of
decision 0012 for real money.

## Decision
- Real automatic trading (orders, grid, copy, sniper, the AI agent) runs **24/7 on the
  server**, like competitors, because a stop loss that does not fire overnight loses users.
- It runs from a **second, opt-in auto-trade wallet** whose key the server holds. The main
  Kixo wallet (decision 0010) does not change: its key never leaves the browser.
- Safety rules, enforced by the server whatever a caller asks:
  - the key is made from the OS random source, sealed with AES-256-GCM under
    `AUTO_WALLET_KEY` (a cloud key vault in production) and bound to its owner and address;
    opened only in memory to sign, never logged or returned;
  - SOL leaves the auto wallet **only to the owner's main Kixo wallet**, fixed at creation;
  - trading only through Kixo's own swap routes, within the owner's limits (max per trade,
    daily loss limit, minimum safety score, max slippage); a cap on what it may hold
    (`AUTO_WALLET_MAX_SOL`, 10 SOL by default); one switch pauses everything;
  - new auto wallets start paused.
- Everything stays behind the `real_trading` switch and an outside security review.

## Stages
1. **Built:** the wallet (create, seal, limits, pause, withdraw only to the main wallet,
   free moves from the main wallet), migration `0011_auto_wallets.sql`, admin switch
   `auto_wallet`, Portfolio card.
2. The 24/7 engine for real orders (limit, TP/SL, trailing), on the demo engine's loop.
3. Grid, copy trading and the sniper on the server.
4. The AI agent on the same engine.

## Before real money
- `AUTO_WALLET_KEY` backed up safely; moved to a key vault at launch. Losing it loses access
  to every auto wallet.
- Security review by an outside auditor; lawyer on custody rules and updated Terms/Privacy.
