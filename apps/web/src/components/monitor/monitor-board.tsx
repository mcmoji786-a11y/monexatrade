"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Bell, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { GATEWAY_HTTP, GATEWAY_WS, sol, type TradeRow } from "@/lib/gateway";
import { tokenHref } from "@/lib/open-token";
import { MAX_MONITORED, useMonitor, type MonitoredWallet } from "@/lib/prefs";
import { CopyAddress } from "@/components/token/token-bits";
import { useNow } from "@/components/radar/use-radar-feed";
import { Tick } from "@/components/token/tick";
import { WalletDot } from "./wallet-dot";
import { TradesToggle, WalletTradesPanel } from "./wallet-trades";

type Activity = { mint: string; symbol: string | null; trade: TradeRow };
const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const MAX_ROWS = 200;

/** Wallet Monitor: follow wallets, see their trades live, get alerts on big buys and
 *  sells. Trades come from MONEXA's own decoder (every coin it tracks). */
export function MonitorBoard() {
  const m = useMonitor();
  const now = useNow();
  const wallets = m.prefs.wallets;
  const { activity, live, fresh } = useWalletActivity(wallets);
  const buys = activity.filter((a) => a.trade.is_buy);
  const bought = buys.reduce((s, a) => s + a.trade.sol, 0);
  const sold = activity
    .filter((a) => !a.trade.is_buy)
    .reduce((s, a) => s + a.trade.sol, 0);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-text">Wallet Monitor</h1>
            <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs text-text-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? "live-ring bg-emerald" : "bg-muted"}`}
              />
              {wallets.length === 0 ? "Idle" : live ? "Live" : "Connecting"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Follow any Solana wallet. Its buys and sells on new coins show here
            the moment they confirm, and big moves alert you
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <HeadStat
            label="Wallets"
            value={`${wallets.length}/${MAX_MONITORED}`}
          />
          <HeadStat
            label="Trades seen"
            value={activity.length.toLocaleString()}
            raw={activity.length}
          />
          <HeadStat
            label="Bought"
            value={sol(bought)}
            raw={bought}
            tone="text-positive"
          />
          <HeadStat
            label="Sold"
            value={sol(sold)}
            raw={sold}
            tone="text-negative"
          />
        </dl>
      </div>

      <AddWallet onAdd={m.add} count={wallets.length} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <WalletList
            wallets={wallets}
            update={m.update}
            remove={m.remove}
            activity={activity}
            now={now}
            fresh={fresh}
          />
        </div>
        <Delivery />
      </div>
    </section>
  );
}

function AddWallet({
  onAdd,
  count,
}: {
  onAdd: (a: string, l?: string) => boolean;
  count: number;
}) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const a = address.trim();
    if (!isAddress(a)) return setError("That is not a Solana wallet address");
    if (count >= MAX_MONITORED)
      return setError(`Up to ${MAX_MONITORED} wallets`);
    if (!onAdd(a, label.trim())) return setError("Already monitored");
    setAddress("");
    setLabel("");
    setError(null);
  };
  return (
    <form
      className="flex flex-wrap items-start gap-2 rounded-2xl border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex min-w-72 flex-1 flex-col gap-1 text-xs text-muted">
        Wallet address
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Paste a Solana wallet"
          spellCheck={false}
          className="h-9 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50"
        />
      </label>
      <label className="flex w-48 flex-col gap-1 text-xs text-muted">
        Name (optional)
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Whale 1"
          className="h-9 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-muted focus:border-emerald/50"
        />
      </label>
      <button
        type="submit"
        className="mt-5 flex h-9 items-center gap-1.5 rounded-lg bg-text px-4 text-sm font-medium text-bg hover:opacity-90"
      >
        <Plus size={14} strokeWidth={1.5} />
        Monitor
      </button>
      <p
        className={`basis-full text-xs ${error ? "text-negative" : "text-muted"}`}
      >
        {error ??
          `${count} of ${MAX_MONITORED} wallets. You can also add wallets from Smart Money`}
      </p>
    </form>
  );
}

function WalletList({
  wallets,
  update,
  remove,
  activity,
  now,
  fresh,
}: {
  wallets: MonitoredWallet[];
  update: (a: string, p: Partial<MonitoredWallet>) => void;
  remove: (a: string) => void;
  activity: Activity[];
  now: number;
  fresh: Set<string>;
}) {
  // One wallet open at a time; its trades show under its row.
  const [open, setOpen] = useState<string | null>(null);
  const tradesOf = (w: string) => activity.filter((a) => a.trade.wallet === w);
  if (!wallets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-8 py-12 text-center text-sm text-muted">
        No wallets yet. Add one above, or pick one from Smart Money
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-160 text-sm whitespace-nowrap">
        <thead>
          <tr className="h-10 border-b border-border text-left text-xs text-muted">
            <th className="pl-4 font-normal">Name</th>
            <th className="font-normal">Wallet</th>
            <th
              className="px-3 font-normal"
              title="Alert when this wallet buys at least this much"
            >
              Alert on buys over
            </th>
            <th className="px-3 font-normal">Alert on sells</th>
            <th className="px-3 font-normal">Activity</th>
            <th className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <Fragment key={w.address}>
              <tr
                className={`row-in h-12 border-b border-border hover:bg-surface-2 ${open === w.address ? "bg-surface-2" : ""}`}
              >
                <td className="pl-4">
                  <span className="flex items-center gap-2">
                    <WalletDot address={w.address} />
                    <input
                      value={w.label}
                      onChange={(e) =>
                        update(w.address, { label: e.target.value })
                      }
                      placeholder="Add a name"
                      aria-label="Wallet name"
                      className="h-8 w-36 rounded-md border border-transparent bg-transparent px-2 text-text outline-none placeholder:text-muted hover:border-border focus:border-emerald/50"
                    />
                  </span>
                </td>
                <td>
                  <CopyAddress value={w.address} className="text-cyan" />
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={w.minBuySol}
                      onChange={(e) =>
                        update(w.address, {
                          minBuySol: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      aria-label="Minimum buy in SOL"
                      className="h-8 w-20 rounded-md border border-border bg-bg px-2 text-sm text-text outline-none focus:border-emerald/50"
                    />
                    SOL
                  </span>
                </td>
                <td className="px-3">
                  <input
                    type="checkbox"
                    checked={w.sells}
                    onChange={() => update(w.address, { sells: !w.sells })}
                    aria-label="Alert on sells"
                    className="h-4 w-4 accent-emerald"
                  />
                </td>
                <td className="px-3">
                  <TradesToggle
                    open={open === w.address}
                    count={tradesOf(w.address).length}
                    onClick={() =>
                      setOpen((o) => (o === w.address ? null : w.address))
                    }
                  />
                </td>
                <td className="pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => remove(w.address)}
                    aria-label="Stop monitoring"
                    title="Stop monitoring"
                    className="text-muted hover:text-negative"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </td>
              </tr>
              {open === w.address && (
                <tr className="border-b border-border">
                  <td colSpan={6} className="p-0">
                    <WalletTradesPanel
                      trades={tradesOf(w.address)}
                      now={now}
                      fresh={fresh}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live trades of the monitored wallets, plus browser alerts for the ones that match a rule. */
function useWalletActivity(wallets: MonitoredWallet[]) {
  const key = wallets
    .map((w) => w.address)
    .sort()
    .join(",");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [live, setLive] = useState(false);
  // Signatures that arrived live (not history), so they animate in once.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // The socket handler reads the latest rules without reconnecting on every edit.
  const rules = useRef(wallets);
  const browser = useMonitor().prefs.browser;
  const notify = useRef(browser);
  useEffect(() => {
    rules.current = wallets;
    notify.current = browser;
  }, [wallets, browser]);

  useEffect(() => {
    if (!key) return;
    const ws = new WebSocket(
      `${GATEWAY_WS}/ws/wallets?w=${encodeURIComponent(key)}`,
    );
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "history") setActivity(msg.trades);
      if (msg.type === "trade") {
        const a: Activity = {
          mint: msg.mint,
          symbol: msg.symbol,
          trade: msg.trade,
        };
        setActivity((cur) => [a, ...cur].slice(0, MAX_ROWS));
        setFresh((cur) => new Set([...cur, a.trade.signature].slice(-50)));
        const w = rules.current.find((x) => x.address === a.trade.wallet);
        const hit =
          w && (a.trade.is_buy ? a.trade.sol >= w.minBuySol : w.sells);
        if (
          hit &&
          notify.current &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          const n = new Notification(
            `${w.label || "Wallet"} ${a.trade.is_buy ? "bought" : "sold"} ${a.symbol ?? "a coin"}`,
            {
              body: `${a.trade.sol.toFixed(2)} SOL · click to open the coin`,
              tag: a.trade.signature,
            },
          );
          // One click from the alert to the coin's trade page.
          n.onclick = () => {
            window.focus();
            window.location.assign(tokenHref(a.mint));
            n.close();
          };
        }
      }
    };
    return () => {
      ws.onclose = null;
      // A socket still connecting is closed once it opens (avoids a console warning).
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    };
  }, [key]);

  return { activity: key ? activity : [], live: key ? live : false, fresh };
}

/** Where alerts go. Browser alerts work now; Telegram and Discord switch on once the
 *  gateway has MONEXA's bot and accounts store these settings. */
function Delivery() {
  const m = useMonitor();
  const [status, setStatus] = useState<{
    telegram: boolean;
    server_delivery: boolean;
  } | null>(null);
  useEffect(() => {
    fetch(`${GATEWAY_HTTP}/alerts/status`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  const webhookOk =
    !m.prefs.discordWebhook ||
    /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(
      m.prefs.discordWebhook.trim(),
    );

  const enableBrowser = async () => {
    if (
      !m.prefs.browser &&
      typeof Notification !== "undefined" &&
      Notification.permission !== "granted"
    ) {
      if ((await Notification.requestPermission()) !== "granted") return;
    }
    m.set({ browser: !m.prefs.browser });
  };

  return (
    <aside className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm font-medium text-text">Alert delivery</p>

      <Channel
        icon={Bell}
        title="Browser"
        state={m.prefs.browser ? "On" : "Off"}
        on={m.prefs.browser}
      >
        <label className="flex items-center justify-between text-sm text-text-2">
          Notify while MONEXA is open
          <input
            type="checkbox"
            checked={m.prefs.browser}
            onChange={enableBrowser}
            className="h-4 w-4 accent-emerald"
          />
        </label>
      </Channel>

      <Channel
        icon={Send}
        title="Telegram"
        state={status?.telegram ? "Bot ready" : "Bot not connected yet"}
        on={false}
      >
        <ol className="list-decimal space-y-1 pl-4 text-xs text-text-2">
          <li>
            Open MONEXA&apos;s Telegram bot (link appears here once it is live)
          </li>
          <li>Press Start. The bot replies with your chat ID</li>
          <li>Paste the chat ID below</li>
        </ol>
        <input
          value={m.prefs.telegramChatId}
          onChange={(e) => m.set({ telegramChatId: e.target.value.trim() })}
          placeholder="Chat ID, for example 123456789"
          inputMode="numeric"
          className="mt-2 h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-sm text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50"
        />
      </Channel>

      <Channel
        icon={MessageSquare}
        title="Discord"
        state={
          m.prefs.discordWebhook
            ? webhookOk
              ? "Webhook saved"
              : "Check the link"
            : "Not set"
        }
        on={false}
      >
        <ol className="list-decimal space-y-1 pl-4 text-xs text-text-2">
          <li>
            In your Discord server: channel settings, Integrations, Webhooks,
            New webhook
          </li>
          <li>Copy the webhook URL and paste it below</li>
        </ol>
        <input
          value={m.prefs.discordWebhook}
          onChange={(e) => m.set({ discordWebhook: e.target.value.trim() })}
          placeholder="https://discord.com/api/webhooks/…"
          spellCheck={false}
          className={`mt-2 h-9 w-full rounded-lg border bg-bg px-3 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50 ${
            webhookOk ? "border-border" : "border-negative/50"
          }`}
        />
        <p className="mt-1 text-[11px] text-muted">
          Anyone with this link can post in that channel. Keep it private
        </p>
      </Channel>

      <p className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-2">
        {status?.server_delivery
          ? "Telegram and Discord alerts are live, even when MONEXA is closed"
          : "Telegram and Discord delivery switch on when MONEXA accounts launch. Until then your settings stay in this browser, and browser alerts work now"}
      </p>
    </aside>
  );
}

function Channel({
  icon: Icon,
  title,
  state,
  on,
  children,
}: {
  icon: typeof Bell;
  title: string;
  state: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-text">
          <Icon size={14} strokeWidth={1.5} className="text-muted" />
          {title}
        </span>
        <span className={`text-xs ${on ? "text-emerald" : "text-muted"}`}>
          {state}
        </span>
      </div>
      {children}
    </div>
  );
}

function HeadStat({
  label,
  value,
  raw,
  tone = "text-text",
}: {
  label: string;
  value: string;
  raw?: number;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-xl ${tone}`}>
        <Tick value={raw}>{value}</Tick>
      </dd>
    </div>
  );
}
