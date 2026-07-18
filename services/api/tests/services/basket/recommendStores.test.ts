import { describe, expect, it } from "vitest";
import { pickRecommendations } from "../../../src/services/basket/recommendStores.js";
import type { BasketLine, BasketStoreResult } from "../../../src/services/basket/types.js";

/** Minimal BasketStoreResult with `covered` priced lines. */
const store = (
  name: string,
  covered: number,
  total: number,
  km: number | null,
): BasketStoreResult => ({
  storeId: name,
  storeName: name,
  chainId: `chain-${name}`,
  chainName: name,
  city: null,
  address: null,
  distanceKm: km,
  currency: "ILS",
  total,
  itemsFound: covered,
  itemsRequested: covered,
  // Covered-line count is read from the priced `lines` array.
  lines: Array.from({ length: covered }, (_, i) => ({ itemIndex: i }) as BasketLine),
  missingItems: [],
});

describe("pickRecommendations", () => {
  it("bestNearby maximizes coverage, then total + distance penalty", () => {
    const { bestNearby, cheapest } = pickRecommendations(
      [
        store("far-cheap", 11, 471, 9.8),
        store("near-full", 15, 610, 1.2),
        store("nearest-empty", 2, 68, 0.1),
      ],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("near-full"); // coverage wins
    // cheapest = pure lowest total (per spec): nearest-empty's 68 is the lowest,
    // even though it only covers 2 lines. bestNearby is the "actually go here" pick.
    expect(cheapest!.storeName).toBe("nearest-empty");
  });

  it("distance breaks ties between equal-coverage stores", () => {
    const { bestNearby } = pickRecommendations(
      [store("a", 12, 500, 8), store("b", 12, 510, 1)],
      { distancePenaltyPerKm: 3 },
    );
    // 500 + 24 = 524 vs 510 + 3 = 513 -> b
    expect(bestNearby!.storeName).toBe("b");
  });

  it("empty store list yields both null", () => {
    expect(pickRecommendations([], { distancePenaltyPerKm: 3 })).toEqual({
      cheapest: null,
      bestNearby: null,
    });
  });
});
