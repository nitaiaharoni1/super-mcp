import { describe, expect, it } from "vitest";
import type { StoreLocationMetadata } from "../../../src/lib/resolveStoreLocation.js";
import {
  buildRecommendationPlans,
  toStorePlan,
} from "../../../src/services/basket/recommendationPlans.js";
import type { StoreSummary } from "../../../src/services/stores/index.js";
import type {
  BasketLine,
  BasketStoreResult,
  MultiStoreLine,
  ResolvedItem,
} from "../../../src/services/basket/types.js";

const OPTIONS = { distancePenaltyPerKm: 3, distanceReliable: true };

function line(
  itemIndex: number,
  lineTotal: number,
  overrides: Partial<BasketLine> = {},
): BasketLine {
  const qty = overrides.qty ?? 1;
  const unitPrice = overrides.unitPrice ?? lineTotal / qty;
  return {
    itemIndex,
    productId: `p${itemIndex}`,
    name: `item ${itemIndex}`,
    qty,
    qtyMode: "packs",
    listingId: `L${itemIndex}`,
    itemCode: String(itemIndex),
    unitPrice,
    lineTotal,
    promoApplied: overrides.promoApplied ?? false,
    promoDescription: overrides.promoDescription ?? null,
    substituted: false,
    substitutionReason: null,
    originalProductId: null,
    link: null,
    freshness: { sourceTs: null, ingestedAt: null },
    ...overrides,
  };
}

function storeResult(
  id: string,
  covered: number,
  total: number,
  km: number | null,
  requested = 10,
): BasketStoreResult {
  const lines = Array.from({ length: covered }, (_, i) => line(i, total / covered));
  return {
    storeId: id,
    storeName: id,
    chainId: `chain-${id}`,
    chainName: id,
    city: "תל אביב",
    address: null,
    distanceKm: km,
    currency: "ILS",
    total,
    itemsFound: covered,
    itemsRequested: requested,
    lines,
    missingItems: Array.from({ length: requested - covered }, (_, i) => ({
      itemIndex: covered + i,
      productId: `p${covered + i}`,
      name: `missing ${covered + i}`,
      reason: "no_price_data" as const,
    })),
  };
}

function resolved(index: number): ResolvedItem {
  return {
    index,
    qty: 1,
    qtyMode: "packs",
    amount: null,
    unit: null,
    productId: `p${index}`,
    name: `item ${index}`,
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 0.95,
    lowConfidence: false,
    candidates: [],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

function summary(id: string, overrides: Partial<StoreSummary> = {}): StoreSummary {
  return {
    id,
    chainId: `chain-${id}`,
    chainName: id,
    storeCode: "1",
    name: id,
    address: null,
    city: "תל אביב",
    zip: null,
    lat: 32.08,
    lng: 34.77,
    geoSource: "address",
    distanceKm: 1,
    ...overrides,
  };
}

function nearLocation(radiusKm = 3): StoreLocationMetadata {
  return {
    scope: "near",
    precision: "radius",
    fallbackApplied: false,
    warning: null,
    distanceReliable: true,
    requested: {
      city: null,
      near: { lat: 32.0819, lng: 34.7712 },
      radiusKm,
    },
  };
}

function expectLineArithmetic(priced: { qty: number; unitPrice: number; lineTotal: number; promoApplied: boolean; promoDescription: string | null }) {
  expect(priced.lineTotal).toBeGreaterThan(0);
  expect(priced.qty).toBeGreaterThan(0);
  const shelf = Math.round(priced.unitPrice * priced.qty * 100) / 100;
  if (priced.lineTotal !== shelf) {
    expect(priced.promoApplied).toBe(true);
    expect(priced.promoDescription).toBeTruthy();
  }
}

describe("recommendationPlans honesty", () => {
  it("marks partial totals as priced_lines_only and full coverage as complete_basket", () => {
    const partial = toStorePlan(storeResult("partial", 4, 40, 1, 10), 10, 10);
    expect(partial?.coverageRatio).toBe(0.4);
    expect(partial?.totalScope).toBe("priced_lines_only");

    const complete = toStorePlan(storeResult("full", 10, 100, 1, 10), 10, 10);
    expect(complete?.coverageRatio).toBe(1);
    expect(complete?.totalScope).toBe("complete_basket");
  });

  it("prefers a 90% covered store over a cheaper 40% covered store", () => {
    const plans = buildRecommendationPlans(
      [storeResult("cheap-partial", 4, 40, 1), storeResult("high-coverage", 9, 200, 2)],
      Array.from({ length: 10 }, (_, i) => resolved(i)),
      OPTIONS,
      10,
    );
    expect(plans.bestSingleStore?.storeId).toBe("high-coverage");
    expect(plans.bestSingleStore?.totalScope).toBe("priced_lines_only");
  });

  it("complete N-item store beats a cheaper N-1 store", () => {
    const plans = buildRecommendationPlans(
      [
        storeResult("complete", 10, 250, 3, 10),
        storeResult("one-short-cheaper", 9, 100, 1, 10),
      ],
      Array.from({ length: 10 }, (_, i) => resolved(i)),
      OPTIONS,
      10,
    );
    expect(plans.bestSingleStore?.storeId).toBe("complete");
    expect(plans.bestSingleStore?.totalScope).toBe("complete_basket");
    expect(plans.bestSingleStore?.coverageRatio).toBe(1);
  });

  it("excludes unreliable-distance stores from multiStore recommendations", () => {
    const local = storeResult("local", 2, 20, 1, 2);
    const unknown = storeResult("unknown-geo", 2, 10, null, 2);
    unknown.storeName = "unknown-geo";

    const location = nearLocation(3);
    const storesById = new Map([
      [
        "local",
        summary("local", { distanceKm: 1, geoSource: "address" }),
      ],
      [
        "unknown-geo",
        summary("unknown-geo", {
          distanceKm: null,
          geoSource: null,
          lat: null,
          lng: null,
        }),
      ],
    ]);

    const plans = buildRecommendationPlans(
      [local, unknown],
      [resolved(0), resolved(1)],
      OPTIONS,
      2,
      { location, storesById },
    );

    expect(plans.multiStore).not.toBeNull();
    expect(plans.multiStore?.lines.every((l) => l.storeId === "local")).toBe(true);
    expect(plans.bestSingleStore?.storeId).toBe("local");
  });

  it("verifies line arithmetic and promo metadata on store and multi-store lines", () => {
    const promoLine = line(0, 8, {
      qty: 2,
      unitPrice: 6,
      promoApplied: true,
      promoDescription: "2 for 8",
    });
    const plainLine = line(1, 5, { qty: 1, unitPrice: 5 });
    const store: BasketStoreResult = {
      ...storeResult("s1", 0, 0, 1, 2),
      lines: [promoLine, plainLine],
      total: 13,
      itemsFound: 2,
      missingItems: [],
    };

    const plans = buildRecommendationPlans(
      [store],
      [resolved(0), resolved(1)],
      OPTIONS,
      2,
      {
        location: nearLocation(3),
        storesById: new Map([["s1", summary("s1")]]),
      },
    );

    for (const priced of plans.bestSingleStore?.lines ?? []) {
      expectLineArithmetic(priced);
    }
    for (const priced of plans.multiStore?.lines ?? []) {
      expectLineArithmetic(priced as MultiStoreLine);
    }
    const multiPromo = plans.multiStore?.lines.find((l) => l.itemIndex === 0);
    expect(multiPromo?.promoApplied).toBe(true);
    expect(multiPromo?.promoDescription).toBe("2 for 8");
  });
});
