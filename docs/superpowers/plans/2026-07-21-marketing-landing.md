# Super MCP Marketing Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Hebrew RTL single-page marketing site in `apps/web` that converts MCP users with an on-page Connect flow (Cursor deeplink + copyable URL/JSON), styled as grocery-real Israel, deployable on Firebase App Hosting.

**Architecture:** Next.js App Router app composes small marketing sections over shared shadcn/Tailwind primitives. All Hebrew copy lives in `src/content/he.ts`. MCP URL, Cursor install deeplink, and JSON snippets are pure helpers in `src/lib/mcp.ts`. Client islands are limited to copy, deeplink click, and light motion.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, `motion/react`, `@phosphor-icons/react`, Vitest, pnpm workspaces, Firebase App Hosting.

## Global Constraints

- Hebrew only: root `lang="he"` and `dir="rtl"`.
- Light theme only (warm limestone paper, paprika accent, olive support).
- One CTA label site-wide: `התחבר`.
- No Inter; use Rubik (or Heebo) via `next/font` plus one mono for LTR tech strings.
- No em-dash (`—` / `–`) in any user-visible string; use hyphen `-` or restructure.
- No dark mode, waitlist, auth UI, pricing, or live API playground in v1.
- Cards only for interactive connect controls; prefer spacing elsewhere.
- Client components only for copy, deeplink, and motion.
- Imports stay at module top level.
- Exhaustive `never` defaults on union switches.
- Do not invent fake chain logo walls; use concrete Hebrew proof text.
- MCP config uses HTTP URL transport (`url` field) for Streamable HTTP.

---

## File Structure

### Create

