# Brand assets

Sources of truth live here and in `../public`. The PNGs in `../public` are
generated and committed, so the site build never depends on regenerating them.

| Source | Generated output |
| --- | --- |
| `../public/favicon.svg` | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| `og.html` | `og.png` (1200x630 social card) |

## The mark

A shopping basket with one item dropping into it. The concept came from Recraft
(via Higgsfield, `model_type: vector`), then was rebuilt by hand: the model's own
output was 1.9KB of bezier approximations whose details mushed together below
about 24px, and this is the same idea in exact geometry at a fraction of the size.

Two constraints, both found by rendering candidates at real sizes rather than by
eye:

- **No handle.** An arc over a rounded body reads as a padlock at every size.
  Two of the first four variants had to be thrown out for this.
- **The body flares outward at the rim.** A plain downward taper reads as a
  waste bin.

The item is drawn *before* the basket so the rim occludes it: it is going in, not
sitting in front of it.

Geometry is duplicated in `../public/favicon.svg`,
`../src/components/shared/Logo.tsx` and `og.html`. Change all three together.

Colours are literal hex, not the `oklch` design tokens: favicon renderers are not
full browsers. `#006598` is `--color-accent`, `#FC9B6F` is `--color-over-band`.

## The wordmark

One word, `SuperMCP`, set in Gabarito at 700 and used nowhere else on the site.
MCP keeps its capitals because it is an acronym and lowercasing it loses the only
part of the name that says what this connects to.

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

The apple touch icon is square-cornered on purpose (iOS applies its own mask)
with the bars inset so they survive the rounding.

## When the numbers change

`og.html` hard-codes the measured comparison and its date. Those figures also
appear in `../src/content/he.ts`. If the measurement is refreshed, update both
and keep the caveat line on the card: it gets shared without the page around it.
