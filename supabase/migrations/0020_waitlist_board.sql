-- Kixo waitlist leaderboard (2026-11-22): who brought the most friends. A friend counts
-- when their account names this person as its referrer (profiles.referred_by, the app's
-- own referral field). Shown by the person's public Kixo handle (trader_profiles, the
-- app's social profile) or, without one, a shortened invite code. Never an email.
-- Only the waitlist server calls it, with the service role.

create or replace function public.waitlist_board(p_limit int default 20)
returns table (handle text, code text, referrals bigint, joined bigint)
language sql stable security definer set search_path = public as $$
  select tp.handle, p.ref_code, count(r.id) as referrals, min(w.number) as joined
  from public.waitlist_members w
  join public.profiles p on p.id = w.user_id
  join public.profiles r on r.referred_by = w.user_id
  left join public.trader_profiles tp on tp.user_id = w.user_id
  group by w.user_id, tp.handle, p.ref_code
  order by count(r.id) desc, min(w.number) asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.waitlist_board(int) from public, anon, authenticated;
grant execute on function public.waitlist_board(int) to service_role;
