# ADR 0002: Hybrid market data (Option A)

- **Date:** 2026-11-05
- **Status:** Accepted by the founder

## Decision
- **Token discovery is our own:** the Rust `ingest` service subscribes to Solana logs through Helius WebSockets and detects new tokens directly from the pump.fun program.
- **Price, volume and liquidity enrichment** comes at first from free public APIs (DexScreener, Jupiter). These sit behind a provider trait, so our own swap-based computation can replace them later without changing consumers.
- **Start on the Helius Free plan** (standard WebSockets only, 10 RPC req/s). Upgrade to Developer ($49/mo) when the limits are hit. Mainnet LaserStream (gRPC) requires Business ($499/mo) and is deferred.

## Verified facts used
- pump.fun program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`.
- New tokens log `Program log: Instruction: Create` (legacy SPL) or `Program log: Instruction: CreateV2` (Token-2022). The `CreateEvent` is in a `Program data:` line with discriminator `[27,114,169,77,222,235,99,118]`.
- Field order: name, symbol, uri (Borsh strings), mint, bonding_curve, user, creator (pubkeys), timestamp (i64), then reserves and supply (u64) and newer fields.
- Source: the chainstacklabs/pumpfun-bonkfun-bot cookbook (`pumpfun_listen_tokens_logsubscribe.py`). The Helius plans come from helius.dev/docs/billing/plans; the docs and the pricing page partly conflict, so confirm in the dashboard.

## Not yet verified
- Migration (graduation to PumpSwap) event format. It must be researched before Stage 1.x migration detection.
