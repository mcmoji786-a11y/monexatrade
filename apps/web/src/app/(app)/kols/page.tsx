import { redirect } from "next/navigation";

/** The KOL Tracker is a tab of Wallet Monitor now; old links land there. */
export default function KolsPage() {
  redirect("/wallets?tab=kols");
}
