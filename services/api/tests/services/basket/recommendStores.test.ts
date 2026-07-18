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
    const { bestNearby } = pickRecommendations(
      [
        store("far-cheap", 11, 471, 9.8),
        store("near-full", 15, 610, 1.2),
        store("nearest-empty", 2, 68, 0.1),
      ],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("near-full"); // coverage wins
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

  it("cheapest ignores a sparse store below the coverage floor", () => {
    // maxCov = 8, floor = ceil(8 * 0.8) = 7. The 1-line store at 39.9 is below
    // the floor, so it must lose to the well-covering (but pricier) store.
    const { cheapest } = pickRecommendations(
      [store("sparse", 1, 39.9, 0.5), store("full", 8, 440, 2)],
      { distancePenaltyPerKm: 3 },
    );
    expect(cheapest!.storeName).toBe("full");
  });

  it("cheapest picks the lower total among equally-covering stores", () => {
    const { cheapest } = pickRecommendations(
      [store("a", 8, 400, 1), store("b", 8, 450, 1)],
      { distancePenaltyPerKm: 3 },
    );
    expect(cheapest!.storeName).toBe("a");
  });

  it("cheapest picks lower total among all stores meeting the floor", () => {
    // maxCov = 8, floor = ceil(8 * 0.8) = 7. Both 7/8 and 8/8 meet the floor,
    // so the cheaper 7/8 store wins even though it covers one fewer line.
    const { cheapest } = pickRecommendations(
      [store("seven", 7, 300, 1), store("eight", 8, 320, 1)],
      { distancePenaltyPerKm: 3 },
    );
    expect(cheapest!.storeName).toBe("seven");
  });

  it("bestNearby still returns the max-coverage store regardless of cheapest logic", () => {
    const { bestNearby } = pickRecommendations(
      [store("sparse", 1, 39.9, 0.5), store("full", 8, 440, 2)],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("full");
  });
});
