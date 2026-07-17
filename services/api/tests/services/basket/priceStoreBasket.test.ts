import { describe, expect, it } from "vitest";
import { priceStoreBasket } from "../../../src/services/basket/priceStoreBasket.js";
import type { ResolvedItem } from "../../../src/services/basket/types.js";

describe("priceStoreBasket", () => {
  it("does not replace a resolved product with a lower-ranked search candidate", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "legacy_packs",
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
        },
      ],
      primaryProductId: "safe",
      primaryName: "Safe product",
      substitution: null,
    };

    const result = priceStoreBasket(
      {
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
        distanceKm: null,
      },
      [item],
      new Map([
        [
          "chain",
          new Map([
            [
              "plausible-but-unapproved",
              {
                id: "listing",
                product_id: "plausible-but-unapproved",
                chain_id: "chain",
                item_code: "alt",
                name: "Plausible product",
                gtin: null,
              },
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
});
