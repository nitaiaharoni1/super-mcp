import { describe, expect, it } from "vitest";
import { pickRecommendations } from "../../../src/services/basket/recommendStores.js";
import type { BasketLine, BasketStoreResult } from "../../../src/services/basket/types.js";

/** Minimal BasketStoreResult with `covered` priced lines. */
const store = (
  name: string,
  covered: number,
  total: number,
  km: number | null,
  opts: { orderable?: number } = {},
): BasketStoreResult => {
  const orderable = opts.orderable ?? covered;
  return {
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
    lines: Array.from({ length: covered }, (_, i) =>
      ({
        itemIndex: i,
        link: i < orderable ? `https://shop.example/${name}/${i}` : null,
      }) as BasketLine,
    ),
    missingItems: [],
  };
};

describe("pickRecommendations", () => {
  it("coverage-first still wins when gap > 1 line", () => {
    const { bestNearby, bestInStore } = pickRecommendations(
      [
        store("far-cheap", 11, 471, 9.8),
        store("near-full", 15, 610, 1.2),
        store("nearest-empty", 2, 68, 0.1),
      ],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("near-full");
    expect(bestInStore!.storeName).toBe("near-full");
  });

  it("within 1-line band, nearer/cheaper wins when distanceReliable", () => {
    // maxCov=12; both 11 and 12 are eligible. a: 500+24=524, b: 510+3=513 → b
    const { bestNearby } = pickRecommendations(
      [store("a", 12, 500, 8), store("b", 11, 510, 1)],
      { distancePenaltyPerKm: 3, distanceReliable: true },
    );
    expect(bestNearby!.storeName).toBe("b");
  });

  it("when distanceReliable, prefers known branch distance over null (centroid) distance", () => {
    // fuller has null km (city centroid) → treated as far; nearer-known wins in-band.
    const fuller = store("centroid-fuller", 12, 400, null);
    const nearer = store("address-near", 11, 420, 1);
    const { bestNearby } = pickRecommendations(
      [fuller, nearer],
      { distancePenaltyPerKm: 3, distanceReliable: true },
    );
    expect(bestNearby!.storeName).toBe("address-near");
  });

  it("when distanceReliable=false, distance does not affect ranking", () => {
    // Same coverage: without distance, lower total (a) wins despite being farther.
    const { bestNearby } = pickRecommendations(
      [store("a", 12, 500, 8), store("b", 12, 510, 1)],
      { distancePenaltyPerKm: 3, distanceReliable: false },
    );
    expect(bestNearby!.storeName).toBe("a");
  });

  it("when distanceReliable=false, cheaper in-band store beats pricier +1 coverage", () => {
    // maxCov=12; both eligible. Without geo, total-first within the band (not
    // coverage-first) — avoids Arena winning solely on a +1 fake-coverage edge.
    const { bestNearby } = pickRecommendations(
      [store("fuller", 12, 600, 8), store("cheaper-one-less", 11, 300, 1)],
      { distancePenaltyPerKm: 3, distanceReliable: false },
    );
    expect(bestNearby!.storeName).toBe("cheaper-one-less");
  });

  it("bestOrderable prefers more linked lines even if total coverage is slightly lower", () => {
    // A covers more total lines but few links; B has slightly lower total coverage
    // but max orderable links — bestOrderable must pick B.
    const { bestOrderable, bestNearby } = pickRecommendations(
      [
        store("many-total-few-links", 12, 300, 1, { orderable: 8 }),
        store("fewer-total-more-links", 11, 400, 5, { orderable: 11 }),
      ],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestOrderable!.storeName).toBe("fewer-total-more-links");
    // Total-coverage band still prefers A (cheaper within maxCov-1).
    expect(bestNearby!.storeName).toBe("many-total-few-links");
  });

  it("empty store list yields all nulls", () => {
    expect(pickRecommendations([], { distancePenaltyPerKm: 3 })).toEqual({
      cheapest: null,
      bestNearby: null,
      bestInStore: null,
      bestOrderable: null,
    });
  });

  it("bestOrderable is null when no store has linked lines", () => {
    const { bestOrderable } = pickRecommendations(
      [store("a", 5, 100, 1, { orderable: 0 }), store("b", 4, 90, 2, { orderable: 0 })],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestOrderable).toBeNull();
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

  it("bestNearby still returns the max-coverage store when gap > 1", () => {
    const { bestNearby } = pickRecommendations(
      [store("sparse", 1, 39.9, 0.5), store("full", 8, 440, 2)],
      { distancePenaltyPerKm: 3 },
    );
    expect(bestNearby!.storeName).toBe("full");
  });

  it("bestNearby and bestInStore are the same pick", () => {
    const picks = pickRecommendations(
      [store("a", 10, 500, 3), store("b", 9, 480, 1)],
      { distancePenaltyPerKm: 3 },
    );
    expect(picks.bestNearby).toBe(picks.bestInStore);
    expect(picks.bestNearby!.storeName).toBe("b");
  });
});
