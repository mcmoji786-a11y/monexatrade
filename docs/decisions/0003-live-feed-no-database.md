# ADR 0003: Live token feed without a database, narrowed subscription

- **Date:** 2026-11-05
- **Status:** Accepted by the founder (no database storage for the feed)

## Decision
- New tokens are **not stored** in Supabase or Redis. The gateway runs the ingest engine in-process, keeps only the last 100 tokens in memory and pushes each new token to browsers over a WebSocket at `/ws/new-tokens`.
- A single Helius subscription serves every visitor, so Helius usage does not grow with the number of users.
- The subscription uses `logsSubscribe` with `mentions` set to pump.fun's **mint-authority account** (`TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM`) instead of the program ID.

## Measurement (2026-11-05, live mainnet, from the gateway's `/stats`)

| Subscription | Window | Data | Messages | Tokens | Est. MB/day | Est. credits/day* |
|---|---|---|---|---|---|---|
| Program ID (every trade) | 46 s | 36.98 MB | 26,149 | 27 | ~68,000 | ~1,361,000 |
| Mint authority (creates only) | 63 s | 0.34 MB | 44 | 41 | ~470 | ~9,400 |

The narrowed subscription detects the same launch rate (about 0.6 to 0.65 per second) with about 145 times less data. At about 282,000 credits a month it fits the Free plan's 1M credits.

\*The 20 credits/MB rate comes from a Helius blog post. Whether standard WebSockets on the Free plan are billed this way is unverified, so check usage in the Helius dashboard after a day of running.

## Consequences
- Restarting the gateway empties the in-memory window. The feed refills within seconds.
- Price, volume and trades are **not** in this stream. They come from enrichment (ADR 0002, Stage 1.3).
