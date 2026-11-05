# ADR 0001: V1 scope and technology stack

- **Date:** 2026-11-05
- **Status:** Accepted by the founder

## Decisions

1. **Solana only.** The source of truth is `MONEXA_MASTER_SPEC.md`.
2. **V1 scope:** Sol Radar, token analytics, manual trading, transaction recovery, portfolio, alerts, wallet tracker, support/bugs/rewards/leaderboards/admin.
3. **Deferred to Product Phase 2:** the proprietary AI engine, AI research agents, AI token/wallet analysis, the full sniper system, automated copy trading and advanced automated strategies.
4. **Backend: Rust.** Axum and Tokio. Chosen for execution speed and reliability.
5. **Frontend: Next.js and TypeScript, with Tailwind.** This is the standard for browser wallet integration.
6. **Database: Supabase (Postgres, Auth, RLS).** User and account data live here. Latency-sensitive market data does not go through it.
7. **Cache and queues: Upstash Redis (cloud).** Local Docker is impossible on the development machine because virtualization is disabled.
8. **AI:** use existing LLM APIs, grounded in real on-chain data. No proprietary model training in V1. Every output separates verified facts from estimates.
9. **Data retention:** store only active tokens (trending, top, newly launched). Dead tokens are pruned automatically. User trades, fees and transaction history are kept permanently.

## Open (decided later)

- **Automation signing model (Product Phase 2).** The proposal is a session bot wallet funded by one Phantom-approved transfer and swept back to the user on stop. Risk is limited to the funded amount. Needs research and approval before implementation.
- **Backup RPC provider** (QuickNode or Triton). Decided in Phase 1.
