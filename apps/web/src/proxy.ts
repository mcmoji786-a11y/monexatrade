import { NextResponse, type NextRequest } from "next/server";

/* The admin lives at a secret address: /<ADMIN_PATH> (apps/web/.env.local, server only,
   never sent to browsers). The page's real route (/admin-preview) answers "not found" to
   everyone who types it, so the admin cannot be found by guessing or from robots.txt.
   Without ADMIN_PATH there is no way in at all. The gateway still checks the admin key,
   the allowed addresses and the lockout on every admin call (admin_guard.rs). */

const HIDDEN = "/admin-preview";

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const secret = process.env.ADMIN_PATH?.trim().replace(/^\/+|\/+$/g, "");

  if (secret && secret.length >= 16 && path === `/${secret}`) {
    const res = NextResponse.rewrite(new URL(HIDDEN, req.url));
    res.headers.set("x-robots-tag", "noindex, nofollow");
    res.headers.set("cache-control", "no-store");
    res.headers.set("referrer-policy", "no-referrer");
    return res;
  }
  if (path === HIDDEN || path.startsWith(`${HIDDEN}/`)) {
    return NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: not Next's own files, images or other static files.
  matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
