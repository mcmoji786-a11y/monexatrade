import { notFound } from "next/navigation";
import { BUILT, NAV } from "@/lib/nav";
import { SectionPlaceholder } from "@/components/section-placeholder";

export function generateStaticParams() {
  return NAV.filter((n) => n.slug && !BUILT.has(n.slug)).map((n) => ({ section: n.slug }));
}

export default async function SectionPage({ params }: PageProps<"/[section]">) {
  const { section } = await params;
  const item = NAV.find((n) => n.slug === section);
  if (!item || BUILT.has(item.slug)) notFound();
  return <SectionPlaceholder title={item.label} phase={item.phase} />;
}
