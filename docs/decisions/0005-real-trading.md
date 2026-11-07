# 0005: Real trading

Date: 2026-11-07. Decided by the founder.

## Decisions

1. **Non-custodial, Phantom only.** The gateway builds the swap transaction and the user signs it in Phantom. Private keys never reach Kixo.
2. **Solana mainnet, real SOL.**
3. **Platform fee is 1%** on buys and sells. This replaces the 0.5% in spec section 19.
   - A buy pays its fee from the SOL spent, before the swap.
   - A sell pays its fee from the SOL received, after the swap. It is charged on the route's guaranteed minimum, so it is never more than 1% of what the user actually gets.
   - The fee is a plain SOL transfer to the fee wallet, shown before signing and stored with every trade.
   - The founder sets the fee wallet in the admin (Features, Real trading). `FEE_WALLET` in `.env` is only a fallback.
4. **Each trade is capped at 3 SOL** on its SOL side.
5. **MEV protection is on by default.** It uses Helius Sender `mev-protect`, and the user can turn it off per trade.
6. **The admin switch `real_trading` is off by default.** Trading opens only when the founder turns it on after the security review and a small live test.

## How a trade runs

1. **Quote.** The trade is built when the user presses Buy or Sell, not while typing. Keyless Jupiter allows about one request every two seconds. The gateway runs `/trade/quote` in this order:
   - Checks the switch, the allowlist and the 3 SOL cap.
   - Checks the wallet's balance.
   - Gets a Jupiter route.
   - Adds a compute budget, a priority fee and a Sender tip.
   - Compiles a v0 transaction (`solana_tx.rs`) and simulates it.
   - A trade that would fail is never offered for signing.
   - When a route fails for a reason that is not the user's, the gateway tries once more without that route's DEXes.
   - The balance check, coin decimals and the route run in parallel. The instructions, the priority fee and the blockhash run in parallel too.
2. **Sign.** The user signs in Phantom. The browser first checks the transaction: the fee payer, the allowed programs and the SOL leaving the wallet.
3. **Send.** `/trade/send` handles it:
   - Accepts only the exact message it built, signed by that wallet. Each build is single use and lasts 50 seconds.
   - Records the trade before sending it.
   - Sends through Helius Sender and the Helius RPC together.
4. **Track.** The gateway polls the status every 400 ms and resends every 2 seconds until the blockhash expires.
   - Before calling a trade expired, it checks the full history once more.
   - Failed trades are explained from their logs.
   - Nothing is retried blindly (spec section 7).

## Our own builders (no router for launchpad coins)

Most radar trades never touch Jupiter. The gateway builds them from chain state with one RPC read (`native_build` in `trade.rs`):

| Venue | Module | How the amount is quoted |
| --- | --- | --- |
| pump.fun bonding curve | `pumpfun_tx.rs` | Constant product on the curve's virtual reserves |
| PumpSwap (graduated pump.fun coins, SOL pools) | `pumpswap_tx.rs` | Constant product on pool balances plus the pool's virtual quote |
| Raydium LaunchLab (bonk.fun) | `launch_tx.rs` | Simulation: a quote-only run reads the exact output |
| Meteora DBC (Bags and others) | `launch_tx.rs` | Simulation, the same way |

The quote-only simulation has no minimum and is never offered for signing. The real transaction carries that exact amount less the slippage, and it is simulated again.

Each builder adds the accounts the live programs expect beyond their IDLs. These were found in real mainnet trades and pinned by unit tests:
- **pump.fun:** `bonding-curve-v2` and a buyback fee recipient.
- **PumpSwap:** `pool-v2`, a buyback recipient and that recipient's wrapped-SOL account.
- **LaunchLab:** the system program and the platform and creator fee vaults.

Everything else falls back to Jupiter:
- pools quoted in another token;
- Meteora pools with transfer hooks;
- migrated curves;
- tokens held outside the wallet's main token account;
- any builder failure that is not the user's.

After simulation the compute limit is set to the units actually used plus 20%. The user pays the priority fee per unit, so this costs less.

The browser check reads each builder's swap data. It confirms the swap is for the user's wallet and goes the right way. On a buy, the SOL spent inside the swap may not exceed the ticket.

## Speed work (2026-11-07)

