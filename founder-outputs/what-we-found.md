# What we found (cart filling for Israeli grocery chains)

## The question
Can we fill a shopper's cart for them, without their password and without our servers pretending to be them?

## The answer: yes
A tiny **bookmarklet** (one button in the browser) can drop a whole shopping list into the cart. The shopper is already on the store's site, so the button runs "as them" using cookies their browser already has. No login, no password saved, no auto-checkout. They just review and pay.

Think of it like a "fill my trolley" button that only works while you're standing in the (online) store.

## What we proved, per chain

**Shufersal** — proven live. We drove a real cart from 0 to 3 items using the store's own "add to cart" call.
Example: give it barcode `7290004131074` x1, and it appears in the cart, priced by Shufersal.

**Tiv Taam, Victory (and the whole stor.ai family: Carrefour, Mega, Yeinot Bitan, Machsanei HaShuk)** — proven the mechanism. One piece of code covers all of them; you only swap two ID numbers per chain.
Example: Tiv Taam is store `1062`, branch `924`. Carrefour is a different pair. Same code otherwise.

**Rami Levy** — proven earlier, slightly different trick. Its cart lives in the browser's own storage, so the button writes the items in and reloads. Example: injected Osem spaghetti (₪5.90) + spicy noodles = 2 items, ₪11.10, and Rami Levy repriced them.

## The two "gotchas" we learned

**1. Pick the store first.** Every chain refuses to hold a cart until you choose a branch or delivery area. So the flow is always: shopper picks their store, *then* clicks fill. Not a blocker, just the order of steps.

**2. Cloudflare doesn't stop us.** Some chains sit behind a bot-blocker. We proved it only blocks outside servers, not the shopper's own browser. Same request: from a server = blocked (403); from the loaded page = works (200). That's the key reason this has to run in the shopper's browser, not on ours.

## Bottom line
- The "price brain" (which store is cheapest) runs on our server — easy, already works.
- The "fill the cart" part must run in the shopper's browser — and now we know it can, for every big chain.
- A simple bookmarklet is enough. No browser extension needed to start.

## Still to finish (small)
- Confirm one request detail for Rami Levy's cart.
- Add the "barcode → store's own product number" lookup so a plain shopping list can drive it.
