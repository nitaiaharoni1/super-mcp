# Cart-fill bookmarklets (prototype)

Each block is a bookmarklet: paste the source into a bookmark's URL as `javascript:(...)()` (minify to one line first — e.g. via any JS minifier). The user runs it **while on the store's site, with a delivery area / branch already chosen**. It fills their guest cart, then they review and check out themselves. No login, no password stored, no auto-checkout.

Legend:
- ✅ **proven live** — we drove a real guest cart with this mechanism.
- ⚠️ **needs one detail pinned** — mechanism proven, exact request shape still to confirm.

---

## Shufersal ✅ (mechanism B — POST-replay)

Reads the page's own CSRF token and replays the store's add-to-cart call. `productCode = "P_" + barcode`.

```js
(async () => {
  const token = window.ACC && window.ACC.config && window.ACC.config.CSRFToken;
  if (!token) { alert('Open shufersal.co.il/online, set a delivery area, then run again.'); return; }

  // Your basket: barcode (GTIN) + quantity.
  const items = [
    { gtin: '7290004131074', qty: 1 },
    { gtin: '7290000042381', qty: 2 },
  ];

  let ok = 0;
  for (const { gtin, qty } of items) {
    const code = 'P_' + gtin;
    const res = await fetch('/online/he/cart/add', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'CSRFToken': token },
      body: JSON.stringify({
        productCodePost: code, productCode: code,
        sellingMethod: 'BY_UNIT', qty, frontQuantity: qty,
        comment: '', affiliateCode: '',
      }),
    });
    if (res.ok) ok++;
  }
  alert('Shufersal: added ' + ok + '/' + items.length + '. Review your cart.');
})();
```

Notes: all 6 body fields are required (partial body returns a silent 200 no-op). No CSRF header → 405. Bulk alternative: `POST /online/he/cart/addGrid` (untested).

---

## stor.ai cohort ✅ (mechanism B) — Tiv Taam / Victory / Carrefour / Mega / Bitan / Machsanei

One code path for all of them; only the two IDs change. Cart line needs the stor.ai `retailerProductId` (map from barcode via the products search endpoint). No token — the session cookie carries auth.

```js
(async () => {
  // Swap per chain. Tiv Taam = 1062/924, Victory = 1470/2930.
  const RID = 1062, BID = 924;

  // Your basket: stor.ai product ids (valid for THIS branch) + quantity.
  const items = [
    { retailerProductId: 20261475, quantity: 1 },
    { retailerProductId: 1966627,  quantity: 1 },
  ];

  const base = '/v2/retailers/' + RID + '/branches/' + BID + '/carts';
  let cartId = null, ok = 0;
  for (const it of items) {
    const url = (cartId ? base + '/' + cartId : base) + '?appId=4';
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retailerProductId: it.retailerProductId, quantity: it.quantity, type: 1 }),
    });
    if (res.ok) {
      ok++;
      const j = await res.json().catch(() => null);
      if (!cartId && j) cartId = (j.cart && j.cart.id) || j.id || cartId;
    }
  }
  alert('Added ' + ok + '/' + items.length + '. Review your cart.');
})();
```

Notes: user must pick a branch/fulfillment first (an ID-less cart is discarded otherwise). `retailerProductId` is branch-scoped. Cloudflare does not block this in-browser path. Barcode→id: `GET /v2/retailers/{RID}/branches/{BID}/products?appId=4&filters=...` (exact barcode filter key still to pin — likely `term:{barcode:...}`).

---

## Rami Levy ⚠️ (mechanism A — localStorage rewrite) — one detail to pin

We proved injecting hydrated product objects into `localStorage["ramilevy"].cart.items` + reload works. A production bookmarklet needs to *hydrate from barcode/id first*. Cleanest path: send the minimal list to the stateless repricer, then persist what it returns.

```js
(async () => {
  const KEY = 'ramilevy';

  // Your basket: Rami Levy internal product ids + amount (their word for quantity).
  const wanted = [
    { id: 123456, amount: 1 },
    { id: 654321, amount: 2 },
  ];

  // Hydrate + reprice via the stateless cart endpoint, then persist.
  // NOTE: confirm the exact request shape of POST /api/v2/cart (5-min task) — this is the one unverified bit.
  const res = await fetch('/api/v2/cart', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: wanted }),
  });
  const priced = await res.json();
  const hydrated = priced.items || priced.cart && priced.cart.items;
  if (!hydrated) { alert('Could not hydrate — confirm /api/v2/cart request shape.'); return; }

  const state = JSON.parse(localStorage.getItem(KEY) || '{}');
  state.cart = state.cart || {};
  state.cart.items = hydrated;
  localStorage.setItem(KEY, JSON.stringify(state));
  location.reload();
})();
```

Notes: proven that a reload after writing `cart.items` makes the storefront reprice via `POST /api/v2/cart`. The only unverified piece is the request body the repricer expects (`items:[{id,amount}]` is the guess). Barcode→id via `/api/search/` or `/api/items/{id}`.

---

## Honest status
- **Shufersal, stor.ai cohort:** ready to try as-is (fill in real basket + IDs).
- **Rami Levy:** ready except the one `/api/v2/cart` request-shape confirmation.
- All three still need the **barcode → internal-id** lookup wired in (trivial, uses each chain's public product API) so a real basket of barcodes can drive them.
