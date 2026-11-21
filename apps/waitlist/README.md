# Kixo waitlist

A one-page site where people claim an early-access pass by opening their Kixo account
(Continue with Google, or an email code). It is the same Supabase account they sign in to
after launch, so their place, invite link, invited friends and offer are already there.

- Place on the list: `waitlist_members` (migration 0019). Every friend who joins with
  someone's link moves them up 3 places.
- Invite codes and who invited whom: the app's own `profiles.ref_code` / `referred_by`,
  so a link shared now (`/?ref=code`) keeps working in the app.
- Offers: `src/lib/offers.ts`.

## Put it online
1. Supabase, SQL Editor: run `supabase/migrations/0019_waitlist_accounts.sql` once
   (it removes the old email-only `waitlist` table).
2. Supabase, Authentication, URL Configuration: add `https://YOUR-DOMAIN/auth/callback`
   to Redirect URLs (and `http://localhost:3100/auth/callback` for local testing).
   Google is already on as a provider for the app.
3. Netlify (or Vercel), new site from this repo, base directory `apps/waitlist`.
4. Environment variables from `.env.example`. `NEXT_PUBLIC_SITE_URL` is your domain.
5. Email codes come from Supabase Auth's mail. Its built-in sender allows only a few a
   hour: set your SMTP in Supabase, Authentication, SMTP Settings before launch.

## Local
`pnpm install`, copy `.env.example` to `.env.local`, `pnpm dev`, then http://localhost:3100
