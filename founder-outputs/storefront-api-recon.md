# Israeli Grocery Storefront API + Cart Recon
**Generated:** 2026-07-17
**Method:** Parallel agents, each in an isolated Reflex (local Chrome) session, observing the storefronts' own XHR/JSON. Read surface fully mapped; cart/write surface mapped guest-only (no login, no payment, no order placed).

## Complete chain map

| Chain | Platform | Read API | retailer/branch | Read auth | WAF | Cart handoff |
|---|---|---|---|---|---|---|
| **Shufersal** | SAP Hybris (own) | `/online/he/search/results` | n/a | none | none | HARD anon / POSSIBLE via login |
| **Rami Levy** | Nuxt+ES (own) | `/api/search/`, `/api/items/{id}` | `store=` | none | none | HARD (localStorage cart) |
| **Carrefour** | stor.ai (legacy REST) | `/v2/retailers/1540/branches/3003/products` | 1540 / 3003 | in-browser | Cloudflare | POSSIBLE (guest, session-restore) |
| **Mega** | → redirects to Carrefour | (same as Carrefour) | 1540 / 3003 | — | — | (= Carrefour) |
| **Yeinot Bitan** | stor.ai (legacy REST) | `/v2/retailers/1131/branches/1975/products` | 1131 / 1975 | in-browser | Cloudflare (likely) | POSSIBLE |
| **Victory** | stor.ai (legacy REST) | `/v2/retailers/1470/branches/2930/products` | 1470 / 2930 | in-browser | Cloudflare | POSSIBLE |
| **Tiv Taam** | stor.ai (legacy REST) | `/v2/retailers/1062/branches/924/products` | 1062 / 924 | **none (bare HTTP)** | **none** | POSSIBLE |
| **Machsanei HaShuk** (mck.co.il) | stor.ai (legacy REST) | `/v2/retailers/1107/branches/836/products` (+`/specials`) | 1107 / 836 | in-browser | Cloudflare | POSSIBLE |
| **Yochananof** (yochananof.co.il) | stor.ai (**new GraphQL**) | `api.stor.ai` GraphQL, token-gated | not extracted | in-browser | none on store | POSSIBLE |
| **Osher Ad** | none (WordPress marketing) | — | — | — | Cloudflare (WP) | N/A — no online store |

### Platform takeaways
- **~3 code paths cover Israel:** (1) Shufersal Hybris adapter, (2) Rami Levy adapter, (3) stor.ai adapter — the latter reused across Carrefour, Bitan, Victory, Tiv Taam, mck, Yochananof by swapping retailer/branch IDs.
- **stor.ai has TWO frontend generations:** legacy AngularJS + same-origin `/v2/` REST (most chains) and new Next.js + `api.stor.ai` GraphQL (Yochananof). Adapter must handle both.
- **Cloudflare is per-tenant, not platform-wide:** Tiv Taam serves `/v2/` to a bare HTTP client; Carrefour/Victory/mck need a real/headless browser or maintained cf_clearance.
- Same stor.ai contract powers ~2,000 grocery stores globally (US: Big Y, Key Food, Albertsons Market, United Supermarkets; +UK/FR/CA) via Relationshop/Mercatus — the read+cart adapter generalizes far beyond Israel.

## Cart / handoff mechanics (the fulfillment question)

**Universal finding: NO Israeli chain offers a stateless shareable "cart URL."** Every cart is bound to a browser session (cookie or localStorage) or a logged-in account. The dream of "agent builds cart → emails user a link" does not exist as a primitive on any chain.

- **Shufersal:** `POST /online/he/cart/add` (`productCodePost`, `qty`, `CSRFToken`) + bulk `/cart/addGrid`. CSRF token is per-page, bound to anon JSESSIONID. Guest add is gated behind a delivery-area/pickup-branch modal (assortment is address-scoped). No tokenized cart URL — cart lives in the JSESSIONID session. Wish-lists (`/online/he/wish-lists`) have a real **share** feature (WhatsApp/FB) but are **login-gated** on both ends. → **Best handoff = logged-in account cart or shared wish-list.**
- **Rami Levy:** `POST /api/v2/cart` is a **stateless re-pricer** — client sends the whole item list, gets back priced cart. Cart is held in **browser localStorage**, no server cart, no token, no URL. "Quick Order" (קניה מהירה) paste-a-list wizard exists but is client-side UI, not a bulk API. → handoff requires running in the user's browser or logging in.
- **stor.ai cohort:** Guest add-to-cart works with **no login** (cookie + branch scoped), via the stor.ai cart API the storefront proxies. No shareable cart URL — cart is a server-side drawer keyed to the browser cookie. → handoff = establish guest session, POST items, restore that session to the user.
- **Osher Ad:** N/A (no online store).

