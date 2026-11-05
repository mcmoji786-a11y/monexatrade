# MONEXA

AI-powered Solana trading and market intelligence terminal. The product spec is in [MONEXA_MASTER_SPEC.md](MONEXA_MASTER_SPEC.md).

## Structure

```
apps/web/          Next.js frontend
services/common/   Shared Rust code (config, logging)
services/gateway/  Rust API gateway (Axum)
supabase/          Database migrations
docs/              Roadmap, decisions (ADR), launch checklist
```

## Run locally

1. Copy `.env.example` to `.env` and fill in the keys.
2. Start the backend from the repo root: `cargo run -p monexa-gateway`. It serves `http://localhost:8080/health`.
3. Start the frontend: `cd apps/web` then `pnpm dev`. It serves `http://localhost:3000`.
