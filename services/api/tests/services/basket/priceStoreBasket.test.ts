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
  distanceKm: null,
} as const;

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

  it("prices from a later listing when the first listing has no price at the store", () => {
    const item: ResolvedItem = {
      index: 0,
      qty: 1,
      qtyMode: "legacy_packs",
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
});