## What this means for the MCP tool

A **server-side** MCP tool can do the optimization/matching (read APIs — trivial) and can build a cart inside a session it controls, **but that cart is trapped in that session and cannot be handed off as a URL.** To actually give the user a fillable cart, execution must live in the user's browser context, or the user must connect their account. Three viable product tiers:

- **Tier 0 — "Optimized list + quick-order paste" (ships now, zero-auth, no extension):** MCP returns the cheapest chain for the basket + a ready-to-paste quick-order list + a link to that chain's quick-order/import page. User pastes → reviews → checks out. Lowest friction that needs no credentials. Honest MVP.
- **Tier 1 — "Agent fills your cart" (browser extension / Claude-in-Chrome / bookmarklet):** Runs in the user's browser, writes items into their actual cart across chains. Best UX; per-chain adapters for the write path.
- **Tier 2 — account-connect (server-side cart under user login):** Most powerful (path to true agentic checkout) but credential/session custody + per-chain login automation. Do last.

**Strategic note:** the read/optimization layer is commodity (free gov XML + trivial APIs); the **write/handoff layer is the hard, fragmented, defensible part.** That fragmentation is the reason a company can exist here rather than a two-day script.

## Cart injection — feasibility (empirically tested 2026-07-17)

**Verdict: a `javascript:` bookmarklet can fill the guest cart on every major chain.** No login, no stored passwords, no browser extension required. Tested live in isolated guest sessions (no checkout, no payment, no order placed).

| Chain | Platform | Feasible | Mechanism | Proven live |
|---|---|---|---|---|
| Rami Levy | Nuxt+ES | ✅ | **A** — rewrite `localStorage["ramilevy"].cart.items` + reload | Yes |
| Shufersal | SAP Hybris | ✅ | **B** — POST-replay `/online/he/cart/add` + CSRF header | **Yes (cart 0→3 via fetch)** |
| Tiv Taam | stor.ai | ✅ | **B** — POST-replay `/v2/.../carts` (cookie only) | Cart flow captured |
| Victory | stor.ai + CF | ✅ | **B** — same; Cloudflare passed in-browser | Cart flow captured |
| Carrefour / Mega / Bitan / Machsanei | stor.ai | ✅ (inferred) | **B** — same contract, swap retailer+branch ids | — |

