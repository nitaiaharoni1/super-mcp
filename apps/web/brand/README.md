# Brand assets

Sources of truth live here and in `../public`. The PNGs in `../public` are
generated and committed, so the site build never depends on regenerating them.

| Source | Generated output |
| --- | --- |
| `../public/favicon.svg` | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| `og-source.jpg` | `../public/og.png` (1200x630 social card) |
| `og.html` | Legacy HTML card (kept for reference; not the live source) |
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

The live social card is the designed thumbnail in `og-source.jpg`. From
`apps/web`:

```bash
python3 - <<'PY'
from PIL import Image
img = Image.open("brand/og-source.jpg").convert("RGB")
target = (1200, 630)
scale = max(target[0] / img.width, target[1] / img.height)
new = (round(img.width * scale), round(img.height * scale))
img = img.resize(new, Image.Resampling.LANCZOS)
left = (img.width - target[0]) // 2
top = (img.height - target[1]) // 2
img = img.crop((left, top, left + target[0], top + target[1]))
img.save("public/og.png", "PNG", optimize=True)
PY
```

`og.html` is an older HTML card (ledger numbers + fonts). Leave it alone unless
you intentionally want to bring that style back.

Production tip: Firebase Hosting serves files in `firebase-hosting/` before the
Cloud Run rewrite. Copy `public/og.png` there before `firebase deploy --only
hosting` so crawlers get the new card without waiting on a web image rebuild.

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
