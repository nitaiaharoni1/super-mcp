import { cn } from "@/lib/utils";

/*
 * The hand-drawn layer of the sticker-ledger system: the sparkle, the pixel
 * plus, the squiggle underline and the marker arrow, all from the reference
 * shelf-sign language. Colour always comes from the parent via currentColor,
 * so every usage stays inside the locked palette.
 */

/** Four-point sparkle, the "new price" star of shelf signage. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("fill-current", className)}>
      <path d="M32 2 L39.5 24.5 L62 32 L39.5 39.5 L32 62 L24.5 39.5 L2 32 L24.5 24.5 Z" />
    </svg>
  );
}

/** A genuine pixel-art plus: five squares, no curves. */
export function PixelPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 5 5" aria-hidden className={cn("fill-current", className)} shapeRendering="crispEdges">
      <rect x="2" y="0" width="1" height="5" />
      <rect x="0" y="2" width="5" height="1" />
    </svg>
  );
}

/** Marker squiggle, used once per page at most: under the ledger title. */
export function Squiggle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 16"
      aria-hidden
      className={cn("fill-none stroke-current", className)}
      preserveAspectRatio="none"
    >
      <path
        d="M4 10 Q 16 2 28 9 T 52 9 T 76 9 T 100 9 T 124 9 T 148 9 T 172 9 T 196 9"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/*
 * The marker arrow from the copy toward the chat artifact. Drawn pointing
 * down-left because in the RTL hero the artifact sits left of the copy.
 * Rendered only on wide screens, where the two columns actually coexist.
 */
export function HandArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 90"
      aria-hidden
      className={cn("fill-none stroke-current", className)}
    >
      <path d="M108 10 C 86 54 48 72 18 62" strokeWidth="5" strokeLinecap="round" />
      <path d="M34 50 L18 62 L31 74" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
