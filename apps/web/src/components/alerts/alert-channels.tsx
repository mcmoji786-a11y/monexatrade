"use client";
/* Where alerts go when Kixo is closed: Email, Telegram and Discord. Used in Settings
   (Notifications) and in Wallet Monitor. The gateway sends them (alerts.rs). */
import { useEffect, useState } from "react";
import { Loader2, Mail, MessageSquare, Send } from "lucide-react";
import { openLogin, useAccount } from "@/lib/account";
import { useFeatures } from "@/lib/features";
import { pushToast } from "@/lib/toast";
import { getStatus, pullAlerts, saveAlerts, sendTest, telegramLink, telegramUnlink, useRemoteAlerts, type AlertStatus } from "@/lib/alerts";

const HOOK = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]{20,100}$/;

function message(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  return m && m.length < 160 ? m : "Something went wrong. Try again";
}

export function AlertChannels() {
  const auth = useAccount();
  const f = useFeatures();
  const remote = useRemoteAlerts();
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "email" | "telegram" | "discord" | "test" | "unlink">(null);
  const [waitingTg, setWaitingTg] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    void getStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  // The account copy loads in AlertSync; if it has not, ask once and say why.
  useEffect(() => {
    if (!signedIn || remote) return;
    const id = setTimeout(() => {
      void pullAlerts()
        .then(() => setLoadErr(null))
        .catch((e) => setLoadErr(/not set up/i.test(message(e)) ? "Not set up on Kixo yet" : message(e)));
    }, 4_000);
    return () => clearTimeout(id);
  }, [signedIn, remote]);

  // After opening the bot link: watch for the chat to connect, for two minutes.
  useEffect(() => {
    if (!waitingTg) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      void pullAlerts()
        .then((r) => {
          if (r.telegram) {
            setWaitingTg(false);
            pushToast({ tone: "good", title: "Telegram connected", body: "Alerts will reach this chat when Kixo is closed" });
          }
        })
        .catch(() => {});
      if (n >= 40) setWaitingTg(false);
    }, 3_000);
    return () => clearInterval(id);
  }, [waitingTg]);

  if (!f.alert_delivery) return <p className="px-5 py-4 text-sm text-muted">Alerts outside Kixo are switched off right now</p>;
  if (!signedIn) {
    return (
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-2">Sign in to get your alerts by Email, Telegram or Discord, even when Kixo is closed</p>
        <button type="button" onClick={() => openLogin("/settings")} className="h-8 shrink-0 rounded-lg bg-text px-3 text-sm text-bg hover:opacity-90">
          Sign in
        </button>
      </div>
    );
  }
  if (!remote) return <p className="px-5 py-4 text-sm text-muted">{status && !status.server_delivery ? "Alerts outside Kixo are switched off right now" : (loadErr ?? "Loading")}</p>;

  const hookValue = hook ?? remote.discord_webhook;
  const hookOk = !hookValue || HOOK.test(hookValue.trim());
  const anyOn = remote.telegram || remote.email_on || !!remote.discord_webhook;

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      pushToast({ tone: "bad", title: "Not saved", body: message(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="divide-y divide-border">
      <Line icon={Mail} title="Email" hint={status?.email ? `To ${remote.account_email ?? "your account email"}. Up to 10 an hour` : "Email sending is not set up on Kixo yet"}>
        <input
          type="checkbox"
          aria-label="Email alerts"
          checked={remote.email_on}
          disabled={!status?.email || !remote.account_email || busy === "email"}
          onChange={(e) => run("email", () => saveAlerts({ email_on: e.target.checked }))}
          className="h-4 w-4 accent-emerald disabled:opacity-40"
        />
      </Line>

      <Line
        icon={Send}
        title="Telegram"
        hint={remote.telegram ? "Connected. Alerts arrive in your chat with Kixo's bot" : status?.telegram ? (waitingTg ? "Press Start in Telegram, then come back here" : "Opens Kixo's bot. Press Start and it is connected") : "Kixo's Telegram bot is not set up yet"}
      >
        {remote.telegram ? (
          <button
            type="button"
            disabled={busy === "unlink"}
            onClick={() =>
              run("unlink", async () => {
                await telegramUnlink();
                await pullAlerts();
              })
            }
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-2 hover:bg-surface-2 hover:text-text"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={!status?.telegram || busy === "telegram"}
            onClick={() =>
              run("telegram", async () => {
                const { url } = await telegramLink();
                window.open(url, "_blank", "noopener");
                setWaitingTg(true);
              })
            }
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
          >
            {waitingTg && <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />}
            Connect Telegram
          </button>
        )}
      </Line>

      <div className="px-5 py-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} strokeWidth={1.5} className="text-muted" />
          <p className="text-sm text-text">Discord</p>
          <span className={`ml-auto text-xs ${remote.discord_webhook ? "text-emerald" : "text-muted"}`}>{remote.discord_webhook ? "On" : "Off"}</span>
        </div>
        <p className="mt-1 text-xs text-muted">In your Discord server: channel settings, Integrations, Webhooks, New webhook. Paste its link here. Keep it private</p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!hookOk) return;
            void run("discord", async () => {
              await saveAlerts({ discord_webhook: hookValue.trim() });
              setHook(null);
            });
          }}
        >
          <input
            value={hookValue}
            onChange={(e) => setHook(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            spellCheck={false}
            aria-label="Discord webhook link"
            className={`h-8 min-w-0 flex-1 rounded-lg border bg-bg px-3 font-mono text-xs text-text outline-none placeholder:font-sans placeholder:text-muted focus:border-emerald/50 ${hookOk ? "border-border" : "border-negative/50"}`}
          />
          <button type="submit" disabled={!hookOk || hook === null || busy === "discord"} className="h-8 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2 disabled:opacity-40">
            {hookValue ? "Save" : "Remove"}
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">Sent: your price alerts, Wallet Monitor trades and dev sells on starred coins. Up to 30 an hour</p>
        <div className="flex shrink-0 items-center gap-3">
          {result && <span className="text-xs text-text-2">{result}</span>}
          <button
            type="button"
            disabled={!anyOn || busy === "test"}
            onClick={() =>
              run("test", async () => {
                const r = await sendTest();
                const parts = Object.entries(r.sent).map(([k, ok]) => `${k[0].toUpperCase()}${k.slice(1)} ${ok ? "sent" : "failed"}`);
                setResult(parts.length ? parts.join(", ") : "No channel on");
              })
            }
            className="h-8 rounded-lg border border-border px-3 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
          >
            Send a test
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({ icon: Icon, title, hint, children }: { icon: typeof Mail; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-text">
          <Icon size={14} strokeWidth={1.5} className="text-muted" />
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
