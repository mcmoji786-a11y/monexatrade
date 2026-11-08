import type { Metadata } from "next";
import { SettingsBoard } from "@/components/settings/settings-board";

export const metadata: Metadata = {
  title: "Settings",
  description: "Kixo settings",
  alternates: { canonical: "/settings" },
};

export default function SettingsPage() {
  return <SettingsBoard />;
}
