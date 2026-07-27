import { he } from "@/content/he";

/**
 * The Super MCP lockup: mark plus wordmark.
 *
 * The mark is the same product idea as the ledger section, drawn twice: a long
 * faint bar for what the nearer shop charges, a short solid bar for the answer.
 * Right-aligned because the product is Hebrew RTL.
 *
 * Geometry is mirrored in public/favicon.svg. Keep the two in step.
 */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        viewBox="0 0 32 32"
        aria-hidden
        className="size-7 shrink-0"
      >
        <rect width="32" height="32" rx="7.5" fill="var(--color-accent)" />
        <rect x="7" y="10.25" width="18" height="3.5" rx="1.75" fill="#fff" opacity=".45" />
        <rect x="14" y="18.25" width="11" height="3.5" rx="1.75" fill="#fff" />
      </svg>
      <span dir="ltr" className="display text-lg text-[var(--color-ink)]">
        {he.header.brand}
      </span>
    </span>
  );
}
