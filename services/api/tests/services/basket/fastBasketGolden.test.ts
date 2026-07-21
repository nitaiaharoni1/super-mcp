import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BasketCandidate,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "../../../src/services/basket/types.js";
import {
  FORBIDDEN_FAST_SELECTIONS,
  TEL_AVIV_LOCATION,
  TEL_AVIV_STAPLES_ITEMS,
} from "../../fixtures/telAvivStaplesBasket.js";

const resolveItems = vi.fn();
const listStores = vi.fn();
const loadBasketPricingData = vi.fn();
const loadCandidateAvailability = vi.fn();

vi.mock("../../../src/services/basket/resolve.js", () => ({
  resolveItems: (...args: unknown[]) => resolveItems(...args),
}));

vi.mock("../../../src/services/stores/index.js", () => ({
  listStores: (...args: unknown[]) => listStores(...args),
}));

vi.mock("../../../src/services/basket/loadPricingData.js", () => ({
  loadBasketPricingData: (...args: unknown[]) => loadBasketPricingData(...args),
  loadCandidateAvailability: (...args: unknown[]) => loadCandidateAvailability(...args),
}));

vi.mock("../../../src/services/search/ontology.js", () => ({
  getActiveOntology: vi.fn().mockResolvedValue(null),
}));

// commodityCoverage → loadProductClasses hits Postgres; unit tests have no DATABASE_URL in CI.
vi.mock("../../../src/services/basket/productClasses.js", () => ({
  loadProductClasses: vi.fn(async () => new Map()),
}));

import { optimizeBasket } from "../../../src/services/basket/optimize.js";

const OPTIONS = { continuationSecret: "test-only-basket-continuation-secret-ok" };

const CHAIN_ID = "22222222-2222-4222-8222-222222222222";
const STORE_COUNT = 8;

const productId = (i: number, variant = 0) =>
  `00000000-0000-4000-8000-${String(i * 10 + variant).padStart(12, "0")}`;
