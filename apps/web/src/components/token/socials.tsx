import { Globe, Send } from "lucide-react";

/** X, Telegram and website links of a coin. URLs are https-validated by the gateway.
 *  Clicks never open the row or card they sit in. */
export function Socials({ twitter, telegram, website }: { twitter: string | null; telegram: string | null; website: string | null }) {
  if (!twitter && !telegram && !website) return null;
  return (
    <span className="flex items-center gap-0.5">
      {twitter && (
        <Social href={twitter} label="X / Twitter">
          <XGlyph />
        </Social>
      )}
      {telegram && (
        <Social href={telegram} label="Telegram">
          <Send size={13} strokeWidth={1.5} />
        </Social>
      )}
      {website && (
        <Social href={website} label="Website">
          <Globe size={13} strokeWidth={1.5} />
        </Social>
      )}
    </span>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-3 hover:text-text"
    >
      {children}
    </a>
  );
}

function XGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.7l7.9-9.1L1 2h7l4.8 6.4L18.9 2Zm-1.2 18h1.9L7.4 4H5.4l12.3 16Z" />
    </svg>
  );
}