- `apps/web/package.json` — Next app scripts and deps
- `apps/web/tsconfig.json`
- `apps/web/next.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/components.json` — shadcn config
- `apps/web/apphosting.yaml` — Firebase App Hosting
- `apps/web/.env.example` — `NEXT_PUBLIC_MCP_URL`
- `apps/web/vitest.config.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/globals.css` — Tailwind + design tokens
- `apps/web/src/content/he.ts` — all Hebrew copy
- `apps/web/src/lib/mcp.ts` — URL, JSON, Cursor deeplink helpers
- `apps/web/src/lib/utils.ts` — `cn()` helper for shadcn
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/shared/Container.tsx`
- `apps/web/src/components/shared/Section.tsx`
- `apps/web/src/components/shared/CopyButton.tsx`
- `apps/web/src/components/shared/CodeBlock.tsx`
- `apps/web/src/components/shared/ToolChip.tsx`
- `apps/web/src/components/marketing/SiteHeader.tsx`
- `apps/web/src/components/marketing/Hero.tsx`
- `apps/web/src/components/marketing/ProofStrip.tsx`
- `apps/web/src/components/marketing/AgentJobs.tsx`
- `apps/web/src/components/marketing/BasketStory.tsx`
- `apps/web/src/components/marketing/ConnectPanel.tsx`
- `apps/web/src/components/marketing/ToolsGlance.tsx`
- `apps/web/src/components/marketing/SiteFooter.tsx`
- `apps/web/public/hero-market.webp` — hero visual
- `apps/web/tests/lib/mcp.test.ts`
- `apps/web/README.md` — local run + Firebase notes

### Modify

- `pnpm-workspace.yaml` — add `apps/*`
- Root `package.json` — optional `dev:web` / `build:web` scripts
- `.impeccable.md` — already present; leave unless copy conflicts
- `docs/superpowers/specs/2026-07-21-marketing-landing-design.md` — set status to Approved

---

### Task 1: Scaffold `apps/web` in the monorepo

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/.env.example`
- Modify: `package.json` (root scripts)

**Interfaces:**
- Produces: runnable Next app at `apps/web` with RTL Hebrew shell
- Produces: CSS variables `--paper`, `--ink`, `--accent`, `--olive`, `--radius`

- [ ] **Step 1: Extend the workspace**

Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - "packages/*"
  - "services/*"
  - "apps/*"
```

- [ ] **Step 2: Create the Next app package**

Create `apps/web/package.json`:

```json
{
  "name": "@super-mcp/web",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@phosphor-icons/react": "^2.1.10",
    "@radix-ui/react-slot": "^1.2.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "motion": "^12.23.12",
    "next": "^15.5.2",
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.12",
    "@types/node": "^22.15.21",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "tailwindcss": "^4.1.12",
    "typescript": "^7.0.2",
    "vitest": "^3.1.4"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

Create `apps/web/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Add design tokens + RTL shell**

Create `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-paper: oklch(0.97 0.015 95);
  --color-ink: oklch(0.28 0.03 130);
  --color-accent: oklch(0.52 0.16 30);
  --color-olive: oklch(0.45 0.06 130);
  --color-olive-soft: oklch(0.92 0.03 130);
  --color-muted: oklch(0.45 0.02 130);
  --radius-lg: 12px;
  --font-sans: var(--font-rubik), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}

html {
  background: var(--color-paper);
  color: var(--color-ink);
}

body {
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
}
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Rubik, Geist_Mono } from "next/font/google";
import "./globals.css";

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  variable: "--font-rubik",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Super MCP",
  description: "נתוני סופרמרקטים לסוכני AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${geistMono.variable}`}>
      <body className="min-h-[100dvh] antialiased">{children}</body>
    </html>
  );
}
```

Create temporary `apps/web/src/app/page.tsx`:

```tsx
export default function HomePage() {
  return <main className="p-8">Super MCP</main>;
}
```

Create `apps/web/.env.example`:

```bash
NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp
```

- [ ] **Step 4: Wire root scripts and install**

Add to root `package.json` scripts:

```json
"dev:web": "pnpm --filter @super-mcp/web dev",
"build:web": "pnpm --filter @super-mcp/web build"
```

Run:

```bash
pnpm install
pnpm --filter @super-mcp/web dev
```

Expected: app serves at `http://localhost:3000` with Hebrew RTL document and paper background.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json apps/web
git commit -m "$(cat <<'EOF'
feat(web): scaffold Next.js marketing app with RTL shell

EOF
)"
```

---

### Task 2: Content module + MCP connect helpers (TDD)

**Files:**
- Create: `apps/web/src/content/he.ts`
- Create: `apps/web/src/lib/mcp.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/tests/lib/mcp.test.ts`

**Interfaces:**
- Produces: `copy` object from `he.ts`
- Produces: `getMcpUrl(): string`
- Produces: `buildMcpServerConfig(url: string): { url: string }`
- Produces: `buildMcpJsonSnippet(url: string): string`
- Produces: `buildCursorInstallLink(name: string, url: string): string`
- Consumes: `process.env.NEXT_PUBLIC_MCP_URL`

- [ ] **Step 1: Write failing tests**

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

Create `apps/web/tests/lib/mcp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  buildMcpServerConfig,
} from "@/lib/mcp";

describe("mcp helpers", () => {
  const url = "https://api.example.com/mcp";

  it("builds url-only server config for streamable HTTP", () => {
    expect(buildMcpServerConfig(url)).toEqual({ url });
  });

  it("builds mcp.json snippet with mcpServers wrapper", () => {
    const snippet = buildMcpJsonSnippet(url);
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: {
        "super-mcp": { url },
      },
    });
  });

  it("builds Cursor install deeplink with base64 config", () => {
    const link = buildCursorInstallLink("super-mcp", url);
    const expectedConfig = Buffer.from(JSON.stringify({ url }), "utf8").toString("base64");
    expect(link).toBe(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=super-mcp&config=${expectedConfig}`,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @super-mcp/web test`

Expected: FAIL with module not found `@/lib/mcp`

- [ ] **Step 3: Implement helpers + content**

Create `apps/web/src/lib/mcp.ts`:

```ts
export const MCP_SERVER_NAME = "super-mcp";

export function getMcpUrl(): string {
  return process.env.NEXT_PUBLIC_MCP_URL?.trim() || "http://localhost:8787/mcp";
}

export function buildMcpServerConfig(url: string): { url: string } {
  return { url };
}

export function buildMcpJsonSnippet(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: buildMcpServerConfig(url),
      },
    },
    null,
    2,
  );
}

function toBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(json)));
}

/** Cursor MCP install deeplink: https://cursor.com/docs/mcp/install-links */
export function buildCursorInstallLink(name: string, url: string): string {
  const config = encodeURIComponent(toBase64Json(buildMcpServerConfig(url)));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${config}`;
}
```

Create `apps/web/src/content/he.ts` with the approved messaging (no em-dashes):

```ts
export const copy = {
  brand: "Super MCP",
  brandSubtitle: "נתוני סופרמרקטים לסוכני AI",
  cta: "התחבר",
  navConnectHref: "#connect",
  hero: {
    headline: "מחירים אמיתיים מהסופר. ישירות לסוכן שלך.",
    subtext: "מחיר, מבצע וסל אופטימלי ליד הבית - ב-Cursor וב-Claude.",
  },
  proof: ["רשתות ישראליות", "ערים ושכונות", "מחירים עם רעננות"],
  jobs: [
    { title: "חפש מוצר", body: "שאילתות בעברית עם ברקוד ושם קנוני." },
    { title: "השווה מחירים", body: "אותו מוצר, כמה רשתות, מחיר ליחידה אמין." },
    { title: "אופטימיזציית סל", body: "רשימת קניות ליד הבית עם אישור כשצריך." },
    { title: "הסבר מבצעים", body: "מכניקת הנחה ברורה לסוכן, לא רק מחיר סופי." },
  ],
  basketStory: {
    title: "סל ברביקיו ליד הרצליה",
    steps: [
      "שולחים רשימה עם כמויות טבעיות (20 פיתות, 1.5 ק״ג).",
      "אם צריך, הסוכן עונה על שאלות אישור קצרות.",
      "מקבלים חנות מומלצת ליד נווה עמל עם כיסוי ומחיר.",
    ],
  },
  connect: {
    title: "התחבר ל-MCP",
    urlLabel: "כתובת MCP",
    openCursor: "פתח ב-Cursor",
    copyUrl: "העתק כתובת",
    copyJson: "העתק JSON",
    stepsTitle: "בשלושה צעדים",
    steps: [
      "לחצו פתח ב-Cursor, או העתיקו את כתובת ה-MCP.",
      "אם אין Cursor: העתיקו את ה-JSON להגדרות MCP ב-Claude או Cursor.",
      "בקשו מהסוכן לבצע אופטימיזציית סל ליד הרצליה.",
    ],
  },
  tools: [
    { name: "optimize_basket", label: "אופטימיזציית סל" },
    { name: "search_products", label: "חיפוש מוצרים" },
    { name: "compare_prices", label: "השוואת מחירים" },
    { name: "suggest_substitutes", label: "תחליפים" },
    { name: "resolve_products", label: "זיהוי מוצרים" },
    { name: "list_stores", label: "חנויות" },
    { name: "get_promotions", label: "מבצעים" },
    { name: "get_product", label: "פרטי מוצר" },
  ],
  footer: {
    note: "Super MCP - שכבת מחירים לסוכני AI בישראל",
  },
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @super-mcp/web test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/content/he.ts apps/web/src/lib/mcp.ts apps/web/tests apps/web/vitest.config.ts
git commit -m "$(cat <<'EOF'
feat(web): add Hebrew copy and MCP connect helpers

EOF
)"
```

---

### Task 3: Shared primitives + shadcn UI

**Files:**
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/shared/Container.tsx`
- Create: `apps/web/src/components/shared/Section.tsx`
- Create: `apps/web/src/components/shared/CopyButton.tsx`
- Create: `apps/web/src/components/shared/CodeBlock.tsx`
- Create: `apps/web/src/components/shared/ToolChip.tsx`
- Create: `apps/web/components.json` (optional if hand-rolling shadcn files)

**Interfaces:**
- Produces: `cn(...inputs): string`
- Produces: `Button`, `Badge`, `Separator`
- Produces: `Container`, `Section`, `CopyButton`, `CodeBlock`, `ToolChip`

- [ ] **Step 1: Add `cn` helper**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Add Button (paprika primary, 12px radius)**

Create `apps/web/src/components/ui/button.tsx` using shadcn Button pattern with `cva`:

- `variant="default"` → `bg-[var(--color-accent)] text-white hover:opacity-90`
- `variant="secondary"` → olive-soft background
- `variant="ghost"` → transparent ink text
- `rounded-[var(--radius-lg)]`, `h-11`, `px-5`
- Use `@radix-ui/react-slot` for `asChild`

(Keep file under ~80 lines; match standard shadcn Button API: `variant`, `size`, `asChild`.)

- [ ] **Step 3: Add Badge + Separator**

Minimal shadcn-style files themed to olive-soft / ink, radius 12px.

- [ ] **Step 4: Add shared layout + interactive helpers**

`Container.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 md:px-6", className)}>{children}</div>
  );
}
```

`Section.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("py-16 md:py-24", className)}>
      {children}
    </section>
  );
}
```

`CodeBlock.tsx` (server-safe):

```tsx
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  return (
    <pre
      dir="ltr"
      className={cn(
        "overflow-x-auto rounded-[var(--radius-lg)] bg-[var(--color-olive-soft)] p-4 font-mono text-sm text-[var(--color-ink)]",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}
```

`CopyButton.tsx` (`"use client"`):

- Props: `value: string`, `label: string`, `copiedLabel?: string`
- On click: `navigator.clipboard.writeText(value)`, show copied state ~1.5s
- Uses `Button variant="secondary"`

`ToolChip.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

export function ToolChip({ name, label }: { name: string; label: string }) {
  return (
    <Badge className="gap-2 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-normal">
      <span dir="ltr" className="font-mono text-[var(--color-olive)]">
        {name}
      </span>
      <span>{label}</span>
    </Badge>
  );
}
```

- [ ] **Step 5: Smoke-check via typecheck**

Run: `pnpm --filter @super-mcp/web typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/utils.ts apps/web/src/components
git commit -m "$(cat <<'EOF'
feat(web): add shared UI primitives for marketing page

EOF
)"
```

---

### Task 4: Marketing sections (static composition)

**Files:**
- Create: all `apps/web/src/components/marketing/*.tsx` except full ConnectPanel behavior can start static then finish in Task 5
- Create: `apps/web/public/hero-market.webp` (generate during this task)
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `copy` from `@/content/he`
- Consumes: shared primitives
- Produces: section components composed by `page.tsx`

- [ ] **Step 1: Generate hero image**

Use image generation to create `apps/web/public/hero-market.webp` (or `.jpg` if webp unavailable): Israeli outdoor market / fresh produce atmosphere, warm daylight, no text overlays, landscape ~16:9. If generation fails, place a clearly named placeholder and stop for asset input - do not ship a fake UI mock.

- [ ] **Step 2: Implement SiteHeader**

- Sticky/top bar height ≤ 72px
- Wordmark `copy.brand` left-in-RTL (start)
- `Button asChild` link to `#connect` with `copy.cta`
- Single row on desktop

- [ ] **Step 3: Implement Hero**

- `min-h-[100dvh]` split: copy stack + full-bleed `next/image` of hero asset
- Elements only: brand/subtitle, H1, subtext, CTA
- Top padding ≤ `pt-24`
- CTA → `#connect`
- Optional client motion wrapper for opacity/y entrance with `useReducedMotion`

- [ ] **Step 4: Implement ProofStrip, AgentJobs, BasketStory, ToolsGlance, SiteFooter**

Layout families (must differ):

| Section | Layout family |
|---------|---------------|
| ProofStrip | horizontal text measures / dividers |
| AgentJobs | asymmetric 2×2 grid (not 3 equal cards) |
| BasketStory | vertical numbered story, editorial |
| ToolsGlance | wrapping chip row |
| SiteFooter | single-line / compact note |

Use at most one uppercase-tracking eyebrow across the whole page (prefer zero outside hero brand line).

- [ ] **Step 5: Compose `page.tsx`**

```tsx
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { Hero } from "@/components/marketing/Hero";
import { ProofStrip } from "@/components/marketing/ProofStrip";
import { AgentJobs } from "@/components/marketing/AgentJobs";
import { BasketStory } from "@/components/marketing/BasketStory";
import { ConnectPanel } from "@/components/marketing/ConnectPanel";
import { ToolsGlance } from "@/components/marketing/ToolsGlance";
import { SiteFooter } from "@/components/marketing/SiteFooter";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <ProofStrip />
        <AgentJobs />
        <BasketStory />
        <ConnectPanel />
        <ToolsGlance />
      </main>
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 6: Visual check**

Run: `pnpm --filter @super-mcp/web dev`

Verify: hero CTA visible without scroll on laptop viewport; RTL; paprika CTA; no purple; no em-dashes in rendered Hebrew.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/marketing apps/web/src/app/page.tsx apps/web/public
git commit -m "$(cat <<'EOF'
feat(web): add Hebrew marketing sections and hero visual

EOF
)"
```

---

### Task 5: ConnectPanel (deeplink + copy)

**Files:**
- Create/Modify: `apps/web/src/components/marketing/ConnectPanel.tsx`
- Modify: `apps/web/src/components/shared/CopyButton.tsx` if needed

**Interfaces:**
- Consumes: `getMcpUrl`, `buildMcpJsonSnippet`, `buildCursorInstallLink`, `MCP_SERVER_NAME`, `copy.connect`
- Produces: interactive `#connect` section

- [ ] **Step 1: Implement ConnectPanel as client island**

Requirements:

1. `id="connect"` on the section
2. Show MCP URL in LTR `CodeBlock` + `CopyButton` (`copy.connect.copyUrl`)
3. Primary button `copy.connect.openCursor` → `window.location.href = buildCursorInstallLink(...)` (or `<a href={link}>`)
4. Show JSON snippet via `CodeBlock` + copy button
5. Render the three Hebrew steps from `copy.connect.steps`
6. Soft olive panel / border only around the interactive cluster (card justified by interaction)

Sketch:

```tsx
"use client";

import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { CopyButton } from "@/components/shared/CopyButton";
import { Button } from "@/components/ui/button";
import { copy } from "@/content/he";
import {
  MCP_SERVER_NAME,
  buildCursorInstallLink,
  buildMcpJsonSnippet,
  getMcpUrl,
} from "@/lib/mcp";

export function ConnectPanel() {
  const url = getMcpUrl();
  const json = buildMcpJsonSnippet(url);
  const cursorHref = buildCursorInstallLink(MCP_SERVER_NAME, url);

  return (
    <Section id="connect">
      <Container>
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {copy.connect.title}
        </h2>
        {/* URL row, Cursor CTA, JSON, steps */}
        <Button asChild>
          <a href={cursorHref}>{copy.connect.openCursor}</a>
        </Button>
      </Container>
    </Section>
  );
}
```

Fill the omitted markup fully in implementation (URL label, copy controls, steps list). Keep file focused; extract a tiny `ConnectField` only if repetition is painful.

- [ ] **Step 2: Manual connect check**

Run: `pnpm --filter @super-mcp/web dev`

With `NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp`:

- Copy URL works
- Copy JSON parses as valid JSON
- Cursor link starts with `cursor://anysphere.cursor-deeplink/mcp/install?`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/marketing/ConnectPanel.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire Connect panel with Cursor deeplink and copy

