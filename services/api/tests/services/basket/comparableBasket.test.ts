import { describe, expect, it } from "vitest";
import {
  buildComparableCosts,
  buildReferenceLinePrices,
} from "../../../src/services/basket/comparableBasket.js";
import {
  pickBestSingleStore,
  pickClosestUsefulStore,
  distancePenaltyForPreference,
  effectiveCost,
} from "../../../src/services/basket/recommendStores.js";
import type {
  BasketLine,
  BasketStoreResult,
  DistanceAccuracy,
} from "../../../src/services/basket/types.js";

function line(itemIndex: number, lineTotal: number, clubOnly = false): BasketLine {
  return {
    itemIndex,
    productId: `p${itemIndex}`,
    name: `item ${itemIndex}`,
    qty: 1,
    qtyMode: "packs",
    listingId: `L${itemIndex}`,
    itemCode: String(itemIndex),
    unitPrice: lineTotal,
    lineTotal,
    sizeQty: null,
    sizeUnit: null,
    normalizedUnitPrice: null,
    normalizedUnitBasis: null,
    promoApplied: clubOnly,
    promoDescription: clubOnly ? "club" : null,
    clubOnly,
    substituted: false,
    substitutionReason: null,
    originalProductId: null,
    link: null,
    freshness: { sourceTs: null, ingestedAt: null },
  };
}

function store(
  id: string,
  lines: BasketLine[],
  km: number | null,
  accuracy: DistanceAccuracy = "branch",
): BasketStoreResult {
  return {
    storeId: id,
    storeName: id,
    chainId: `chain-${id}`,
    chainName: id,
    city: "הרצליה",
    address: null,
    distanceKm: km,
    distanceAccuracy: accuracy,
    storeKind: "branch",
    currency: "ILS",
    total: Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100,
    itemsFound: lines.length,
    itemsRequested: 3,
    lines,
    missingItems: [],
  };
}

describe("buildReferenceLinePrices", () => {
  it("uses the median so one outlier cannot move the reference", () => {
    const stores = [
      store("a", [line(0, 10)], 1),
      store("b", [line(0, 12)], 1),
      store("c", [line(0, 500)], 1),
    ];
    expect(buildReferenceLinePrices(stores).get(0)).toBe(12);
  });

  it("averages the middle pair for an even sample", () => {
    const stores = [store("a", [line(0, 10)], 1), store("b", [line(0, 20)], 1)];
    expect(buildReferenceLinePrices(stores).get(0)).toBe(15);
  });

  it("skips lines no store prices — they cancel out of every comparison", () => {
    const reference = buildReferenceLinePrices([store("a", [line(0, 10)], 1)]);
    expect(reference.has(0)).toBe(true);
    expect(reference.has(1)).toBe(false);
  });
});

describe("buildComparableCosts", () => {
  it("charges a store the market price for lines it does not stock", () => {
    // Two stores price milk+bread; only the first also prices the pricey tuna.
    const withTuna = store("with", [line(0, 12), line(1, 6), line(2, 71.6)], 1);
    const withoutTuna = store("without", [line(0, 12), line(1, 6)], 1);

    const costs = buildComparableCosts([withTuna, withoutTuna]);

    expect(costs.get("with")).toMatchObject({
      comparableTotal: 89.6,
      imputedTotal: 0,
      imputedLines: 0,
    });
    // 18 observed + 71.60 reference for the tuna it does not carry.
    expect(costs.get("without")).toMatchObject({
      comparableTotal: 89.6,
      imputedTotal: 71.6,
      imputedLines: 1,
    });
  });

  it("counts club-only lines per store", () => {
    const costs = buildComparableCosts([
      store("a", [line(0, 10, true), line(1, 5), line(2, 3, true)], 1),
    ]);
    expect(costs.get("a")?.clubOnlyLines).toBe(2);
  });
});

describe("pickBestSingleStore comparability", () => {
  /**
   * The live Herzliya regression: the recommended store showed ₪92.86 against a
   * ₪171.42 rival purely because it did not price a ₪71.60 tuna line.
   */
  it("does not prefer a store that is only cheaper because it stocks less", () => {
    const nineLines = store(
      "covers-tuna",
      [line(0, 12.82), line(1, 6.5), line(2, 17.2), line(9, 71.6)],
      1.31,
    );
    const eightLines = store(
      "no-tuna",
      [line(0, 12.82), line(1, 6.5), line(2, 14.24)],
      1.05,
    );

    const costs = buildComparableCosts([nineLines, eightLines]);
    const opts = { distancePenaltyPerKm: 3, distanceReliable: true, comparableCosts: costs };

    // Raw totals would pick the smaller basket by a wide margin.
    expect(eightLines.total).toBeLessThan(nineLines.total);
    // On the same basket the gap collapses to the few shekels it really is...
    expect(costs.get("no-tuna")!.comparableTotal).toBeCloseTo(105.16, 2);
    expect(costs.get("covers-tuna")!.comparableTotal).toBeCloseTo(108.12, 2);
    // ...which is not worth the second trip the missing line forces.
    expect(pickBestSingleStore([nineLines, eightLines], opts)?.storeId).toBe("covers-tuna");
  });

  it("still picks the incomplete store when it saves more than the extra trip costs", () => {
    const complete = store("complete", [line(0, 100), line(1, 100)], 1);
    const cheapPartial = store("cheap-partial", [line(0, 20)], 1);
    const costs = buildComparableCosts([complete, cheapPartial]);
    // cheap-partial: 20 observed + 100 imputed + 20 trip = 140 vs complete 200.
    expect(
      pickBestSingleStore([complete, cheapPartial], {
        distancePenaltyPerKm: 3,
        distanceReliable: true,
        comparableCosts: costs,
      })?.storeId,
    ).toBe("cheap-partial");
  });

  it("still prefers the genuinely cheaper store at equal coverage", () => {
    const dear = store("dear", [line(0, 20), line(1, 20)], 1);
    const cheap = store("cheap", [line(0, 10), line(1, 10)], 1);
    const costs = buildComparableCosts([dear, cheap]);
    expect(
      pickBestSingleStore([dear, cheap], {
        distancePenaltyPerKm: 3,
        distanceReliable: true,
        comparableCosts: costs,
      })?.storeId,
    ).toBe("cheap");
  });
});

