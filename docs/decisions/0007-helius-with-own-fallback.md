# 0007: Helius first, Kixo's own fallback behind it

Date: 2026-11-08. Decided by the founder after the Helius free quota ran out and Sol Radar stopped.

## Decision

Helius stays the main Solana connection. Kixo also has its own fallback, so the platform
keeps running (more slowly) whenever Helius is down or its quota is used up. Kixo does not
run its own Solana node yet. One costs about $1,000 to $2,500 a month and can be added
later as one more node in the list.

## How it works

- **RPC router** (`services/gateway/src/rpc_router.rs`): every RPC call goes through a
  local router that listens on 127.0.0.1 only. It tries Helius first. On "max usage" it
  skips Helius for 15 minutes; on rate limits and server errors, for a few seconds. It
  then uses `FALLBACK_RPC_URLS`, or Solana's public node when that is empty. It probes
  Helius every minute and returns to it. `/health` shows which node serves.
- **Live stream** (`services/ingest/src/lib.rs`): Helius WebSocket first, then
  `FALLBACK_WS_URLS` or the public node.
  - The public node closes a connection after 100 subscription attempts. On a fallback
    node the engine therefore opens one subscription to the whole pump.fun program and
    keeps only the trades of tracked coins.
  - It returns to Helius when Helius answers again.
- **Replacements for Helius-only services:**

  | Helius service | Fallback |
  |---|---|
  | `getAsset` | Token-2022 and Metaplex metadata read from the chain |
  | `getPriorityFeeEstimate` | `getRecentPrioritizationFees` per program (the speed floors still apply) |
  | `searchAssets` (holdings) | `getBalance` and `getTokenAccountsByOwner`, with Jupiter adding names and prices |
  | Enhanced Transactions (history) | `getSignaturesForAddress`, `getTransaction` and our own `wallet_swap` decoder. Pages are smaller (50) and paced; no deep backfill while on the fallback. |

- **Sending trades:** Helius Sender, Jito's block engine and the RPC router, all at once.

## Measured on the public node (2026-11-08)

Over five minutes the stream disconnected once (only the initial failed Helius connect),
with no subscription-limit closes. Sol Radar held 170 coins, 139 of them with live
trades. The router sent 69 requests. One history page took about 14 seconds.

## Limits

- The public node is not meant for production. For more headroom, add free plans from
  other providers to `FALLBACK_RPC_URLS` / `FALLBACK_WS_URLS`.
- Priority fees from `getRecentPrioritizationFees` are lower than Helius estimates.
- Real trades on the fallback path are not live-tested yet.