- **Warm loop while trading is active.** It starts on a signed-in ticket ping (`/trade/prepare`) or a quote and runs for 90 seconds after the last one. Every 6 seconds it keeps these ready:
  - the blockhash (reused for up to 8 to 10 seconds);
  - the priority fee levels;
  - pump.fun's and PumpSwap's configs;
  - warm HTTPS connections to the RPC and to Sender's free `/ping`.

  It is idle when nobody trades, so RPC credits are spent only then.
- **One simulation for launchpad buys.** The real transaction differs from its quote run only in the minimum. Sales are still simulated twice, because they add the unwrap and the fee.
- **Paid plan ready.** `HELIUS_RPC_URL` points the gateway at a paid or dedicated endpoint, and `HELIUS_RPS` raises its pace. No code change is needed.

**Not built: a one-click "Quick Trade" wallet** (signing without Phantom). The founder decided on 2026-11-07 that Kixo will not offer anything that holds or looks like it holds user funds until it has the licence for it. Every trade is approved in Phantom.

## Speeds

| Speed | Sender tip | Priority fee cap |
| --- | --- | --- |
| Fast | 0.000005 SOL, staked connections only | 0.001 SOL |
| Turbo (default) | 0.001 SOL, all Sender paths | 0.003 SOL |

## Requirements before switching on

- **A fee wallet, set in the admin.** Public address only, already holding at least 0.01 SOL. A fee sent to an empty account below rent (0.00089 SOL) would make small trades fail, so the gateway reports trading as not ready until the wallet holds 0.001 SOL. Saving admin changes needs `ADMIN_TOKEN` (16+ characters) in the gateway `.env`.
- **`JUPITER_API_KEY` (optional, free from the Jupiter portal).** Keyless routing allows about 0.5 requests a second.
- **`TRADING_ALLOWLIST` (optional).** A comma-separated list of wallets allowed to trade during the first live tests.
- **Migration `0004_real_trades.sql` applied.**
- **Security review and a small live trade** from the founder's own wallet.

## Testing (2026-11-07, no real funds)

Every check below ran on Solana mainnet with `simulateTransaction`. Nothing was signed or sent.

- **Test harness:** `live_matrix` (an ignored test in `trade.rs`). It builds each trade with the same `assemble` function and v0 compiler as the live endpoint.
- **Trades that passed:**
  - Buy and sell on a graduated pump.fun coin.
  - Buy and sell on two large DEX pools.
  - Buy and sell on BONK.
  - Buy on a pump.fun bonding-curve coin (Token-2022).
- **Failures caught and explained:**
  - Selling more than the wallet holds returns `no_tokens`.
  - A buy from an empty wallet is refused.
- **Browser check (`tx-check.ts`).** It accepted a real Jupiter transaction and rejected four tampered versions:
  - a different payer;
  - SOL spent above what the ticket shows;
  - a wrong fee;
  - SOL leaving the wallet on a sale.

A real signed trade still needs a funded wallet. That is the founder's first live test.

### Builders (2026-11-07, mainnet simulation, nothing signed or sent)

| Venue | Coins | Buy | Sell |
| --- | --- | --- | --- |
| pump.fun curve | 3, including a mayhem-mode coin | All passed | All passed, except a curve with no SOL left, which reports `liquidity` |
| PumpSwap | 4 | All passed | All passed |
| LaunchLab | 1 | Passed | Passed |
| Meteora DBC | 1 | Passed | Not tested: no holder kept tokens in a main token account |

- **Browser check.** It passed on every builder's real transactions. It rejected transactions with a different wallet, a wrong fee, a hidden overspend, or an amount raised inside the swap data. 34 cases in total.
- **Correct fallbacks.** Migrated DBC pools, a non-SOL quote and a transfer-hook pool were each sent to Jupiter.

## Known limits (stage 1)

- **Jupiter keyless rate limit (about 0.5 requests a second, shared by all users).** This now applies only to coins outside our four launchpads. A free key is still recommended.
- **Some bonding-curve coins have no Jupiter route.** One of the coins sampled had none.

- **Coins only minutes old.** Our own builders now cover them on pump.fun, PumpSwap, LaunchLab and DBC. Only other venues still wait for Jupiter to index the mint.
- **Automatic real exits are not possible yet.** Take profit, stop loss and the sniper would need a signature for every trade. They stay demo only.
