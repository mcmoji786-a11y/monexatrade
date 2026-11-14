# Waitlist ko kixo.trade par online karna (free hosting)

Netlify ka free plan istemal karein: muft hai, apna domain lagta hai, HTTPS khud milta hai,
aur commercial (business) istemal ki ijazat hai. (Vercel ka free "Hobby" plan sirf
non-commercial kaam ke liye hai, is liye Kixo ke liye Netlify behtar hai.)

Waqt: taqriban 20-30 minute, aur domain ka DNS failne mein kuch minute se kuch ghante.

## Pehle (ek dafa)
1. **Supabase → SQL Editor:** `supabase/migrations/0010_waitlist.sql` chal chuka ho (aap kar chuke hain).
2. **Cloudflare Turnstile** (bot check, muft): https://dash.cloudflare.com → Turnstile →
   Add widget → Domain: `kixo.trade` → **Site key** aur **Secret key** copy karein.

## Netlify par lagana
1. https://app.netlify.com par GitHub se sign up karein.
2. **Add new site → Import an existing project → GitHub** → repo `Moxnexa Trade` chunein.
3. Branch: `feature/trade-page-all-launchpads` (ya `main`, jis mein waitlist ho).
4. **Base directory:** `apps/waitlist`
   **Build command:** `pnpm build`
   **Publish directory:** jo Netlify khud bhar de (`.next`) wahi rehne dein.
   (Netlify Next.js ko khud pehchan leta hai aur `pnpm-lock.yaml` se pnpm istemal karta hai.)
5. **Environment variables** (Site configuration → Environment variables) — values `.env`
   se copy karein, kisi ko bhejein nahi:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Turnstile ki site key)
   - `TURNSTILE_SECRET_KEY` (Turnstile ki secret key)
   - `NEXT_PUBLIC_SITE_URL` = `https://kixo.trade`
   - Welcome email (aapka SMTP): `SMTP_HOST`, `SMTP_PORT` (aam tor par 465), `SMTP_USER`,
     `SMTP_PASS`, `SMTP_FROM` (jaise `Kixo <hello@kixo.trade>`)
6. **Deploy** dabayein. Netlify ek address dega (jaise `kixo-xyz.netlify.app`). Usay khol kar
   check karein ke page chal raha hai aur email join hota hai.

## Domain kixo.trade lagana
1. Netlify → **Domain management → Add a domain** → `kixo.trade` likhein.
2. Netlify do tareeqe batayega. Aasan wala:
   - Jahan domain khareeda (registrar) wahan **DNS settings** kholein, aur Netlify jo records
     bataye woh lagayein. Aam tor par:
     - `A` record: naam `@` → Netlify ka IP (Netlify screen par likha hota hai)
     - `CNAME` record: naam `www` → `kixo-xyz.netlify.app`
   - Ya poora DNS Netlify ko de dein (Netlify DNS), registrar mein nameservers badal kar.
3. Netlify **HTTPS certificate khud** laga deta hai (kuch minute).
4. https://kixo.trade khol kar check karein.

## Kixo app ki sign-in emails (Supabase) ke liye apna SMTP
Supabase → Authentication → Emails (SMTP Settings) → **Enable custom SMTP** → wahi host,
port, user, password, aur sender `hello@kixo.trade` daalein. Is ke baad sign-up ke codes
aapke domain se jayenge aur ghante ki limit khatam ho jayegi. Domain ke DNS mein SMTP
provider ke batāye **SPF, DKIM aur DMARC** records zaroor lagayein, warna emails spam mein
jayengi. (Supabase sign-in emails)

## Launch ke baad check list
- [ ] https://kixo.trade khulta hai, padlock (HTTPS) hai
- [ ] Email daal kar join hota hai, jagah (#1, #2...) dikhti hai
- [ ] Welcome email inbox mein aati hai (spam mein nahi)
- [ ] Invite link X par post karein: card (tasveer) dikhna chahiye
- [ ] Google Search Console mein `https://kixo.trade/sitemap.xml` submit karein (docs/SEO_BACKLINKS.md)
- [ ] Supabase → Table editor → `waitlist` mein emails aa rahi hain

## Masle
| Masla | Hal |
|---|---|
| Join par "The waitlist is not set up yet" | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` Netlify mein nahi lage. |
| "Please complete the check" | Turnstile ki keys ya domain ghalat; Turnstile widget mein `kixo.trade` hona chahiye. |
| X par card nahi aata | `NEXT_PUBLIC_SITE_URL` `https://kixo.trade` ho, phir dobara deploy. |
| Build fail | Netlify ke deploy log mein error dekhein; base directory `apps/waitlist` ho. |
