import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  // Emerald with near-black text: 9.9:1 contrast.
  primary: "bg-emerald text-bg hover:bg-[#4ee0aa] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
  secondary: "border border-border bg-surface-2 text-text hover:bg-surface-3",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
};

const SIZES: Record<Size, string> = {
  md: "h-9 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

/** A link styled as a button. Use for navigation (Trade now, Launch app). */
export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
