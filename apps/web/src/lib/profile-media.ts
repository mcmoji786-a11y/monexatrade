"use client";
/* Profile pictures and banners: resized in the browser (a square 256 px picture, a 1500 x
   500 banner), saved as WebP to the user's own folder in Supabase Storage
   ("profile-media", migration 0021), and returned as a public URL for the profile. */
import { supabase } from "./supabase";
import { currentUserId } from "./account";

const SIZES = { avatar: { w: 256, h: 256 }, banner: { w: 1500, h: 500 } } as const;
const MAX_INPUT = 15 * 1024 * 1024;

/** Cover-crops the image to the target size (centered) and encodes it as WebP. */
async function resize(file: File, w: number, h: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const sw = w / scale, sh = h / scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images");
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.86));
  if (!blob) throw new Error("Could not prepare the picture");
  return blob;
}

export async function uploadProfileImage(kind: keyof typeof SIZES, file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error("Use a PNG, JPG, WebP or GIF picture");
  if (file.size > MAX_INPUT) throw new Error("That picture is too large (15 MB at most)");
  const sb = supabase();
  const uid = currentUserId();
  if (!sb || !uid) throw new Error("Sign in first");
  const { w, h } = SIZES[kind];
  const blob = await resize(file, w, h);
  const path = `${uid}/${kind}-${Date.now()}.webp`;
  const { error } = await sb.storage.from("profile-media").upload(path, blob, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(/bucket/i.test(error.message) ? "Pictures open after Kixo's database update (migration 0021)" : error.message);
  return sb.storage.from("profile-media").getPublicUrl(path).data.publicUrl;
}