const listingId = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`;
const storeId = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;

/** Lines that today pause for confirmation; fast mode should assume them. */
const ASSUMPTION_LINES = new Set([0, 1, 7, 9]);

type LineCatalog = {
  safeName: string;
  traps: string[];
  productClass: string;
  pieceCount?: number | null;
  sizeQty?: number | null;
  sizeUnit?: string | null;
};

const LINE_CATALOG: LineCatalog[] = [
  {
    safeName: "חלב טרי 3%",
    traps: ["חלב בטעם אגוזי לוז"],
    productClass: "dairy_milk",
    sizeQty: 1,
    sizeUnit: "L",
  },
  {
    safeName: "ביצים תבנית 12",
    traps: ["6 ביצים"],
    productClass: "eggs",
    pieceCount: 12,
  },
  { safeName: "לחם אחיד 750 גרם", traps: [], productClass: "bakery" },
  { safeName: "קוטג' 5%", traps: [], productClass: "dairy_cottage" },
  {
    safeName: "עגבניות טריות",
    traps: ["עגבניות מרוסקות"],
    productClass: "produce_tomato",
  },
  { safeName: "מלפפונים טריים", traps: [], productClass: "produce_cucumber" },
  {
    safeName: "תפוחי אדמה טריים",
    traps: ["קמח תפוחי אדמה", "ניוקי תפוחי אדמה"],
    productClass: "produce_potato",
  },
  {
    safeName: "עוף טרי לחזה",
    traps: [],
    productClass: "meat_chicken",
  },
  { safeName: "אורז פרסי", traps: [], productClass: "dry_rice", sizeQty: 1, sizeUnit: "kg" },
  {
    safeName: "שמן קנולה 1 ל",
    traps: ["אמול שמן אמבט"],
    productClass: "oil_cooking",
    sizeQty: 1,
    sizeUnit: "L",
  },
];

function candidate(over: Partial<BasketCandidate> & { productId: string; name: string }): BasketCandidate {
  return {
    score: 0.9,
    matchedVia: "product",
    sizeQty: null,
    sizeUnit: null,
    pieceCount: null,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: null,
    ...over,
  };
}

function makeResolvedItem(index: number): ResolvedItem {
  const item = TEL_AVIV_STAPLES_ITEMS[index]!;
  const catalog = LINE_CATALOG[index]!;
  const needsConfirm = ASSUMPTION_LINES.has(index);

  const safe = candidate({
    productId: productId(index, 0),
    name: catalog.safeName,
    score: 0.92,
    productClass: catalog.productClass,
    pieceCount: catalog.pieceCount ?? null,
    sizeQty: catalog.sizeQty ?? null,
    sizeUnit: catalog.sizeUnit ?? null,
    intentTier: 1,
  });
  const traps = catalog.traps.map((name, trapIndex) =>
    candidate({
      productId: productId(index, trapIndex + 1),
      name,
      score: 0.88 - trapIndex * 0.02,
      productClass: catalog.productClass,
      intentTier: 2,
    }),
  );

  const amount = item.amount ?? null;
  const unit = item.unit ?? null;
  const qtyMode = amount != null && unit != null ? "weighted_kg_or_l" : "packs";
  const qty = item.packQty ?? amount ?? 1;

  return {
    index,
    qty,
    qtyMode,
    amount,
    unit,
    productId: needsConfirm ? null : safe.productId,
    name: needsConfirm ? (item.query ?? catalog.safeName) : catalog.safeName,
    resolvedBy: needsConfirm ? "unresolved" : "query",
    resolutionStatus: needsConfirm ? "needs_confirmation" : "resolved",
    confidence: needsConfirm ? null : 0.95,
    lowConfidence: needsConfirm,
    candidates: [safe, ...traps],
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };
}

function pricingData() {
  const byProduct = new Map<string, ListingRow[]>();
  const priceByListingAndStore = new Map<string, StorePriceRow>();

  for (let index = 0; index < TEL_AVIV_STAPLES_ITEMS.length; index += 1) {
    const catalog = LINE_CATALOG[index]!;
    const pid = productId(index, 0);
    const lId = listingId(index);
    byProduct.set(pid, [
      {
        id: lId,
        product_id: pid,
        chain_id: CHAIN_ID,
        item_code: String(index),
        name: catalog.safeName,
        gtin: null,
        piece_count: catalog.pieceCount ?? null,
        is_weighted: catalog.productClass.startsWith("produce_") || catalog.productClass === "meat_chicken",
        sale_basis:
          catalog.productClass.startsWith("produce_") || catalog.productClass === "meat_chicken"
            ? "per_kg"
            : "per_pack",
      },
    ]);
    for (let si = 0; si < STORE_COUNT; si += 1) {
      priceByListingAndStore.set(`${lId}:${storeId(si)}`, {
        listing_id: lId,
        store_id: storeId(si),
        price: String(8 + index + si * 0.4),
        currency: "ILS",
        source_ts: "2026-07-21T00:00:00Z",
        ingested_at: "2026-07-21T00:00:00Z",
      });
    }
  }

  return {
    listingByChainAndProduct: new Map([[CHAIN_ID, byProduct]]),
    priceByListingAndStore,
    promoMap: new Map(),
  };
}

function stores() {
  return Array.from({ length: STORE_COUNT }, (_, si) => ({
    id: storeId(si),
    chainId: CHAIN_ID,
    chainName: "רשת בדיקה",
    storeCode: String(si),
    name: `סניף תל אביב ${si}`,
    address: `רחוב בן גוריון ${si}`,
    city: "תל אביב",
    zip: null,
    lat: 32.08 + si * 0.001,
    lng: 34.78 + si * 0.001,
    geoSource: "address" as const,
    distanceKm: 0.5 + si * 0.2,
  }));
}

describe("fast one-call Tel Aviv staples golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockImplementation(async (productIds: string[]) => {
      const map = new Map();
      for (const id of productIds) {
        map.set(id, { pricedStoreCount: STORE_COUNT, chainCount: 1, minPrice: 10 });
      }
      return map;
    });
    listStores.mockResolvedValue(stores());
    resolveItems.mockResolvedValue(
      TEL_AVIV_STAPLES_ITEMS.map((_, index) => makeResolvedItem(index)),
    );
    loadBasketPricingData.mockResolvedValue(pricingData());
  });

  it("completes in one call with assumptions, safety, quantity, and payload bounds", async () => {
    // TEL_AVIV_LOCATION is the free-text agent input; service layer uses city after geocode.
    expect(TEL_AVIV_LOCATION).toContain("תל אביב");

    const result = await optimizeBasket(
      {
        items: TEL_AVIV_STAPLES_ITEMS,
        city: "תל אביב",
        verbose: false,
        storesLimit: 3,
        resolutionMode: "fast",
        responseDetail: "summary",
      },
      OPTIONS,
    );

    expect(result.status).toBe("complete");
    expect(result).not.toHaveProperty("stores");
    expect(result.items.every((item) => !("candidates" in item))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(15_000);

    if (result.status !== "complete") throw new Error("expected complete");
    expect(result.assumptions.map((entry) => entry.itemIndex)).toEqual(
      expect.arrayContaining([0, 1, 7, 9]),
    );
    expect(result.coverage).toMatchObject({
      requestedLines: TEL_AVIV_STAPLES_ITEMS.length,
      pricedLines: expect.any(Number),
      omittedLines: expect.any(Number),
    });
    expect(Array.isArray(result.omittedItems)).toBe(true);
    const payload = JSON.stringify(result);
    for (const name of FORBIDDEN_FAST_SELECTIONS) {
      expect(payload).not.toContain(name);
    }

    // Quantity invariants — preserve requested physical amounts.
    expect(result.items[4]).toMatchObject({ amount: 1, unit: "kg" });
    expect(result.items[6]).toMatchObject({ amount: 2, unit: "kg" });
    expect(result.items[7]).toMatchObject({ amount: 1.5, unit: "kg" });
    expect(result.items[9]).toMatchObject({ amount: 1, unit: "L" });

    const pricedLines = [
      ...(result.bestSingleStore?.lines ?? []),
      ...(result.multiStore?.lines ?? []),
    ];
    expect(pricedLines.length).toBeGreaterThan(0);
    for (const line of pricedLines) {
      expect(line.qty).toBeGreaterThan(0);
      // Weighted staples must not collapse into unrelated pack fractions.
      if ([4, 5, 6, 7, 8, 9].includes(line.itemIndex)) {
        expect(line.qty).not.toBe(0.3);
      }
    }
  });

  it("emits geocode/response telemetry separate from basket phase timings", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line === "string") logs.push(line);
    });

    try {
      await optimizeBasket(
        {
          items: TEL_AVIV_STAPLES_ITEMS,
          city: "תל אביב",
          geocodeMs: 12,
          locationOrigin: {
            precision: "city",
            provider: "city_centroid",
            cached: false,
            fallbackApplied: true,
            displayName: "תל אביב-יפו",
            attribution: null,
            warning: "Using city-level location for a faster estimate; distances are approximate.",
          },
          resolutionMode: "fast",
          responseDetail: "summary",
          storesLimit: 3,
        },
        OPTIONS,
      );
    } finally {
      spy.mockRestore();
    }

    const event = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((row) => row?.event === "basket_optimize");

    expect(event).toMatchObject({
      geocodeMs: 12,
      geocodeStrategy: "city_fallback",
      resolutionMode: "fast",
      responseDetail: "summary",
    });
    expect(typeof event?.responseBytes).toBe("number");
    expect(event?.responseBytes).toBeLessThan(15_000);
    // Basket phases remain present and distinct from geocodeMs.
    expect(typeof event?.searchMs).toBe("number");
    expect(typeof event?.pricingMs).toBe("number");
    expect(JSON.stringify(event)).not.toContain(TEL_AVIV_LOCATION);
  });
});
