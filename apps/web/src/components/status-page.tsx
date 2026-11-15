/* The quiet page shown for a missing page or a page that broke: the mark, what happened
   in one line, and two ways on. Used by not-found, error and global-error. */
import Link from "next/link";
import { KixoMark } from "@/components/brand";

export function StatusPage({
  code,
  title,
  body,
  action,
}: {
  code: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-bg px-4 py-16">
      <section className="fade-up w-full max-w-md text-center">
        <KixoMark size={40} className="mx-auto" />
        <p className="mt-6 font-mono text-xs text-muted">{code}</p>
        <h1 className="mt-2 text-2xl font-medium text-text">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-text-2">{body}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {action}
          <Link href="/discover" className="flex h-10 items-center rounded-lg border border-border px-4 text-sm text-text transition-colors hover:bg-surface-2">
            Go to Discover
          </Link>
          <Link href="/support" className="flex h-10 items-center rounded-lg px-3 text-sm text-text-2 hover:text-text">
            Get help
          </Link>
        </div>
      </section>
    </main>
  );
}
