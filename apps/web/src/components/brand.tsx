import Image from "next/image";

/** The Kixo mark (the green K), on a transparent background. */
export function KixoMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <Image src={size > 64 ? "/brand/kixo-mark.png" : "/brand/kixo-mark-128.png"} alt="" width={size} height={size} className={`shrink-0 ${className}`} priority />;
}

/** The mark and the name together, for headers and footers. */
export function KixoLogo({ size = 22, text = "text-base", className = "" }: { size?: number; text?: string; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <KixoMark size={size} />
      <span className={`font-semibold tracking-tight text-text ${text}`}>Kixo</span>
    </span>
  );
}
