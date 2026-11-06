import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminPreview } from "@/components/admin/admin-preview";

export const metadata: Metadata = { title: "Admin preview · MONEXA", robots: { index: false, follow: false } };

/** Design preview of the admin workflow. Development only: a production build answers
 *  404 here. The real admin becomes a separate app behind login, 2FA and an IP gate. */
export default function AdminPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AdminPreview />;
}
