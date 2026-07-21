# Super MCP Marketing Landing — Design

Single-page Hebrew marketing site for Super MCP, aimed at AI agent builders who connect via Cursor / Claude MCP.

**Date:** 2026-07-21  
**Status:** Approved

---

## Goals

- Convert MCP users with one clear action: **התחבר** (connect in Cursor / Claude).
- Feel grocery-real and Israel-local: warm paper, concrete prices/places, not Silicon Valley SaaS.
- Ship as a small, reusable component architecture inside the monorepo.
- Deploy on **Firebase App Hosting**.

## Non-goals (v1)

- Waitlist / email capture
- Auth UI or API key dashboard
- Live API playground
- Pricing page
- Hebrew/English toggle (Hebrew only)
- Dark mode
- Full documentation site
- REST-first positioning (REST may appear as a footer footnote later)

## Audience and conversion

| Item | Decision |
|------|----------|
| Primary audience | AI agent builders / MCP users |
| Primary CTA | התחבר |
| Connect UX | On-page copyable MCP URL + short JSON install steps |
| Cursor path | Deep-link / open Cursor with prefilled MCP config when possible; fall back to copy |
| Language | Hebrew only (`lang="he"`, `dir="rtl"`) |
| Theme | Light only (warm paper / market stall) |

## Stack

| Layer | Choice |
|-------|--------|
| App location | `apps/web` in the pnpm monorepo |
| Framework | Next.js App Router |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (customized tokens; not default look) |
| Motion | `motion/react` on isolated client islands |
| Icons | Phosphor (one family) |
| Hosting | Firebase App Hosting (`apphosting.yaml`) |
| Config | `NEXT_PUBLIC_MCP_URL` (and related public connect constants) |

## Information architecture

Single scroll page. One CTA intent everywhere (`התחבר`).

1. **SiteHeader** — wordmark + CTA → `#connect`
2. **Hero** — brand, one headline, short subtext, CTA, full-bleed market visual
3. **ProofStrip** — Israel-concrete signals (chains / cities / freshness), not fake logo walls
4. **AgentJobs** — what agents can do (search, compare, optimize basket, promotions)
5. **BasketStory** — one concrete example (e.g. BBQ list near Herzliya / Neve Amal → confirmation → recommended store)
6. **ConnectPanel** (`id="connect"`) — MCP URL, Cursor deep-link, Claude/Cursor JSON steps, copy fallback
7. **ToolsGlance** — protocol tool names as chips with short Hebrew labels
8. **SiteFooter** — minimal product identity; optional later link to OpenAPI

### Hero constraints

- Max 4 text elements: brand/eyebrow (optional), headline, subtext, CTAs
- Headline ≤ 2 lines desktop
- Subtext ≤ 20 words
- No feature bullets, trust strips, or scroll cues in the hero
- Brand must read as hero-level (wordmark + product presence), not only nav text

## Visual system

**Dials:** Design variance 7 · Motion intensity 5 · Visual density 3

### Palette

- Paper: warm limestone background (tinted off-white; not pure `#fff`)
- Ink: deep olive-charcoal (not pure `#000`)
- Accent: paprika / shuk-red for primary CTAs only
- Support: muted olive for secondary surfaces and chips
- Forbidden defaults: purple glow, neon accents, cyan-on-dark AI look

### Typography

- Hebrew display + body: Rubik or Heebo via `next/font` (not Inter)
- LTR technical strings (tool names, URLs, JSON): one mono family
- Emphasize with weight/italic of the same family; no mixed-serif flourish

### Shape and material

- Corner radius ~12px consistently (buttons, fields, chips)
- Cards only when they hold interaction (e.g. connect copy controls); prefer spacing and hairlines elsewhere
- No glassmorphism-as-default; no pill-cluster decoration

### Motion

- Short hero entrance + light scroll reveal on one or two sections
- Animate `transform` / `opacity` only
- Honor `prefers-reduced-motion`

### Imagery

- Hero: full-bleed market / produce / Israeli grocery atmosphere (generated or licensed photo)
- No div-based fake terminals or fake dashboards as the product preview
- Basket story may use a simple editorial layout with real place/product language, not a mocked app chrome

## Messaging outline (Hebrew)

Tone: concrete, local, agent-useful. Avoid empty marketing verbs.

| Spot | Direction |
|------|-----------|
| Brand | Super MCP · optional: נתוני סופרמרקטים לסוכני AI |
| Hero H1 | מחירים אמיתיים מהסופר. ישירות לסוכן שלך. |
| Hero sub | מחיר, מבצע וסל אופטימלי ליד הבית — ב-Cursor וב-Claude. |
| CTA | התחבר |
| Proof | רשתות ישראליות · ערים ושכונות · מחירים עם רעננות |
| Jobs | חפש מוצר · השווה מחירים · אופטימיזציית סל · הסבר מבצעים |
| Basket story | סל ברביקיו ליד הרצליה → שאלות אישור → חנות מומלצת |
| Connect | כתובת MCP · פתח ב-Cursor · העתק הגדרת JSON |
| Tools | English protocol names + short Hebrew label |

Final copy lives in `src/content/he.ts` so the page stays composition-only.

## Component architecture

```
apps/web/
  src/app/layout.tsx
  src/app/page.tsx
  src/components/ui/           # shadcn primitives
  src/components/shared/       # Container, Section, CopyButton, CodeBlock
  src/components/marketing/    # section-level blocks
  src/lib/mcp.ts               # URL, deep-link helper, config JSON builders
  src/content/he.ts            # Hebrew copy
  apphosting.yaml              # Firebase App Hosting (path as required by monorepo root)
```

### Rules

- `page.tsx` only composes marketing sections
- Shared primitives stay presentational and small
- Client components only for copy, deep-link, and motion
- One CTA label site-wide: התחבר
- Max ~1 eyebrow-style micro-label per 3 sections

### Key shared pieces

| Component | Responsibility |
|-----------|----------------|
| `Container` | Max width + horizontal padding |
| `Section` | Vertical rhythm + optional `id` |
| `CopyButton` | Clipboard + brief confirmation state |
| `CodeBlock` | LTR mono block for JSON / URL |
| `ConnectPanel` | Deep-link + copy paths |
| `ToolChip` | Tool name + Hebrew label |

## Connect behavior

1. Show `NEXT_PUBLIC_MCP_URL` in a copyable LTR field.
2. Primary action: attempt Cursor deep-link with prefilled MCP config when a supported scheme/URL exists.
3. If deep-link is unavailable or fails, keep the user on the Connect section with copyable JSON for Cursor and Claude.
4. Steps stay short (3 or fewer) and on-page; no external docs required for v1.

Deep-link helper details (exact URL scheme) are an implementation task; the UX contract above is the requirement.

## Firebase App Hosting

- Target: Firebase App Hosting backend for the Next.js app
- Monorepo: configure app root as `apps/web` (or equivalent App Hosting root-directory setting)
- Public env for MCP URL injected at build/runtime per App Hosting conventions
- Classic static-only Firebase Hosting export is out of scope unless App Hosting is blocked later

## Success criteria

- Desktop and mobile: hero fits first viewport with CTA visible
- Hebrew RTL correct for layout; LTR isolated for URLs/JSON/tool ids
- Connect path usable without leaving the page
- Visual read as grocery-local, not generic AI SaaS
- Component files stay small and reusable; no mega-page component

## Open implementation details

- Exact Cursor deep-link scheme / docs URL available at build time
- Production MCP URL value
- Final hero image asset (generate or provide during implementation)
- Whether Firebase config lives at repo root vs `apps/web` (follow current Firebase monorepo docs at implement time)
