import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import { byCode } from "@/lib/waitlist";
import { offerFor } from "@/lib/offers";

/* `GET /api/card?code=` : a person's share card (1200x630), used as the preview image of
   their invite link on X, Telegram and others, and as a download. */

export const runtime = "nodejs";

let mark: string | null = null;
/* Inter bold for the card, fetched once from Google Fonts; the default font if offline. */
let fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 | 800; style: "normal" }[] | null = null;
async function interFonts() {
  if (fonts) return fonts;
  const get = async (w: 400 | 700 | 800) => {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${w}`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30" } })).text();
    // The latin subset is the last block; ttf, otf or woff (not woff2) work here.
    const latin = css.slice(Math.max(0, css.lastIndexOf("/* latin */")));
    const url = latin.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype|woff)'\)/)?.[1];
    if (!url) throw new Error("font");
    return { name: "Inter", data: await (await fetch(url)).arrayBuffer(), weight: w, style: "normal" as const };
  };
  try {
    fonts = await Promise.all([get(400), get(700), get(800)]);
  } catch {
    fonts = [];
  }
  return fonts;
}
async function logo() {
  if (!mark) mark = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public", "kixo-mark.png"))).toString("base64")}`;
  return mark;
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim().toLowerCase() ?? "";
  const s = code ? await byCode(code).catch(() => null) : null;
  const tier = s ? offerFor(s.referrals, s.rank).name : null;
  const [icon, inter] = await Promise.all([logo(), interFonts()]);
  const green = "#2fd38a";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#050506", color: "#ededef", position: "relative", fontFamily: inter.length ? "Inter" : "sans-serif" }}>
        {/* glow and radar rings */}
        <div style={{ position: "absolute", right: -260, top: -260, width: 900, height: 900, borderRadius: 900, background: "rgba(47,211,138,0.05)", display: "flex" }} />
        <div style={{ position: "absolute", right: -120, top: -120, width: 620, height: 620, borderRadius: 620, background: "rgba(47,211,138,0.06)", display: "flex" }} />
        <div style={{ position: "absolute", right: 60, top: 60, width: 260, height: 260, borderRadius: 260, background: "rgba(47,211,138,0.08)", display: "flex" }} />
        <div style={{ position: "absolute", right: -60, top: -60, width: 560, height: 560, borderRadius: 560, border: "1px solid rgba(47,211,138,0.25)", display: "flex" }} />
        <div style={{ position: "absolute", right: 40, top: 40, width: 360, height: 360, borderRadius: 360, border: "1px solid rgba(47,211,138,0.2)", display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon} width={64} height={64} alt="" />
            <span style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1 }}>Kixo</span>
          </div>
          <span style={{ fontSize: 22, color: "#04130c", background: green, padding: "8px 18px", borderRadius: 999, fontWeight: 700, letterSpacing: 2 }}>EARLY ACCESS</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {s ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 32, color: "#a1a1aa" }}>I&apos;m on the Kixo waitlist</span>
              <span style={{ fontSize: 200, fontWeight: 800, letterSpacing: -10, lineHeight: 1, marginTop: 4, display: "flex" }}>
                <span style={{ color: green }}>#</span>
                {s.position.toLocaleString("en-US")}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1.02, display: "flex", flexDirection: "column" }}>
              <span>The AI that trades</span>
              <span style={{ color: green }}>memecoins for you.</span>
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 34, fontWeight: 700, display: "flex" }}>
              <span style={{ color: green, marginRight: 12 }}>Locked in:</span> Kixo AI Agent, 1 year free
            </span>
            <span style={{ fontSize: 24, color: "#a1a1aa" }}>
              {tier ? `${tier} · ` : ""}AI that auto-trades Solana memecoins · 100,000+ strategies
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: inter.length ? inter : undefined, headers: { "cache-control": "public, max-age=300" } },
  );
}
