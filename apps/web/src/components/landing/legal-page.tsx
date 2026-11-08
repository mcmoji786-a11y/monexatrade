import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/sections";
import { LEGAL_UPDATED, type LegalSection } from "@/lib/legal";

/** A legal page: numbered sections in plain words. */
export function LegalPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: string; sections: LegalSection[] }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-200 px-4 pt-16 pb-24 md:px-8 md:pt-20">
        <p className="font-mono text-xs text-emerald">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-medium leading-tight text-text md:text-5xl">{title}</h1>
        <p className="mt-4 text-base leading-7 text-text-2">{intro}</p>
        <p className="mt-2 font-mono text-xs text-muted">Last updated {LEGAL_UPDATED}</p>
        <ol className="mt-12 divide-y divide-border border-y border-border">
          {sections.map((s, i) => (
            <li key={s.title} className="grid gap-3 py-8 md:grid-cols-[48px_1fr]">
              <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2 className="text-lg text-text">{s.title}</h2>
                {s.body.map((p) => (
                  <p key={p.slice(0, 40)} className="mt-3 text-sm leading-7 text-text-2">
                    {p}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </>
  );
}