EOF
)"
```

---

### Task 6: Firebase App Hosting + docs

**Files:**
- Create: `apps/web/apphosting.yaml`
- Create: `apps/web/README.md`
- Modify: `docs/superpowers/specs/2026-07-21-marketing-landing-design.md` (status → Approved)

**Interfaces:**
- Produces: App Hosting config for Next.js monorepo app root `apps/web`
- Produces: local/dev docs for env + deploy notes

- [ ] **Step 1: Add `apphosting.yaml`**

Create `apps/web/apphosting.yaml`:

```yaml
runConfig:
  runtime: nodejs22
  concurrency: 80
  cpu: 1
  memoryMiB: 512

env:
  - variable: NEXT_PUBLIC_MCP_URL
    secret: NEXT_PUBLIC_MCP_URL
    availability:
      - BUILD
      - RUNTIME
```

If secret binding is unavailable in the project yet, use a plain value placeholder in README and keep the env var documented; do not commit production secrets.

- [ ] **Step 2: Write `apps/web/README.md`**

Include:

- `pnpm --filter @super-mcp/web dev`
- `.env.local` with `NEXT_PUBLIC_MCP_URL`
- Firebase App Hosting: set app root to `apps/web`, Blaze required, connect GitHub
- Note that classic static Firebase Hosting export is out of scope

- [ ] **Step 3: Update design status**

In the design spec header, set:

```md
**Status:** Approved
```

- [ ] **Step 4: Production build check**

Run:

```bash
NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp pnpm --filter @super-mcp/web build
pnpm --filter @super-mcp/web typecheck
pnpm --filter @super-mcp/web test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/apphosting.yaml apps/web/README.md docs/superpowers/specs/2026-07-21-marketing-landing-design.md
git commit -m "$(cat <<'EOF'
chore(web): add Firebase App Hosting config and web README

