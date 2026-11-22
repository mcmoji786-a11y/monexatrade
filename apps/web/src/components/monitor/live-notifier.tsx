"use client";
/* Alerts on every page while Kixo is open: trades by Wallet Monitor wallets (KOLs added
   with their bell are Wallet Monitor wallets too) and new calls from followed X accounts.
   Kixo's tab in front: an in-app pop-up. Another tab or window in front: a desktop
   notification as well. Email, Telegram and Discord come from the gateway (alerts.rs),
   also when Kixo is closed. The Monitor's "Browser" switch turns these off. */
import { useEffect, useRef } from "react";
import { GATEWAY_HTTP, GATEWAY_WS } from "@/lib/gateway";
import { useMonitor, type MonitoredWallet } from "@/lib/prefs";
import { accessToken, useAccount } from "@/lib/account";
import { pushToast } from "@/lib/toast";
import { tokenHref } from "@/lib/open-token";

type WalletTrade = { mint: string; symbol: string | null; sol_usd?: number | null; trade: { signature: string; wallet: string; is_buy: boolean; sol: number } };
type Call = { handle: string; id: string; text: string; mints: string[] };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** A desktop notification when Kixo is not the tab in front, opening `href` on click. */
function desktop(title: string, body: string, tag: string, href: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
  const n = new Notification(title, { body, tag, icon: "/icon.png" });
  n.onclick = () => {
    window.focus();
    window.location.assign(href);
    n.close();
  };
}

export function LiveNotifier() {
  const m = useMonitor();
  const on = m.prefs.browser;
  const wallets = m.prefs.wallets;
  const key = on ? wallets.map((w) => w.address).sort().join(",") : "";
  // The socket reads the latest rules without reconnecting on every edit.
  const rules = useRef<MonitoredWallet[]>(wallets);
  useEffect(() => {
    rules.current = wallets;
  }, [wallets]);

  useEffect(() => {
    if (!key) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const open = () => {
      ws = new WebSocket(`${GATEWAY_WS}/ws/wallets?w=${encodeURIComponent(key)}`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as { type: string } & WalletTrade;
        if (msg.type !== "trade") return;
        const t = msg.trade;
        const w = rules.current.find((x) => x.address === t.wallet);
        if (!w || !(t.is_buy ? t.sol >= w.minBuySol : w.sells)) return;
        const who = w.label || short(w.address);
        const coin = msg.symbol ? `$${msg.symbol}` : "a coin";
        const usd = msg.sol_usd ? ` (about $${(t.sol * msg.sol_usd).toLocaleString("en-US", { maximumFractionDigits: 0 })})` : "";
        const title = `${who} ${t.is_buy ? "bought" : "sold"} ${coin}`;
        const body = `${t.sol.toFixed(2)} SOL${usd}`;
        const href = tokenHref(msg.mint);
        // A sell is news, not an error: neutral, not the red warning style.
        pushToast({ tone: t.is_buy ? "good" : "info", title, body, href });
        desktop(title, body, t.signature, href);
      };
      // Reconnect after a gateway restart or a dropped connection.
      ws.onclose = () => {
        if (!stopped) retry = setTimeout(open, 5_000);
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close();
        else ws.close();
      }
    };
  }, [key]);

  // New calls from followed X accounts, checked every 30 seconds.
  const signedIn = useAccount().status === "signed-in";
  useEffect(() => {
    if (!on || !signedIn) return;
    let seen: Set<string> | null = null;
    const check = async () => {
      try {
        const r = await fetch(`${GATEWAY_HTTP}/x-tracker/me`, { headers: { authorization: `Bearer ${accessToken()}` }, cache: "no-store" });
        if (!r.ok) return;
        const { feed } = (await r.json()) as { feed: Call[] };
        // The first read only learns what is already there.
        if (seen) {
          for (const p of feed.filter((p) => !seen!.has(p.id)).slice(0, 3)) {
            const title = `@${p.handle} posted a coin`;
            const body = p.text.slice(0, 140);
            const href = p.mints[0] ? tokenHref(p.mints[0]) : "/wallets?tab=calls";
            pushToast({ tone: "info", title, body, href });
            desktop(title, body, `x-${p.id}`, href);
          }
        }
        seen = new Set(feed.map((p) => p.id));
      } catch {
        // Gateway down for a moment: the next check catches up.
      }
    };
    void check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [on, signedIn]);

  return null;
}
