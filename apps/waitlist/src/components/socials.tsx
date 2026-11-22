import { SOCIALS } from "@/lib/socials";

/* Kixo's X, Instagram and Discord. `icons` for the top bar (icons only), otherwise a row
   with names for the pass and the footer. */

const PATHS: Record<(typeof SOCIALS)[number]["key"], React.ReactNode> = {
  x: <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.33l4.38 5.79L17.75 3Zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44Z" />,
  instagram: (
    <path d="M12 2.2c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85C2.42 3.92 3.94 2.38 7.15 2.23 8.42 2.21 8.8 2.2 12 2.2Zm0 4.86a4.94 4.94 0 1 0 0 9.88 4.94 4.94 0 0 0 0-9.88Zm0 8.15a3.21 3.21 0 1 1 0-6.42 3.21 3.21 0 0 1 0 6.42Zm5.14-9.5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
  ),
  discord: (
    <path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.8a13.7 13.7 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 13.2 13.2 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.93 1.53C.53 9.04-.32 13.58.1 18.06a19.9 19.9 0 0 0 6.04 3.05 14.6 14.6 0 0 0 1.29-2.1 12.9 12.9 0 0 1-2.04-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.2 0l.5.38c-.65.38-1.33.71-2.04.98.37.74.8 1.44 1.29 2.1a19.8 19.8 0 0 0 6.04-3.06c.5-5.18-.84-9.68-3.56-13.7ZM8.02 15.33c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.34-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.34-.94 2.42-2.15 2.42Z" />
  ),
};

function Icon({ k, size }: { k: (typeof SOCIALS)[number]["key"]; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {PATHS[k]}
    </svg>
  );
}

export function Socials({ icons = false }: { icons?: boolean }) {
  if (icons) {
    return (
      <div className="social-icons">
        {SOCIALS.map((s) => (
          <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
            <Icon k={s.key} size={17} />
          </a>
        ))}
      </div>
    );
  }
  return (
    <div className="socials">
      <p className="socials-title">Follow Kixo for the launch</p>
      <div className="socials-row">
        {SOCIALS.map((s) => (
          <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" className="btn-ghost" aria-label={s.label}>
            <Icon k={s.key} size={16} />
            {s.name}
          </a>
        ))}
      </div>
    </div>
  );
}
