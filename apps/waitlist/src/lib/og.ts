/* Shared by the share images (api/card, api/meme): Inter for the text, fetched once from
   Google Fonts (the default font when offline), and Kixo's mark as a data URL. */
import { readFile } from "fs/promises";
import path from "path";

type Font = { name: string; data: ArrayBuffer; weight: 400 | 700 | 800; style: "normal" };
let fonts: Font[] | null = null;
let mark: string | null = null;

export async function interFonts(): Promise<Font[]> {
  if (fonts) return fonts;
  const get = async (w: 400 | 700 | 800): Promise<Font> => {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${w}`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30" } })).text();
    // The latin subset is the last block; ttf, otf or woff (not woff2) work here.
    const latin = css.slice(Math.max(0, css.lastIndexOf("/* latin */")));
    const url = latin.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype|woff)'\)/)?.[1];
    if (!url) throw new Error("font");
    return { name: "Inter", data: await (await fetch(url)).arrayBuffer(), weight: w, style: "normal" };
  };
  try {
    fonts = await Promise.all([get(400), get(700), get(800)]);
  } catch {
    fonts = [];
  }
  return fonts;
}

export async function logo(): Promise<string> {
  if (!mark) mark = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public", "kixo-mark.png"))).toString("base64")}`;
  return mark;
}
