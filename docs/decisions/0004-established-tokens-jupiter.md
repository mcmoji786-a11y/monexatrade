# ADR 0004: Established Solana tokens from Jupiter (hybrid)

- **Date:** 2026-11-06
- **Status:** Accepted ("do what is best now, we can change it later")

## Context
Discover must show the large tokens across all of Solana, not only new pump.fun launches. Indexing every DEX ourselves needs paid streaming (Helius Business at $499 a month, or our own node) and weeks of work.

## Decision
- New launches, per-trade market data and **snipers** stay on our own decoders (ADR 0002, ADR 0003).
- **Established tokens** come from the Jupiter Tokens API v2 (`lite-api.jup.ag/tokens/v2`). The gateway polls one category at a time, rotating through `toptrending/5m`, `toptraded/1h` and `toptrending/1h`. It merges the results into an in-memory board and pushes only the tokens that changed to every browser.
- The provider sits behind `MarketToken` (gateway `jupiter.rs`), so it can be replaced by our own indexer without frontend changes.
- When a token is in both sources, our own data wins and Jupiter only fills in liquidity and verification.

## Measured (2026-11-06)
- Keyless access: `x-ratelimit-remaining: 4` on the first call. A burst of 12 calls got 11 responses of 429. Polling every 3 s with backoff on 429 gave 0 rate-limit warnings in a live test.
- One live run: 110 established tokens, a push about every 3.3 s, 219 changed tokens in 20 s.
- The fields used (usdPrice, mcap, liquidity, holderCount, stats5m/1h/24h, audit, isVerified, organicScore) were verified against real responses.

## Consequences
- Established tokens refresh every few seconds. New launches update on every trade.
- Jupiter's terms of use must be reviewed before launch, along with whether a free API key raises the limit. Both are added to the launch checklist.
