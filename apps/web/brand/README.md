# Brand assets

Sources of truth live here and in `../public`. The PNGs in `../public` are
generated and committed, so the site build never depends on regenerating them.

| Source | Generated output |
| --- | --- |
| `../public/favicon.svg` | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| `og.html` | `og.png` (1200x630 social card) |

## The mark

Two right-aligned bars: a long faint one for what the nearer shop charges, a
short solid one for the answer. Right-aligned because the product is Hebrew RTL.
It is the same idea as the ledger section of the landing page, and unlike a
letterform it still reads at 16px.

Geometry is duplicated in `../public/favicon.svg` and
`../src/components/shared/Logo.tsx`. Change both together.

Colours are literal hex, not the `oklch` design tokens: favicon renderers are
not full browsers. `#006598` is `--color-accent`.

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
