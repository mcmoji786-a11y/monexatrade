import type { Metadata } from "next";
import { SettingsBoard } from "@/components/settings/settings-board";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsBoard />;
}
