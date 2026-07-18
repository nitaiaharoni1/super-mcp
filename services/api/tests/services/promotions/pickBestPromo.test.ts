import { describe, expect, it } from "vitest";
import {
  pickBestPromoForStore,
  type PromoCandidate,
} from "../../../src/services/promotions/activePromotions.js";

const STORE = "store-1";
const CHAIN = "chain-1";

function simpleDiscount(
  promoCode: string,
  discountedPrice: number,
  overrides: Partial<PromoCandidate> = {},
): PromoCandidate {
  return {
    listingId: "listing-1",
    storeId: STORE,
    chainId: CHAIN,
    promoCode,
    description: `steak at ${discountedPrice}`,
    mechanic: { type: "simple_discount", params: { discountedPrice } },
    ...overrides,
  };
}

describe("pickBestPromoForStore", () => {
  it("picks the cheapest eligible promo regardless of candidate order", () => {
    const cheapestLast = [
      simpleDiscount("A", 169.9),
      simpleDiscount("B", 159.9),
      simpleDiscount("C", 129.9), // cheapest, appears last
    ];
    const picked = pickBestPromoForStore(cheapestLast, STORE, CHAIN, 199.9, 1);
    expect(picked?.candidate.promoCode).toBe("C");
    expect(picked?.effectiveTotal).toBeCloseTo(129.9);

    // Same set shuffled must yield the same winner — determinism.
    const shuffled = [cheapestLast[2]!, cheapestLast[0]!, cheapestLast[1]!];
    expect(pickBestPromoForStore(shuffled, STORE, CHAIN, 199.9, 1)?.candidate.promoCode).toBe("C");
  });

  it("ignores a no-op promo and applies a real one whatever the order", () => {
    // A simple_discount with no discountedPrice/discountRate never applies.
    const noop: PromoCandidate = {
      listingId: "listing-1",
      storeId: STORE,
      chainId: CHAIN,
      promoCode: "NOOP",
      description: "5% aliexpress collectors",
      mechanic: { type: "simple_discount", params: {} },
    };
    const real = simpleDiscount("REAL", 149.9);
    expect(pickBestPromoForStore([noop, real], STORE, CHAIN, 199.9, 1)?.candidate.promoCode).toBe(
      "REAL",
    );
    expect(pickBestPromoForStore([real, noop], STORE, CHAIN, 199.9, 1)?.candidate.promoCode).toBe(
      "REAL",
    );
  });

  it("only considers promos eligible for this store (own store or chain-wide)", () => {
    const otherStore = simpleDiscount("OTHER", 99.9, { storeId: "store-2" });
    const chainWide = simpleDiscount("CHAINWIDE", 179.9, { storeId: null });
    const picked = pickBestPromoForStore([otherStore, chainWide], STORE, CHAIN, 199.9, 1);
    // The 99.9 promo belongs to another store; the chain-wide 179.9 is the only eligible one.
    expect(picked?.candidate.promoCode).toBe("CHAINWIDE");
  });

  it("returns null when no eligible promo reduces the price below list", () => {
    const overpriced = simpleDiscount("OVER", 250, {}); // above list, never applied
    expect(pickBestPromoForStore([overpriced], STORE, CHAIN, 199.9, 1)).toBeNull();
    expect(pickBestPromoForStore([], STORE, CHAIN, 199.9, 1)).toBeNull();
    expect(pickBestPromoForStore(undefined, STORE, CHAIN, 199.9, 1)).toBeNull();
  });

  it("breaks effective-total ties deterministically by promo_code", () => {
    const tieB = simpleDiscount("B", 149.9);
    const tieA = simpleDiscount("A", 149.9);
    expect(pickBestPromoForStore([tieB, tieA], STORE, CHAIN, 199.9, 1)?.candidate.promoCode).toBe(
      "A",
    );
    expect(pickBestPromoForStore([tieA, tieB], STORE, CHAIN, 199.9, 1)?.candidate.promoCode).toBe(
      "A",
    );
  });
});