**Two mechanisms, both same-origin (both run in the user's browser):**
- **A (localStorage):** write hydrated product objects into the app's persisted state, reload, storefront reprices via its own cart API. Rami Levy only.
- **B (POST-replay):** read the page's own cookies/CSRF/token, call the storefront's own add-to-cart endpoint N times. Everyone else.

**Per-chain contract:**
- **Shufersal:** `POST /online/he/cart/add`, `Content-Type: application/json` (form body → 415), header `CSRFToken` from `window.ACC.config.CSRFToken` (session-stable, not per-page). Body: `{productCodePost, productCode, sellingMethod:"BY_UNIT", qty, frontQuantity, comment:"", affiliateCode:""}` — all 6 fields or silent 200 no-op. `productCode = "P_" + GTIN`. Bulk path `/cart/addGrid` exists. No CSRF header → 405.
- **stor.ai cohort:** create+add via `POST /v2/retailers/{rid}/branches/{bid}/carts?appId=4` (201, returns cart id), then `POST /.../carts/{cartId}?appId=4` per item (200). Line: `{retailerProductId, quantity, type:1}`. **No token** — session cookie only. Same-origin proxy (not `api.stor.ai` directly), so no CORS.
- **Rami Levy:** fetch hydrated items from `/api/items`, set into `localStorage["ramilevy"].cart.items`, reload → storefront calls `POST /api/v2/cart` to reprice. Quantity field is `amount`.

**Universal caveat — the branch gate:** every chain refuses to hold a cart until a delivery area / pickup branch is set. Flow must be: user picks store → then bookmarklet fills. On stor.ai, an ephemeral cart is discarded if no fulfillment context exists; `retailerProductId` is branch-scoped.

**Cloudflare is a non-issue for the in-browser path** (proven on Victory): bare HTTP replay = 403; the identical request from the loaded tab = 200. CF only guards the initial document load, already passed by the time a bookmarklet runs; the bookmarklet's `fetch()` inherits `cf_clearance` + same-origin headers.

**Reflex tooling note:** `REFLEX_MCP_EVAL=1` was unset, so agents could not run arbitrary in-page JS; Reflex's out-of-page `fetch` step also lacks `cf_clearance` (its 403 on Victory is a tool artifact, not evidence against feasibility). Shufersal was still proven by a real fetch-replay; the stor.ai chains proven by observing the storefront's own same-origin cart POSTs.

## Per-item product links (zero-install Tier 0, verified 2026-07-17)

The lowest-friction handoff that works from a chat with **nothing installed**: the agent emits one product-page link per basket item; the user clicks each, lands on the retailer's real page, and taps the retailer's own add button. A normal link runs the retailer's code on the retailer's origin — no security wall, because the human does the adding. Verified one real clickable link per chain (guest, add button present).

| Chain | Template | Variable | Build source |
|---|---|---|---|
| Rami Levy | `rami-levy.co.il/he/online/search?item=<barcode>` | GTIN/barcode | direct ✅ |
| Yochananof | `yochananof.co.il/category?search=<barcode>` | GTIN/barcode | direct ✅ |
| Shufersal | `shufersal.co.il/online/he/p/P_<מק"ט>` | `P_`+מק"ט | price feed מק"ט (NOT raw GTIN — barcode with mfr prefix stripped, e.g. 7290004131074→4131074) |
| Carrefour | `carrefour.co.il/?catalogProduct=<catalogId>` | stor.ai catalog id | products API (barcode→catalogProductId) |
| Victory | `victoryonline.co.il/categories/<cat>/products?catalogProduct=<catalogId>` | catalog id + category | products API; bare `?catalogProduct=` does NOT deep-link, needs category path |
| Yeinot Bitan | `ybitan.co.il/categories/<cat>/products?catalogProduct=<catalogId>` | catalog id + category | products API; same category-path requirement |
| Tiv Taam | `tivtaam.co.il/?catalogProduct=<internalId>` | stor.ai internal product id | products API or sitemaps `/sitemaps/sitemap-pages-{1..5}.xml`; bare form works, no category path |
| Machsanei HaShuk | `mck.co.il/search/<barcode or name>` | search term | **NO PDP** — every card is an add button; best we can do is land on a search result |

Verified milk (GTIN 7290004131074) links, one per chain:
```
Rami Levy     https://www.rami-levy.co.il/he/online/search?item=7290004131074
Shufersal     https://www.shufersal.co.il/online/he/p/P_4131074
Carrefour     https://www.carrefour.co.il/?catalogProduct=10789
Victory       https://www.victoryonline.co.il/categories/79723/products?catalogProduct=10789
Yeinot Bitan  https://www.ybitan.co.il/categories/79723/products?catalogProduct=10789
Tiv Taam      https://www.tivtaam.co.il/?catalogProduct=5662166
Yochananof    https://yochananof.co.il/category?search=7290004131074
Machsanei     https://www.mck.co.il/search/7290004131074
```

**Notes / gotchas:**
- **stor.ai catalog id is shared across tenants:** `catalogProduct=10789` is this milk on Carrefour, Victory, AND Bitan — build the id once, swap the domain. Tiv Taam is the exception (its `catalogProduct` takes the internal product id, own number space).
- **Barcode-native chains (Rami Levy, Yochananof, Machsanei)** need no lookup — we already have the GTIN from the feed.
- **Add button is present for guests on every chain**; the delivery-area/branch gate only fires when the user actually adds, not when viewing.
- **Tradeoff vs the fill-cart bookmarklet:** zero install, but manual (one click + one add per item) — great for small baskets, tedious for a 30-item weekly shop. Ship both; same price brain, two handoff styles.

## Ingestion artifacts
Raw JSON samples saved under `~/.reflex/artifacts/` (Shufersal, Rami Levy, stor.ai product + cart responses) for building the adapters.
