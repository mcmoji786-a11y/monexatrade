import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BUILT, NAV } from "@/lib/nav";
import { SectionPlaceholder } from "@/components/section-placeholder";

export function generateStaticParams() {
  return NAV.filter((n) => n.slug && !BUILT.has(n.slug)).map((n) => ({ section: n.slug }));
}

/** Sections still in development. Reading the URL happens inside Suspense so
 *  navigation stays instant (Next.js cache components). */
export default function SectionPage({ params }: PageProps<"/[section]">) {
  return (
    <Suspense fallback={null}>
      <Section params={params} />
    </Suspense>
  );
}

async function Section({ params }: { params: PageProps<"/[section]">["params"] }) {
  const { section } = await params;
  const item = NAV.find((n) => n.slug === section);
  if (!item || BUILT.has(item.slug)) notFound();
  return <SectionPlaceholder title={item.label} phase={item.phase} />;
}