EOF
)"
```

---

### Task 7: Pre-flight polish pass

**Files:**
- Modify: any marketing/shared files that fail the checklist below

**Interfaces:**
- Consumes: finished page
- Produces: checklist-clean v1 landing

- [ ] **Step 1: Run mechanical pre-flight**

Check and fix:

1. Zero user-visible em-dashes
2. One CTA intent label (`התחבר`) for connect actions; Cursor button may stay `פתח ב-Cursor` as the connect-path action inside `#connect`
3. Eyebrow count ≤ ceil(sections/3)
4. No three-equal feature cards
5. Hero ≤ 4 text elements; CTA visible in first viewport on `1280x800`
6. LTR isolation on URL/JSON/tool names
7. `prefers-reduced-motion` disables entrance animation
8. No purple / neon / Inter
9. No version footers / scroll cues / locale weather strips

- [ ] **Step 2: Final verify commands**

```bash
pnpm --filter @super-mcp/web test
pnpm --filter @super-mcp/web typecheck
NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp pnpm --filter @super-mcp/web build
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
polish(web): marketing landing pre-flight fixes

EOF
)"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|------------------|------|
| Hebrew RTL only | Task 1 |
| Light warm paper / paprika / olive | Task 1, 3, 4 |
| Single-page IA sections | Task 4, 5 |
| CTA התחבר + Connect UX | Task 4, 5 |
| Cursor deeplink + copy fallback | Task 2, 5 |
| Small reusable components | Task 3, 4 |
| Tailwind + shadcn | Task 1, 3 |
| Firebase App Hosting | Task 6 |
| Hero visual real imagery | Task 4 |
| No waitlist/dark/docs maze | Global constraints + Task 7 |

## Placeholder Scan

No TBD steps. Open production MCP URL remains an env value (`NEXT_PUBLIC_MCP_URL`), not an unfinished code path.

## Type Consistency

- `buildMcpServerConfig(url) -> { url: string }` used by JSON snippet and Cursor deeplink
- Server name constant `MCP_SERVER_NAME = "super-mcp"`
- Copy accessed via `copy.*` from `he.ts`
