# Kixo waitlist

A one-page site that collects emails before launch. Each person gets a place on the list
and an invite link; every friend who joins with it moves them up 3 places.

## Put it online (about 15 minutes)
1. Supabase → SQL Editor: run `supabase/migrations/0010_waitlist.sql` once.
2. Cloudflare → Turnstile → Add site (your domain): copy the **site key** and **secret key**.
3. Vercel (free) → New project → import this repo → Root directory `apps/waitlist`.
4. Environment variables (from `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL` (your domain).
5. Deploy, then point the domain at it. When Kixo launches, point the domain at the app
   instead and email everyone on the list.

## Local
`pnpm install`, copy `.env.example` to `.env.local`, `pnpm dev` → http://localhost:3100

Emails are in Supabase → Table editor → `waitlist` (export as CSV when you launch).
