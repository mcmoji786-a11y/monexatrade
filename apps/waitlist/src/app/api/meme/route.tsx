import { ImageResponse } from "next/og";
import { byCode } from "@/lib/members";
import { interFonts, logo } from "@/lib/og";
import { readFile } from "fs/promises";
import path from "path";

/* `GET /api/meme?ref=` : a share meme (1080x1350, the size Instagram, X and WhatsApp show
   best) with the person's Kixo name and invite link on it. Two panels: everyone else
   buying the top and getting rugged, and "me" letting Kixo's AI check first. Kixo's own
   artwork, no borrowed meme template. Without a known ref it still renders, with the
   waitlist's address. */

export const runtime = "nodejs";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kixo.trade";
const RED = "#f26d6d";
const GREEN = "#2fd38a";

/** A chart line as SVG points: falling (rug) or rising (pump). */
function points(up: boolean) {
  const n = 28;
  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 960;
    const wob = Math.sin(i * 1.9) * 12;
    const y = up ? 300 - Math.pow(i / n, 1.7) * 250 + wob : i < n * 0.62 ? 90 - (i / n) * 40 + wob : 70 + Math.pow((i - n * 0.62) / (n * 0.38), 0.55) * 230 + wob / 3;
    out.push(`${x.toFixed(0)},${y.toFixed(0)}`);
  }
  return out.join(" ");
}

/* The founder's own meme, when there is one: public/share/meme.png or .jpg. It is used as
   it is, uncropped, with a band above (Kixo and the person's name) and a band below (their
   link), added outside the picture so nothing in it is covered. */
let base: { src: string; w: number; h: number } | null | undefined;
async function baseMeme() {
  if (base !== undefined) return base;
  base = null;
  for (const f of ["meme.png", "meme.jpg", "meme.jpeg"]) {
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "share", f));
      const size = imageSize(buf);
      if (size) base = { src: `data:image/${f.endsWith("png") ? "png" : "jpeg"};base64,${buf.toString("base64")}`, ...size };
      break;
    } catch {}
  }
  return base;
}

/** Width and height from a PNG or JPEG header. */
function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref")?.trim().toLowerCase() ?? "";
  const s = ref ? await byCode(ref).catch(() => null) : null;
  const name = s?.handle ? `@${s.handle}` : null;
  const link = `${SITE.replace(/^https?:\/\//, "")}${s ? `/?ref=${s.handle ?? s.code}` : ""}`;
  // Two memes: v=1 (default) the founder's picture, v=2 Kixo's two-panel one.
  const v = new URL(req.url).searchParams.get("v") === "2" ? 2 : 1;
  const [icon, inter, own] = await Promise.all([logo(), interFonts(), baseMeme()]);

  if (own && v === 1) {
    const W = 1080;
    const picH = Math.round((W * own.h) / own.w);
    const TOP = 130;
    const BOTTOM = 190;
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#050506", color: "#ededef", fontFamily: inter.length ? "Inter" : "sans-serif" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: TOP, padding: "0 48px", borderBottom: `3px solid ${GREEN}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon} width={50} height={50} alt="" />
              <span style={{ fontSize: 44, fontWeight: 800 }}>Kixo</span>
            </div>
            {name && <span style={{ fontSize: 40, fontWeight: 800, color: GREEN }}>{name}</span>}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={own.src} width={W} height={picH} alt="" style={{ display: "flex" }} />
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, height: BOTTOM, padding: "0 48px", borderTop: `3px solid ${GREEN}` }}>
            <span style={{ fontSize: 28, color: "#a1a1aa" }}>Join the Kixo waitlist · AI agent free for 1 year</span>
            <span style={{ fontSize: 40, fontWeight: 800, color: "#22d3ee" }}>{link}</span>
          </div>
        </div>
      ),
      { width: W, height: TOP + picH + BOTTOM, fonts: inter.length ? inter : undefined, headers: { "cache-control": "public, max-age=300" } },
    );
  }

  const pill = (text: string, color: string) => (
    <span style={{ display: "flex", alignSelf: "flex-start", padding: "8px 18px", borderRadius: 999, border: `2px solid ${color}`, color, fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>{text}</span>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#050506", color: "#ededef", fontFamily: inter.length ? "Inter" : "sans-serif" }}>
        {/* Everyone else */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "56px 60px 30px", height: 560, background: "#0d0b0b", position: "relative" }}>
          {pill("EVERYONE ELSE", RED)}
          <span style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>aping in at the top at 3am</span>
          <svg width="960" height="320" viewBox="0 0 960 320" style={{ marginTop: 6 }}>
            <polyline points={points(false)} fill="none" stroke={RED} strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", right: 80, top: 300, display: "flex", padding: "10px 30px", border: `8px solid ${RED}`, borderRadius: 14, color: RED, fontSize: 92, fontWeight: 800, transform: "rotate(-12deg)", letterSpacing: 4 }}>RUGGED</div>
        </div>

        {/* Me */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "40px 60px 20px", height: 560, background: "#0a0f0d", borderTop: "3px solid #1f2126" }}>
          {pill("ME", GREEN)}
          <span style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            let <span style={{ color: GREEN, margin: "0 16px" }}>Kixo&apos;s AI</span> check it first
          </span>
          <svg width="960" height="320" viewBox="0 0 960 320" style={{ marginTop: 6 }}>
            <polyline points={points(true)} fill="none" stroke={GREEN} strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>

        {/* Kixo, the name and the link */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 60px", height: 230, background: "#050506", borderTop: `3px solid ${GREEN}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon} width={54} height={54} alt="" />
              <span style={{ fontSize: 46, fontWeight: 800 }}>Kixo</span>
              {name && <span style={{ fontSize: 34, color: GREEN, fontWeight: 700, marginLeft: 12 }}>{name}</span>}
            </div>
            <span style={{ fontSize: 30, color: "#22d3ee", fontWeight: 700 }}>{link}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontSize: 26, color: "#a1a1aa" }}>Join the waitlist</span>
            <span style={{ fontSize: 30, fontWeight: 800 }}>AI agent free for 1 year</span>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, fonts: inter.length ? inter : undefined, headers: { "cache-control": "public, max-age=300" } },
  );
}
