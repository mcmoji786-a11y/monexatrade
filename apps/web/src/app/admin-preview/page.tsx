import type { Metadata } from "next";
import { AdminPreview } from "@/components/admin/admin-preview";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** The admin. Nothing shows without the admin key, every admin route checks it on the
 *  gateway, and money or API-key changes also need the owner's emailed code. */
export default function AdminPreviewPage() {
  return <AdminPreview />;
}
