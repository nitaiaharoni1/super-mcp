import { he } from "@/content/he";

/**
 * The SuperMCP lockup: mark plus wordmark.
 *
 * The wordmark is one word, set in Gabarito, which appears nowhere else on the
 * page. Two words in the same face as the Hebrew headings read as bolded body
 * text rather than as a name. MCP keeps its capitals: it is an acronym, and
 * lowercasing it would lose the only part of the name that says what this
 * connects to.
 *
 * The mark is a shopping basket with one item dropping into it, rebuilt by hand
 * from a Recraft concept. Geometry is mirrored in public/favicon.svg and in
 * brand/og.html. Keep them in step.
 */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" aria-hidden className="size-7 shrink-0">
        <rect width="32" height="32" rx="7.5" fill="var(--color-accent)" />
        {/* Item first, basket second: the rim occludes it, so it reads as going in. */}
        <rect x="13.9" y="7.4" width="4.6" height="4.6" rx="1.15" fill="var(--color-over-band)" />
        <path
          d="M6.8 12.6 H25.2 A1.3 1.3 0 0 1 26.5 14.2 L23 25.1 Q22.7 26.1 21.6 26.1 H10.4 Q9.3 26.1 9 25.1 L5.5 14.2 A1.3 1.3 0 0 1 6.8 12.6 Z"
          fill="#fff"
        />
      </svg>
      <span
        dir="ltr"
        className="font-[family-name:var(--font-wordmark)] text-[1.2rem] font-bold leading-none tracking-[-0.035em] text-[var(--color-ink)]"
      >
        {he.header.brand}
      </span>
    </span>
  );
}
