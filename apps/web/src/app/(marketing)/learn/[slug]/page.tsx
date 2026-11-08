import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/sections";
import { JsonLd } from "@/components/seo/json-ld";
import { buttonClass } from "@/components/ui/button";
import { GUIDES, guide, type Block } from "@/lib/guides";
import { SITE_URL } from "@/lib/site";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">): Promise<Metadata> {
  const g = guide((await params).slug);
  if (!g) return {};
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: `/learn/${g.slug}` },
    openGraph: { type: "article", title: g.title, description: g.description, url: `/learn/${g.slug}`, modifiedTime: g.updated },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

export default async function GuidePage({ params }: PageProps<"/learn/[slug]">) {
  const g = guide((await params).slug);
  if (!g) notFound();
  const url = `${SITE_URL}/learn/${g.slug}`;
  const date = new Date(`${g.updated}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: g.title,
            description: g.description,
            dateModified: g.updated,
            datePublished: g.updated,
            mainEntityOfPage: url,
            author: { "@type": "Organization", name: "Kixo", url: SITE_URL },
            publisher: { "@type": "Organization", name: "Kixo", logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/kixo-mark.png` } },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Kixo", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Learn", item: `${SITE_URL}/learn` },
              { "@type": "ListItem", position: 3, name: g.title, item: url },
            ],
          },
        ]}
      />
      <SiteNav />
      <main className="mx-auto max-w-300 px-4 pt-12 pb-24 md:px-8 md:pt-16">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-muted">
          <Link href="/learn" className="hover:text-text">Learn</Link>
          <span className="mx-2">/</span>
          <span className="text-text-2">{g.minutes} min read</span>
        </nav>
        <article className="mt-6 max-w-2xl">
          <h1 className="text-3xl font-medium leading-tight text-text md:text-[44px] md:leading-[1.1]">{g.title}</h1>
          <p className="mt-4 text-lg leading-8 text-text-2">{g.description}</p>
          <p className="mt-4 font-mono text-xs text-muted">Updated {date}</p>

          {g.sections.map((s) => (
            <section key={s.h} className="mt-12">
              <h2 className="text-xl font-medium text-text">{s.h}</h2>
              <div className="mt-4 flex flex-col gap-4">
                {s.body.map((b, i) => (
                  <Body key={i} b={b} />
                ))}
              </div>
            </section>
          ))}

          <div className="mt-14 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-6">
            <p className="min-w-0 flex-1 text-sm leading-6 text-text-2">Try it on live Solana data with a free demo account. No real money needed</p>
            <Link href={g.cta.href} className={buttonClass("primary", "md")}>
              {g.cta.label}
            </Link>
          </div>
        </article>

        <aside className="mt-20 max-w-2xl border-t border-border pt-8">
          <h2 className="text-sm font-medium text-text">Keep reading</h2>
          <ul className="mt-4 flex flex-col">
            {g.related.map((slug) => guide(slug)).filter((r) => r != null).map((r) => (
              <li key={r.slug}>
                <Link href={`/learn/${r.slug}`} className="group flex items-center justify-between gap-4 border-b border-border py-4 text-text-2 hover:text-text">
                  {r.title}
                  <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </main>
      <SiteFooter />
    </>
  );
}

function Body({ b }: { b: Block }) {
  if ("p" in b) return <p className="text-base leading-7 text-text-2">{b.p}</p>;
  if ("note" in b) return <p className="border-l-2 border-warning/60 pl-4 text-sm leading-6 text-text-2">{b.note}</p>;
  if ("steps" in b)
    return (
      <ol className="flex flex-col gap-3">
        {b.steps.map((x, i) => (
          <li key={x} className="grid grid-cols-[28px_1fr] text-base leading-7 text-text-2">
            <span className="font-mono text-sm leading-7 text-emerald">{i + 1}.</span>
            {x}
          </li>
        ))}
      </ol>
    );
  return (
    <ul className="flex flex-col gap-2">
      {b.list.map((x) => (
        <li key={x} className="grid grid-cols-[20px_1fr] text-base leading-7 text-text-2">
          <span className="mt-3 h-1 w-1 rounded-full bg-text-2" aria-hidden="true" />
          {x}
        </li>
      ))}
    </ul>
  );
}
