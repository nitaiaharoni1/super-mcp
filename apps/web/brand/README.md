# Brand assets

Sources of truth live here and in `../public`. The PNGs in `../public` are
generated and committed, so the site build never depends on regenerating them.

| Source | Generated output |
| --- | --- |
| `../public/favicon.svg` | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| `og.html` | `og.png` (1200x630 social card) |
| `mark-source.png` | Original raster of the mark, for reference |

## The mark

A shopping basket whose body is a barcode: basket + price-scan in one shape.
The handle is an open trapezoid (no base) so it never reads as a padlock; the
body is eight vertical bars of uneven width.

Geometry is duplicated in `../public/favicon.svg`,
`../src/components/shared/Logo.tsx` and `og.html`. Change all three together.

Colours are literal hex, not the `oklch` design tokens: favicon renderers are not
full browsers. `#9747FF` is the brand grape on the mark tile. Site `--color-accent`
stays a deeper blue so buttons can carry white text at AA.

## The wordmark

One word, `SuperMCP`, set in Gabarito at 700 and used nowhere else on the site.
MCP keeps its capitals because it is an acronym and lowercasing it loses the only
part of the name that says what this connects to.

## Regenerating the PNG icons

From `apps/web`:

```bash
rsvg-convert -w 192 -h 192 public/favicon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/favicon.svg -o public/icon-512.png
# Apple touch is square-cornered on purpose (iOS applies its own mask).
rsvg-convert -w 180 -h 180 public/favicon.svg -o public/apple-touch-icon.png
```

## Regenerating `og.png`

`og.html` is a standalone 1200x630 page that pulls Secular One, Heebo and Geist
Mono from Google Fonts. Screenshot it at exactly 1200x630 with any headless
browser, e.g.

```bash
# from a directory where playwright-core is installed
node -e '
  const { chromium } = require("playwright-core");
  (async () => {
    const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
    const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
    await p.goto("file://" + process.cwd() + "/og.html", { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    await p.screenshot({ path: "og.png" });
    await b.close();
  })();
'
```

Check the result is set in Secular One and Geist Mono before committing: if the
fonts fail to load the card silently falls back to system faces.

## When the numbers change

`og.html` hard-codes the measured comparison and its date. Those figures also
appear in `../src/content/he.ts`. If the measurement is refreshed, update both
and keep the caveat line on the card: it gets shared without the page around it.

## Third-party assistant marks

`../src/components/shared/AssistantRow.tsx` inlines the Claude, ChatGPT (OpenAI),
Gemini and Cursor marks. They come from [Simple Icons](https://simpleicons.org),
whose SVG files are CC0. The trademarks themselves belong to Anthropic, OpenAI,
Google and Anysphere.

They appear only to state what SuperMCP connects to, which is what the labels
next to them claim and nothing more. Do not use them in a way that implies any of
those companies endorse or sponsor this.

They are drawn in a single ink colour rather than each brand's own palette. Four
competing brand colours, one of them a gradient, would fight the page and each
other, and a flat row reads as a compatibility list rather than a badge wall.

Names stay beside the marks because the audience is shoppers: the Anthropic burst
and the Cursor cube are not yet recognised without a label.

To refresh a mark:

```bash
curl -o icon.svg https://cdn.jsdelivr.net/npm/simple-icons@15/icons/claude.svg
# then copy the single path `d` into AssistantRow.tsx
```
