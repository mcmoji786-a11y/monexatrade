import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** The picture shown when a Kixo link is shared on X, Telegram, Discord or WhatsApp. */
export const alt = "Kixo – Solana memecoin trading terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FEATURES = ["New launches live", "Safety scores", "Sniper", "Smart money", "Free demo account"];

export default async function OpenGraphImage() {
  const mark = `data:image/png;base64,${(await readFile(join(process.cwd(), "public/brand/kixo-mark.png"))).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#08090a", color: "#ededed", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: 800 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered to an image, not a page */}
            <img src={mark} width={64} height={64} alt="" />
            <div style={{ fontSize: 48, fontWeight: 600 }}>Kixo</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 24, color: "#34d399" }}>Solana memecoin trading terminal</div>
            <div style={{ fontSize: 64, lineHeight: 1.06, marginTop: 18, fontWeight: 500 }}>Every new token, the second it launches</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {FEATURES.map((f) => (
              <div key={f} style={{ display: "flex", fontSize: 22, color: "#a1a1aa", border: "1px solid rgba(237,237,237,0.14)", borderRadius: 10, padding: "8px 16px" }}>
                {f}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", borderLeft: "1px solid rgba(237,237,237,0.08)", background: "#0e0f11" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered to an image, not a page */}
          <img src={mark} width={260} height={260} alt="" />
        </div>
      </div>
    ),
    size,
  );
}
