"use client";
/* Auto trade with Kixo AI ("Copy Kixo AI"): the sniper engine with the AI's rules
   (lib/sniper.ts AI_PRESET). Three plain steps: amount, start, results. Buys go to the
   account the sniper trades on (demo by default). */
import Link from "next/link";
import { activePreset, AI_PRESET, pnl, useSniper } from "@/lib/sniper";
import { useSniperAccount } from "@/components/sniper/sniper-engine";
import { tokenHref } from "@/lib/open-token";

const AMOUNTS = [10, 25, 50, 100];

export function CopyAiCard() {
  const { settings, positions, update } = useSniper();
  const { account, why } = useSniperAccount();
  const onAi = activePreset(settings) === AI_PRESET.key;
  const running = settings.enabled && onAi;
  const otherRules = settings.enabled && !onAi;
  const amount = settings.buyUnit === "USD" && AMOUNTS.includes(settings.buyUsd) ? settings.buyUsd : 25;

  const mine = positions.filter((p) => p.ai);
  const open = mine.filter((p) => !p.exitTs);
  const closed = mine.filter((p) => p.exitTs);
  const wins = closed.filter((p) => (pnl(p, null)?.sol ?? 0) > 0).length;
  const realized = closed.reduce((s, p) => s + (pnl(p, null)?.sol ?? 0), 0);
  const where = account === "real" ? "your real wallet" : account === "demo" ? "your demo account" : "paper (sign in to use demo)";

  const start = () => update({ ...AI_PRESET.patch, enabled: true, buyUnit: "USD", buyUsd: amount });
  const pickAmount = (a: number) => update({ buyUnit: "USD", buyUsd: a });

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-medium text-text">Let Kixo AI trade for you</h2>
        <p className="mt-1 text-sm text-text-2">
          When the AI marks a new coin <span className="text-positive">Good odds</span>, {where} buys it. It sells by itself when the price doubles, falls 40%, or
          after one hour
        </p>
      </div>

      <ol className="grid gap-px bg-border md:grid-cols-3">
        <Step n={1} title="Pick an amount per trade">
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => pickAmount(a)}
                aria-pressed={amount === a}
                className={`h-10 rounded-lg border font-mono text-sm transition-colors ${
                  amount === a ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-border text-text-2 hover:bg-surface-2 hover:text-text"
                }`}
              >
                ${a}
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title={running ? "Kixo AI is trading" : "Start"}>
          {running ? (
            <div className="mt-3 flex flex-col gap-2">
              <span className="flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald/40 bg-emerald/10 text-sm text-emerald">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                Running, ${amount} a trade
              </span>
              <button type="button" onClick={() => update({ enabled: false })} className="h-9 rounded-lg text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
                Stop
              </button>
            </div>
          ) : (
            <button type="button" onClick={start} className="mt-3 h-10 w-full rounded-lg bg-emerald text-sm font-medium text-bg transition-opacity hover:opacity-90">
              Start with ${amount} a trade
            </button>
          )}
          {otherRules && <p className="mt-2 text-xs text-warning">Your Sniper is running its own rules. Starting switches it to the AI&apos;s</p>}
          {why && <p className="mt-2 text-xs text-muted">{why}</p>}
        </Step>

        <Step n={3} title="Watch the results">
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <Fig label="Open now" value={String(open.length)} />
            <Fig label="Won" value={closed.length ? `${wins} of ${closed.length}` : "—"} />
            <Fig
              label="Profit"
              value={closed.length ? `${realized >= 0 ? "+" : "−"}${Math.abs(realized).toFixed(3)}` : "—"}
              unit={closed.length ? "SOL" : undefined}
              tone={realized > 0 ? "text-positive" : realized < 0 ? "text-negative" : "text-text"}
            />
          </dl>
        </Step>
      </ol>

      {mine.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {mine.slice(0, 6).map((p) => {
            const r = pnl(p, null);
            return (
              <li key={p.id} className="flex h-11 items-center gap-3 px-5 text-sm">
                <Link href={tokenHref(p.mint)} className="min-w-0 flex-1 truncate text-text hover:underline">
                  {p.symbol || p.mint.slice(0, 6)}
                </Link>
                <span className="text-xs text-muted">{p.exitTs ? (p.reason ?? "sold") : "open"}</span>
                {p.exitTs && r && r.pct != null && (
                  <span className={`w-20 text-right font-mono text-xs ${r.pct >= 0 ? "text-positive" : "text-negative"}`}>
                    {r.pct >= 0 ? "+" : "−"}
                    {Math.abs(r.pct).toFixed(0)}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1 border-t border-border px-5 py-3 text-xs text-muted">
        <p>
          Runs while Kixo is open in your browser.{" "}
          <Link href="/sniper" className="text-cyan hover:underline">
            Every trade on the Sniper page
          </Link>
        </p>
        <p>Honest note: in testing, buying the AI&apos;s favourites still lost money after fees. Try it on demo before real money</p>
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="bg-surface px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border font-mono text-xs text-text-2">{n}</span>
        <h3 className="text-sm text-text">{title}</h3>
      </div>
      {children}
    </li>
  );
}

function Fig({ label, value, unit, tone = "text-text" }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm whitespace-nowrap ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] text-muted">{unit}</span>}
      </dd>
    </div>
  );
}
