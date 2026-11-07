# Kixo: project rules for Claude

- The product is **Kixo** (renamed from MONEXA on 2026-11-07, see `docs/decisions/0006-name-kixo.md`). Code names such as `monexa-gateway`, `monexa_ingest` and the spec file name keep the old name on purpose.
- `MONEXA_MASTER_SPEC.md` is the source of truth. Decisions are in `docs/decisions/` and progress is in `docs/roadmap.md`.
- Discuss with the founder in Roman Urdu. Plan first and wait for approval, then build in small stages.
- Never enable real-money trading without explicit approval. No fake demo data. Never print or commit secrets (`.env` is gitignored).

## UI rule: unslop is mandatory
All frontend work in `apps/web` must follow the **unslop** skill (`.claude/skills/unslop`): every new screen, component or restyle.
- Before finishing any UI change, run the unslop audit (`references/signs.md`) on the changed screen and fix what it finds.
- Kixo's direction (spec section 18) takes priority: near-black base, emerald and cyan accents, no purple, no excessive gradients or decoration, high-density trading tables.
- The unslop skill is CC BY 4.0 by Damir Sokolovsky (https://github.com/heydamir/unslop). Keep its credit.

## Commands
- Backend: `cargo run -p monexa-gateway` (serves http://localhost:8080/health) and `cargo test --workspace`
- Frontend: `cd apps/web` then `pnpm dev` / `pnpm build`
- Rust lives on E: (`RUSTUP_HOME=E:\DevTools\rustup`, `CARGO_HOME=E:\DevTools\cargo`) because C: is nearly full.
