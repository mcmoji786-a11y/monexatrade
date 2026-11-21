import { redirect } from "next/navigation";

/** The X Tracker is the Calls tab of Wallet Monitor now; old links land there. */
export default function XTrackerPage() {
  redirect("/wallets?tab=calls");
}
