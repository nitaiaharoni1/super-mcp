import { describe, expect, it } from "vitest";
import { priceStoreBasket } from "../../../src/services/basket/priceStoreBasket.js";
import type {
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "../../../src/services/basket/types.js";

const STORE = {
  id: "store",
  chainId: "chain",
  chainName: "Chain",
  storeCode: "1",
  name: "Store",
  address: null,
  city: null,
  zip: null,
  lat: null,
  lng: null,
  geoSource: null,
  distanceKm: null,
} as const;

describe("priceStoreBasket", () => {
  it("does not replace a resolved product with a lower-ranked search candidate", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "safe",
      name: "Safe product",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [
        {
          productId: "safe",
          name: "Safe product",
          score: 0.95,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: false,
          hasLocalPrice: false,
          productClass: null,
        },
        {
          productId: "plausible-but-unapproved",
          name: "Plausible product",
          score: 0.9,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: null,
        },
      ],
      primaryProductId: "safe",
      primaryName: "Safe product",
      substitution: null,
    };

    const result = priceStoreBasket(
      STORE,
      [item],
      new Map([
        [
          "chain",
          new Map([
            [
              "plausible-but-unapproved",
              [
                {
                  id: "listing",
                  product_id: "plausible-but-unapproved",
                  chain_id: "chain",
                  item_code: "alt",
                  name: "Plausible product",
                  gtin: null,
                },
              ],
            ],
          ]),
        ],
      ]),
      new Map([
        [
          "listing:store",
          {
            listing_id: "listing",
            store_id: "store",
            price: "1",
            currency: "ILS",
            source_ts: "2026-01-01T00:00:00Z",
            ingested_at: "2026-01-01T00:00:00Z",
          },
        ],
      ]),
      new Map(),
    );

    expect(result).toBeNull();
  });

  it("prices a store from a gated equivalent SKU with chain_equivalent substitution metadata", () => {
    // Line resolved to Store A's tomato SKU ("a-tomato"); the gated equivalence
    // set also holds Store B's tomato SKU ("b-tomato"). Store B stocks only its
    // own SKU, so it must price the line from the equivalent and mark it as a
    // chain_equivalent substitution naming both products.
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "a-tomato",
      name: "עגבניות",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.9,
      lowConfidence: false,
      candidates: [
        {
          productId: "a-tomato",
          name: "עגבניות חממה A",
          score: 0.9,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "produce_tomato",
          intentTier: 1,
        },
      ],
      primaryProductId: "a-tomato",
      primaryName: "עגבניות חממה A",
      substitution: null,
      equivalents: [
        {
          productId: "a-tomato",
          name: "עגבניות חממה A",
          score: 0.9,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "produce_tomato",
          intentTier: 1,
        },
        {
          productId: "b-tomato",
          name: "עגבניות חממה B",
          score: 0.88,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "produce_tomato",
          intentTier: 1,
        },
      ],
    };

    const storeA = { ...STORE, id: "storeA", chainId: "chainA", chainName: "Chain A" } as const;
    const storeB = { ...STORE, id: "storeB", chainId: "chainB", chainName: "Chain B" } as const;

    const listingByChainAndProduct = new Map<string, Map<string, ListingRow[]>>([
      [
        "chainA",
        new Map([
          [
            "a-tomato",
            [
              {
                id: "listA",
                product_id: "a-tomato",
                chain_id: "chainA",
                item_code: "codeA",
                name: "עגבניות חממה A",
                gtin: null,
              },
            ],
          ],
        ]),
      ],
      [
        "chainB",
        new Map([
          [
            "b-tomato",
            [
              {
                id: "listB",
                product_id: "b-tomato",
                chain_id: "chainB",
                item_code: "codeB",
                name: "עגבניות חממה B",
                gtin: null,
              },
            ],
          ],
        ]),
      ],
    ]);

    const priceByListingAndStore = new Map<string, StorePriceRow>([
      [
        "listA:storeA",
        {
          listing_id: "listA",
          store_id: "storeA",
          price: "5",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
      [
        "listB:storeB",
        {
          listing_id: "listB",
          store_id: "storeB",
          price: "6",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
    ]);

    const resultA = priceStoreBasket(
      storeA,
      [item],
      listingByChainAndProduct,
      priceByListingAndStore,
      new Map(),
    );
    expect(resultA).not.toBeNull();
    expect(resultA!.lines).toHaveLength(1);
    expect(resultA!.lines[0]!.productId).toBe("a-tomato");
    expect(resultA!.lines[0]!.substituted).toBe(false);
    expect(resultA!.lines[0]!.substitutionReason).toBeNull();

    const resultB = priceStoreBasket(
      storeB,
      [item],
      listingByChainAndProduct,
      priceByListingAndStore,
      new Map(),
    );
    expect(resultB).not.toBeNull();
    expect(resultB!.missingItems).toHaveLength(0);
    expect(resultB!.lines).toHaveLength(1);
    const lineB = resultB!.lines[0]!;
    expect(lineB.productId).toBe("b-tomato");
    expect(lineB.substituted).toBe(true);
    expect(lineB.substitutionReason).toContain("chain_equivalent");
    // Names both products: the resolved primary and the chain's actual SKU.
    expect(lineB.substitutionReason).toContain("עגבניות חממה A");
    expect(lineB.substitutionReason).toContain("עגבניות חממה B");
    expect(lineB.originalProductId).toBe("a-tomato");
  });

  it("prefers confirmed primary (Coke) when stocked even if a cheaper equivalent (Crystal) exists", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "coke",
      name: "קוקה קולה",
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      confidence: 1,
      lowConfidence: false,
      candidates: [
        {
          productId: "coke",
          name: "קוקה קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
      ],
      primaryProductId: "coke",
      primaryName: "קוקה קולה 1.5 ל",
      substitution: null,
      equivalents: [
        {
          productId: "coke",
          name: "קוקה קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
        {
          productId: "crystal",
          name: "קריסטל קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
      ],
    };

    const listingByChainAndProduct = new Map<string, Map<string, ListingRow[]>>([
      [
        "chain",
        new Map([
          [
            "coke",
            [
              {
                id: "list-coke",
                product_id: "coke",
                chain_id: "chain",
                item_code: "coke",
                name: "קוקה קולה 1.5 ל",
                gtin: null,
              },
            ],
          ],
          [
            "crystal",
            [
              {
                id: "list-crystal",
                product_id: "crystal",
                chain_id: "chain",
                item_code: "crystal",
                name: "קריסטל קולה 1.5 ל",
                gtin: null,
              },
            ],
          ],
        ]),
      ],
    ]);
    const priceByListingAndStore = new Map<string, StorePriceRow>([
      [
        "list-coke:store",
        {
          listing_id: "list-coke",
          store_id: "store",
          price: "9.90",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
      [
        "list-crystal:store",
        {
          listing_id: "list-crystal",
          store_id: "store",
          price: "5.90",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
    ]);

    const result = priceStoreBasket(STORE, [item], listingByChainAndProduct, priceByListingAndStore, new Map());
    expect(result).not.toBeNull();
    expect(result!.lines[0]!.productId).toBe("coke");
    expect(result!.lines[0]!.unitPrice).toBe(9.9);
    expect(result!.lines[0]!.substituted).toBe(false);
  });

  it("falls back to cheapest equivalent when confirmed primary is not stocked", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "coke",
      name: "קוקה קולה",
      resolvedBy: "product_id",
      resolutionStatus: "resolved",
      confidence: 1,
      lowConfidence: false,
      candidates: [
        {
          productId: "coke",
          name: "קוקה קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
      ],
      primaryProductId: "coke",
      primaryName: "קוקה קולה 1.5 ל",
      substitution: null,
      equivalents: [
        {
          productId: "coke",
          name: "קוקה קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
        {
          productId: "crystal",
          name: "קריסטל קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
        {
          productId: "rc",
          name: "ארסי קולה 1.5 ל",
          score: 1,
          matchedVia: "product",
          sizeQty: 1500,
          sizeUnit: "ml",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "beverage",
        },
      ],
    };

    const listingByChainAndProduct = new Map<string, Map<string, ListingRow[]>>([
      [
        "chain",
        new Map([
          [
            "crystal",
            [
              {
                id: "list-crystal",
                product_id: "crystal",
                chain_id: "chain",
                item_code: "crystal",
                name: "קריסטל קולה 1.5 ל",
                gtin: null,
              },
            ],
          ],
          [
            "rc",
            [
              {
                id: "list-rc",
                product_id: "rc",
                chain_id: "chain",
                item_code: "rc",
                name: "ארסי קולה 1.5 ל",
                gtin: null,
              },
            ],
          ],
        ]),
      ],
    ]);
    const priceByListingAndStore = new Map<string, StorePriceRow>([
      [
        "list-crystal:store",
        {
          listing_id: "list-crystal",
          store_id: "store",
          price: "5.90",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
      [
        "list-rc:store",
        {
          listing_id: "list-rc",
          store_id: "store",
          price: "4.50",
          currency: "ILS",
          source_ts: "2026-01-01T00:00:00Z",
          ingested_at: "2026-01-01T00:00:00Z",
        },
      ],
    ]);

    const result = priceStoreBasket(STORE, [item], listingByChainAndProduct, priceByListingAndStore, new Map());
    expect(result).not.toBeNull();
    expect(result!.lines[0]!.productId).toBe("rc");
    expect(result!.lines[0]!.unitPrice).toBe(4.5);
    expect(result!.lines[0]!.substituted).toBe(true);
  });

  it("prices from a later listing when the first listing has no price at the store", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "prod",
      name: "Product",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [
        {
          productId: "prod",
          name: "Product",
          score: 0.95,
          matchedVia: "product",
          sizeQty: null,
          sizeUnit: null,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: null,
        },
      ],
      primaryProductId: "prod",
      primaryName: "Product",
      substitution: null,
    };

    const l1: ListingRow = {
      id: "L1",
      product_id: "prod",
      chain_id: "chain",
      item_code: "code1",
      name: "Product L1",
      gtin: null,
    };
    const l2: ListingRow = {
      id: "L2",
      product_id: "prod",
      chain_id: "chain",
      item_code: "code2",
      name: "Product L2",
      gtin: null,
    };
    // Only L2 has a price row at the store; the map contains BOTH listings.
    const priceRow: StorePriceRow = {
      listing_id: "L2",
      store_id: "store",
      price: "5",
      currency: "ILS",
      source_ts: "2026-01-01T00:00:00Z",
      ingested_at: "2026-01-01T00:00:00Z",
    };

    const result = priceStoreBasket(
      STORE,
      [item],
      new Map([["chain", new Map([["prod", [l1, l2]]])]]),
      new Map([["L2:store", priceRow]]),
      new Map(),
    );

    expect(result).not.toBeNull();
    expect(result!.missingItems).toHaveLength(0);
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0]!.listingId).toBe("L2");
    expect(result!.lines[0]!.unitPrice).toBe(5);
  });

  it("prices weighted watermelon pack_qty=1 as ~4kg against per-kg shelf rate", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "packs",
      amount: null,
      unit: null,
      productId: "wm",
      name: "אבטיח",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [
        {
          productId: "wm",
          name: "אבטיח",
          score: 0.95,
          matchedVia: "product",
          sizeQty: 1000,
          sizeUnit: "g",
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "watermelon",
        },
      ],
      primaryProductId: "wm",
      primaryName: "אבטיח",
      substitution: null,
    };
    const listing: ListingRow = {
      id: "L-wm",
      product_id: "wm",
      chain_id: "chain",
      item_code: "wm1",
      name: "אבטיח",
      gtin: null,
      is_weighted: true,
      sale_basis: "per_kg",
      piece_count: 1,
    };
    const priceRow: StorePriceRow = {
      listing_id: "L-wm",
      store_id: "store",
      price: "5",
      currency: "ILS",
      source_ts: "2026-01-01T00:00:00Z",
      ingested_at: "2026-01-01T00:00:00Z",
    };

    const result = priceStoreBasket(
      STORE,
      [item],
      new Map([["chain", new Map([["wm", [listing]]])]]),
      new Map([["L-wm:store", priceRow]]),
      new Map(),
    );

    expect(result).not.toBeNull();
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0]!.qty).toBeCloseTo(4, 5);
    expect(result!.lines[0]!.qtyMode).toBe("weighted_kg_or_l");
    expect(result!.lines[0]!.lineTotal).toBeCloseTo(20, 5);
  });

  it("prefers listing piece count over candidate piece count at final pricing", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 3,
      qtyMode: "packs",
      amount: 20,
      unit: "יח",
      productId: "pita",
      name: "פיתות ביתי",
      resolvedBy: "query",
      resolutionStatus: "resolved",
      confidence: 0.95,
      lowConfidence: false,
      candidates: [
        {
          productId: "pita",
          name: "פיתות ביתי",
          score: 0.95,
          matchedVia: "product",
          sizeQty: 1000,
          sizeUnit: "g",
          pieceCount: 8,
          hasPrice: true,
          hasLocalPrice: true,
          productClass: "pita_flatbread",
        },
      ],
      primaryProductId: "pita",
      primaryName: "פיתות ביתי",
      substitution: null,
    };
    const listing: ListingRow = {
      id: "L-pita",
      product_id: "pita",
      chain_id: "chain",
      item_code: "pita10",
      name: "פיתות ביתי",
      gtin: null,
      piece_count: 10,
    };
    const priceRow: StorePriceRow = {
      listing_id: "L-pita",
      store_id: "store",
      price: "10",
      currency: "ILS",
      source_ts: "2026-01-01T00:00:00Z",
      ingested_at: "2026-01-01T00:00:00Z",
    };

    const result = priceStoreBasket(
      STORE,
      [item],
      new Map([["chain", new Map([["pita", [listing]]])]]),
      new Map([["L-pita:store", priceRow]]),
      new Map(),
    );

    expect(result?.lines[0]).toMatchObject({
      qty: 2,
      qtyMode: "packs",
      lineTotal: 20,
    });
  });
});