describe("preference", () => {
  it("maps each preference to its distance penalty, and an explicit value wins", () => {
    expect(distancePenaltyForPreference("cheapest", undefined)).toBe(0);
    expect(distancePenaltyForPreference("balanced", undefined)).toBe(3);
    expect(distancePenaltyForPreference("closest", undefined)).toBe(60);
    expect(distancePenaltyForPreference(undefined, undefined)).toBe(3);
    expect(distancePenaltyForPreference("closest", 7)).toBe(7);
  });

  it("cheapest ignores distance entirely; closest overrides a real price gap", () => {
    const near = store("near", [line(0, 60), line(1, 60)], 0.5);
    const far = store("far", [line(0, 40), line(1, 40)], 9);
    const costs = buildComparableCosts([near, far]);

    const cheapest = pickBestSingleStore([near, far], {
      distancePenaltyPerKm: distancePenaltyForPreference("cheapest", undefined),
      distanceReliable: true,
      preference: "cheapest",
      comparableCosts: costs,
    });
    expect(cheapest?.storeId).toBe("far");

    const closest = pickBestSingleStore([near, far], {
      distancePenaltyPerKm: distancePenaltyForPreference("closest", undefined),
      distanceReliable: true,
      preference: "closest",
      comparableCosts: costs,
    });
    expect(closest?.storeId).toBe("near");
  });

  it("closest still refuses a nearby store that covers far too little", () => {
    const nearThin = store("near-thin", [line(0, 5)], 0.2);
    const farFull = store("far-full", [line(0, 5), line(1, 5), line(2, 5), line(3, 5), line(4, 5)], 8);
    const costs = buildComparableCosts([nearThin, farFull]);
    // 1 line vs 5 lines is outside even the closest band (3).
    expect(
      pickClosestUsefulStore([nearThin, farFull], {
        distancePenaltyPerKm: 60,
        distanceReliable: true,
        preference: "closest",
        comparableCosts: costs,
      })?.storeId,
    ).toBe("far-full");
  });
});

describe("distance accuracy", () => {
  it("charges a city-placed store for its positional uncertainty but keeps it rankable", () => {
    const branch = store("branch", [line(0, 100)], 5, "branch");
    const cityPlaced = store("city", [line(0, 100)], 5, "city");
    const opts = { distancePenaltyPerKm: 3, distanceReliable: true };

    expect(effectiveCost(cityPlaced, opts)).toBeGreaterThan(effectiveCost(branch, opts));
    // Still finite and comparable, not the 50km "unknown" charge.
    expect(effectiveCost(cityPlaced, opts)).toBeLessThan(effectiveCost(branch, opts) + 30);
  });

  it("treats a missing distance as far away", () => {
    const known = store("known", [line(0, 100)], 5, "branch");
    const unknown = store("unknown", [line(0, 100)], null, "unknown");
    const opts = { distancePenaltyPerKm: 3, distanceReliable: true };
    expect(effectiveCost(unknown, opts)).toBeGreaterThan(effectiveCost(known, opts));
  });

  it("ignores distance completely when it cannot order the stores", () => {
    const a = store("a", [line(0, 100)], 1, "branch");
    const b = store("b", [line(0, 100)], 40, "branch");
    const opts = { distancePenaltyPerKm: 3, distanceReliable: false };
    expect(effectiveCost(a, opts)).toBe(effectiveCost(b, opts));
  });
});

describe("incomplete-basket penalty scales with how much is missing", () => {
  it("charges more for a store missing more lines, at equal comparable total", () => {
    // Both end up at the same comparable total; A misses one line, B misses three.
    const priced = [line(0, 30), line(1, 30), line(2, 30), line(3, 30)];
    const missesOne = store("misses-one", priced.slice(0, 3), 1);
    const missesThree = store("misses-three", [line(0, 30)], 1);
    // Give the wider gap the same comparable total by construction of the reference.
    const costs = buildComparableCosts([
      store("ref", priced, 1),
      missesOne,
      missesThree,
    ]);
    const opts = { distancePenaltyPerKm: 0, distanceReliable: true, comparableCosts: costs };
    expect(costs.get("misses-one")!.comparableTotal).toBe(
      costs.get("misses-three")!.comparableTotal,
    );
    expect(effectiveCost(missesThree, opts)).toBeGreaterThan(effectiveCost(missesOne, opts));
    // Two extra missing lines at ₪5 each.
    expect(effectiveCost(missesThree, opts) - effectiveCost(missesOne, opts)).toBeCloseTo(10, 5);
  });

  it("charges nothing extra when the store finishes the list", () => {
    const full = store("full", [line(0, 30), line(1, 30)], 1);
    const costs = buildComparableCosts([full]);
    const opts = { distancePenaltyPerKm: 0, distanceReliable: true, comparableCosts: costs };
    expect(effectiveCost(full, opts)).toBe(full.total);
  });
});
