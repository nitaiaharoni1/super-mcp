import { he } from "@/content/he";

/**
 * The SuperMCP lockup: mark plus wordmark.
 *
 * The wordmark is one word, set in Archivo Black, which appears nowhere else
 * on the page. Two words in the same face as the Hebrew headings read as
 * bolded body text rather than as a name. MCP keeps its capitals: it is an
 * acronym, and lowercasing it would lose the only part of the name that says
 * what this connects to.
 *
 * The mark is a shopping basket whose body is a barcode: basket + price-scan
 * in one shape, stickered in grape with an ink border and a hard shadow.
 * Geometry is mirrored in public/favicon.svg and in brand/og.html. Keep them
 * in step.
 */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        viewBox="0 0 32 32"
        aria-hidden
        className="size-8 -translate-y-0.5 shrink-0 rounded-[var(--radius-card)] shadow-sticker-sm"
      >
        <rect
          width="32"
          height="32"
          rx="7.5"
          fill="var(--color-grape)"
          stroke="var(--color-ink)"
          strokeWidth="2"
        />
        <path
          d="M6.2 15.0 L11.2 8.5 H20.8 L25.8 15.0"
          fill="none"
          stroke="#fff"
          strokeWidth="1.4"
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
        <rect x="5.84" y="14.9" width="2.22" height="9.9" fill="#fff" />
        <rect x="8.91" y="14.9" width="1.53" height="9.9" fill="#fff" />
        <rect x="11.28" y="14.9" width="1.84" height="9.9" fill="#fff" />
        <rect x="13.97" y="14.9" width="0.78" height="9.9" fill="#fff" />
        <rect x="15.59" y="14.9" width="2.84" height="9.9" fill="#fff" />
        <rect x="19.31" y="14.9" width="2.16" height="9.9" fill="#fff" />
        <rect x="22.31" y="14.9" width="0.78" height="9.9" fill="#fff" />
        <rect x="23.94" y="14.9" width="2.25" height="9.9" fill="#fff" />
      </svg>
      <span
        dir="ltr"
        className="font-[family-name:var(--font-wordmark)] text-[1.15rem] leading-none tracking-[-0.01em] text-[var(--color-ink)]"
      >
        {he.header.brand}
      </span>
    </span>
  );
}
