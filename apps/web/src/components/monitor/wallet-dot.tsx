/** A small mark that tells wallets apart at a glance: a colour derived from the address,
 *  the same everywhere (Smart Money, Wallet Monitor, activity). It identifies, nothing more. */
export function WalletDot({ address, size = 20 }: { address: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  // Hues on the cool side, away from green and red, which mean buy and sell here.
  const hues = [175, 190, 200, 212, 224, 30, 45, 60];
  const hue = hues[h % hues.length];
  const letter = address.slice(0, 2);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-mono text-[9px] text-bg"
      style={{ width: size, height: size, background: `oklch(0.72 0.09 ${hue})` }}
    >
      {size >= 24 ? letter : ""}
    </span>
  );
}
