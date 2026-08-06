# Styling

## Stack

Next.js 15 / React 19 with Tailwind 4, loaded via `@import "tailwindcss"` in `src/app/globals.css`. No CSS modules, no styled-components.

## Conventions

- The design system is "sticker ledger" (שלט השוק) and its rules are written at the top of `src/app/globals.css`. Read that comment before changing a token — the colour semantics are deliberate, not decorative.
- Colour carries meaning: `grape` is the brand, `lime` is savings and the single CTA intent (ink text only), `over` is the AA-safe deep tangerine and the only colour allowed on a delta or a missing line. The `-soft` tints are decorative and mean nothing.
- Shape is locked: everything is `--radius-card` (8px) or a full pill. Shadows offset down-LEFT because the page is RTL, so the shadow follows the reading direction.
- `--color-ink-faint` is the lightest tint still clearing WCAG AA at 12px on cream. Do not go lighter for footnotes or captions.

## File Organization

- `src/app/globals.css` — the whole design system: `@theme` tokens, colour, typography, and the documented rules above.
- `src/components/marketing/` — page sections (`Hero`, `PriceLedger`, `Coverage`, `Connect`, …).
- `src/components/shared/` — cross-section pieces (`Container`, `Reveal`, `CodeBlock`, `CopyButton`, doodles).
- `src/components/ui/` — the primitive layer (`button.tsx`, class-variance-authority variants).
- `src/content/he.ts` — every string. Components take copy from here; they never hard-code Hebrew.

## Adding New Components

- Compose Tailwind utilities against the `@theme` tokens; never introduce a raw hex or an off-system radius.
- For variants, follow `components/ui/button.tsx` — `class-variance-authority` for the variant map, `tailwind-merge` via `lib/utils.ts` for merging.
- The page is RTL: prefer logical utilities (`ms-`, `me-`, `start-`, `end-`) over `ml-`/`mr-`, and mirror any new shadow offset to the left.
- Reveals and progressive disclosure must work with CSS only, so copy is never hidden behind JavaScript.
