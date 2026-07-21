import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BasketCandidate,
  BasketItemInput,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "../../../src/services/basket/types.js";

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

const CHAIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAIN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const storeId = (chain: "a" | "b", i: number) =>
  `${chain === "a" ? "1" : "2"}1111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
const productId = (chain: "a" | "b" | "shared", i: number) =>
  `${chain === "a" ? "a0" : chain === "b" ? "b0" : "c0"}000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const listingId = (chain: "a" | "b", i: number) =>
  `${chain === "a" ? "d" : "e"}4444444-4444-4444-8444-${String(i).padStart(12, "0")}`;

/** Exact 18-item BBQ input from the resumable plan. */
const BBQ_ITEMS: BasketItemInput[] = [
  { query: "פרגיות", amount: 1.75, unit: "kg" },
  { query: "קבבים", amount: 1.5, unit: "kg" },
  { query: "אנטרקוט", amount: 0.75, unit: "kg" },
  { query: "פיתות", amount: 20, unit: "יח" },
  { query: "חומוס", amount: 1.5, unit: "kg" },
  { query: "טחינה", amount: 0.5, unit: "kg" },
  { query: "מלח גס", packQty: 1 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "פלפל", amount: 3, unit: "יח" },
  { query: "בצל", amount: 3, unit: "יח" },
  { query: "חסה", amount: 1, unit: "יח" },
  { query: "לימון", amount: 4, unit: "יח" },
  { query: "אבטיח", amount: 1, unit: "יח" },
  { query: "קוקה קולה 1.5 ליטר", amount: 2, unit: "יח" },
  { query: "יין", amount: 3, unit: "יח" },
  { query: "טייסטרס צ׳ויס", packQty: 1 },
  { query: "שקית קרח", packQty: 1 },
];

type Catalog = "chain-scoped" | "shared" | "dry";
type Kind = "resolved" | "confirm";

const LINE_META: Array<{ kind: Kind; catalog?: Catalog }> = [
  { kind: "resolved", catalog: "chain-scoped" }, // פרגיות
  { kind: "resolved", catalog: "chain-scoped" }, // קבבים
  { kind: "resolved", catalog: "chain-scoped" }, // אנטרקוט
  { kind: "resolved", catalog: "dry" }, // פיתות
  { kind: "resolved", catalog: "dry" }, // חומוס
  { kind: "resolved", catalog: "dry" }, // טחינה
  { kind: "resolved", catalog: "dry" }, // מלח
  { kind: "resolved", catalog: "chain-scoped" }, // עגבניות
  { kind: "resolved", catalog: "chain-scoped" }, // מלפפונים
  { kind: "resolved", catalog: "chain-scoped" }, // פלפל
  { kind: "resolved", catalog: "chain-scoped" }, // בצל
  { kind: "resolved", catalog: "chain-scoped" }, // חסה
  { kind: "resolved", catalog: "chain-scoped" }, // לימון
  { kind: "resolved", catalog: "chain-scoped" }, // אבטיח
  { kind: "confirm" }, // קולה — regular vs Zero
  { kind: "resolved", catalog: "shared" }, // יין
  { kind: "confirm" }, // טייסטרס
  { kind: "confirm" }, // שקית קרח
];

function candidate(over: Partial<BasketCandidate> & { productId: string; name: string }): BasketCandidate {
  return {
    score: 0.95,
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
  const item = BBQ_ITEMS[index]!;
  const meta = LINE_META[index]!;
  const query = item.query!;
  const base = {
    index,
    qty: item.packQty ?? 1,
    qtyMode: "packs",
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    primaryProductId: null,
    primaryName: null,
    substitution: null,
  };

  if (meta.kind === "confirm") {
    const names =
      index === 14
        ? [`${query} רגיל`, `${query} זירו`, `${query} זירו ליים`]
        : index === 16
          ? [`טייסטרס צ׳ויס 200ג`, `קפה נמס גנרי`, `קפה עלית`]
          : [`שקית קרח 2קג`, `ארטיק קרח`, `קרחון תות`];
    return {
      ...base,
      productId: null,
      name: query,
      resolvedBy: "unresolved",
      resolutionStatus: "needs_confirmation",
      confidence: null,
      lowConfidence: true,
      candidates: names.map((name, i) =>
        candidate({
          productId: productId("a", 100 + index * 10 + i),
          name,
          productClass: index === 14 ? "beverage" : index === 16 ? "coffee" : "frozen",
          variant: index === 14 && i > 0 ? "diet_zero" : "regular",
          brandExtracted: index === 16 && i === 0 ? "taster's choice" : null,
        }),
      ),
    };
  }

  const sizeQty = index === 3 ? 1000 : null;
  const sizeUnit = index === 3 ? "g" : null;
  const pieceCount = index === 3 ? 10 : null;
  const displayName =
    index === 0
      ? "פרגיות טרי (רשת א)"
      : index === 3
        ? "פיתות 10 יח (רשת א)"
        : `${query} (רשת א)`;

  const primary = candidate({
    productId: productId("a", index),
    name: displayName,
    sizeQty,
    sizeUnit,
    pieceCount,
  });
  const resolved: ResolvedItem = {
    ...base,
    productId: primary.productId,
    name: primary.name,
    resolvedBy: "query",
    resolutionStatus: "resolved",
    confidence: 0.95,
    lowConfidence: false,
    candidates: [primary],
  };
  if (meta.catalog === "chain-scoped") {
    resolved.equivalents = [
      candidate({
        productId: productId("b", index),
        name: `${query} (רשת ב)`,
        sizeQty,
        sizeUnit,
        pieceCount,
      }),
    ];
  }
  return resolved;
}

function listing(
  id: string,
  pid: string,
  chain: string,
  code: string,
  name: string,
  gtin: string | null,
  pieceCount: number | null = null,
): ListingRow {
  return {
    id,
    product_id: pid,
    chain_id: chain,
    item_code: code,
    name,
    gtin,
    piece_count: pieceCount,
  };
}

function price(lId: string, sId: string, value: number): [string, StorePriceRow] {
  return [
    `${lId}:${sId}`,
    {
      listing_id: lId,
      store_id: sId,
      price: String(value),
      currency: "ILS",
      source_ts: "2026-07-17T00:00:00Z",
      ingested_at: "2026-07-17T00:00:00Z",
    },
  ];
}

const A_STORES = 8;
const B_STORES = 4;

function stockProduct(
  byChain: Map<string, ListingRow[]>,
  priceByListingAndStore: Map<string, StorePriceRow>,
  opts: {
    chain: "a" | "b";
    chainId: string;
    index: number;
    productId: string;
    name: string;
    gtin: string | null;
    pieceCount?: number | null;
    storeCount: number;
    basePrice: number;
  },
): void {
  const lId = listingId(opts.chain, opts.index);
  byChain.set(opts.productId, [
    listing(
      lId,
      opts.productId,
      opts.chainId,
      `${opts.chain.toUpperCase()}${opts.index}`,
      opts.name,
      opts.gtin,
      opts.pieceCount ?? null,
    ),
  ]);
  for (let si = 0; si < opts.storeCount; si += 1) {
    priceByListingAndStore.set(
      ...price(lId, storeId(opts.chain, si), opts.basePrice + si * 0.25),
    );
  }
}

function pricingData() {
  const byChainA = new Map<string, ListingRow[]>();
  const byChainB = new Map<string, ListingRow[]>();
  const priceByListingAndStore = new Map<string, StorePriceRow>();

  BBQ_ITEMS.forEach((item, index) => {
    const meta = LINE_META[index]!;
    const query = item.query!;
    const pieceCount = index === 3 ? 10 : null;

    if (meta.kind === "confirm") {
      // After answers, first option becomes the priced SKU on chain A.
      const pid = productId("a", 100 + index * 10);
      stockProduct(byChainA, priceByListingAndStore, {
        chain: "a",
        chainId: CHAIN_A,
        index: 100 + index,
        productId: pid,
        name: `${query} א`,
        gtin: null,
        storeCount: A_STORES,
        basePrice: 10 + index,
      });
      // Chain B also stocks two confirm lines so multi-store can reach 18.
      stockProduct(byChainB, priceByListingAndStore, {
        chain: "b",
        chainId: CHAIN_B,
        index: 100 + index,
        productId: pid,
        name: `${query} ב`,
        gtin: null,
        storeCount: B_STORES,
        basePrice: 12 + index,
      });
      return;
    }

    const aPid = productId("a", index);
    stockProduct(byChainA, priceByListingAndStore, {
      chain: "a",
      chainId: CHAIN_A,
      index,
      productId: aPid,
      name: `${query} רשת א`,
      gtin: meta.catalog === "shared" ? "7290000000001" : null,
      pieceCount,
      storeCount: A_STORES,
      basePrice: 10 + index,
    });

    if (meta.catalog === "chain-scoped") {
      stockProduct(byChainB, priceByListingAndStore, {
        chain: "b",
        chainId: CHAIN_B,
        index,
        productId: productId("b", index),
        name: `${query} רשת ב`,
        gtin: null,
        pieceCount,
        storeCount: B_STORES,
        basePrice: 11 + index,
      });
    } else if (meta.catalog === "shared") {
      stockProduct(byChainB, priceByListingAndStore, {
        chain: "b",
        chainId: CHAIN_B,
        index,
        productId: aPid,
        name: `${query} רשת ב`,
        gtin: "7290000000001",
        storeCount: B_STORES,
        basePrice: 12 + index,
      });
    }
  });

  return {
    listingByChainAndProduct: new Map([
      [CHAIN_A, byChainA],
      [CHAIN_B, byChainB],
    ]),
    priceByListingAndStore,
    promoMap: new Map(),
  };
}

function stores() {
  const a = Array.from({ length: A_STORES }, (_, si) => ({
    id: storeId("a", si),
    chainId: CHAIN_A,
    chainName: "רשת א (מלאה)",
    storeCode: `A${si}`,
    name: `סניף א ${si}`,
    address: `רחוב א ${si}`,
    city: "הרצליה",
    zip: null,
    lat: null,
    lng: null,
    geoSource: null,
    distanceKm: 1 + si * 0.3,
  }));
  const b = Array.from({ length: B_STORES }, (_, si) => ({
    id: storeId("b", si),
    chainId: CHAIN_B,
    chainName: "רשת ב (חלקית)",
    storeCode: `B${si}`,
    name: `סניף ב ${si}`,
    address: `רחוב ב ${si}`,
    city: "הרצליה",
    zip: null,
    lat: null,
    lng: null,
    geoSource: null,
    distanceKm: 2 + si * 0.3,
  }));
  return [...a, ...b];
}

describe("resumable BBQ golden — confirm then complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCandidateAvailability.mockResolvedValue(new Map());
    listStores.mockResolvedValue(stores());
    resolveItems.mockResolvedValue(BBQ_ITEMS.map((_, index) => makeResolvedItem(index)));
    loadBasketPricingData.mockResolvedValue(pricingData());
  });

  const bbqInput = () => ({
    items: BBQ_ITEMS,
    city: "הרצליה",
    verbose: false,
    storesLimit: 3,
    resolutionMode: "strict" as const,
    responseDetail: "summary" as const,
  });

  it("completes the protocol with quantity, safety, coverage, and payload bounds", async () => {
    const first = await optimizeBasket(bbqInput(), OPTIONS);
    expect(first.status).toBe("needs_confirmation");
    if (first.status !== "needs_confirmation") throw new Error("expected confirmation");
    expect(first.questions.length).toBeGreaterThan(0);
    expect(first.questions.length).toBeLessThanOrEqual(3);
    expect(loadBasketPricingData).not.toHaveBeenCalled();

    const wineQuestion = first.questions.find((question) => question.itemIndex === 15);

    resolveItems.mockResolvedValue(
      BBQ_ITEMS.map((_, index) => {
        const item = makeResolvedItem(index);
        if (item.resolutionStatus !== "needs_confirmation") return item;
        const pick = item.candidates[0]!;
        return {
          ...item,
          productId: pick.productId,
          name: pick.name,
          resolutionStatus: "resolved" as const,
          lowConfidence: false,
          confidence: 0.95,
        };
      }),
    );

    const second = await optimizeBasket(
      {
        continuation: first.continuation,
        answers: first.questions.map((q) => ({
          itemIndex: q.itemIndex,
          productId: q.options[0]!.productId,
        })),
      },
      { ...OPTIONS, now: 1_001 },
    );

    expect([first.status, second.status]).toEqual(["needs_confirmation", "complete"]);
    if (second.status !== "complete") throw new Error("expected completion");

    expect(second.bestSingleStore?.pricedLines).toBeGreaterThanOrEqual(16);
    expect(second.multiStore?.pricedLines).toBe(18);

    const pita = second.bestSingleStore?.lines.find((line) => line.itemIndex === 3);
    expect(pita).toMatchObject({ qty: 2, qtyMode: "packs" });

    const payload = JSON.stringify(second);
    expect(payload).not.toContain("totalsArePartial");
    expect(payload).not.toContain('"cheapest"');
    // 18 lines × (bestSingleStore + multiStore) stays under the agent payload budget.
    expect(payload.length).toBeLessThan(40_000);

    const regularCokeLine = second.bestSingleStore?.lines.find((line) => line.itemIndex === 14);
    expect(regularCokeLine?.name).not.toMatch(/zero|זירו/i);

    const pargiyotLine = second.bestSingleStore?.lines.find((line) => line.itemIndex === 0);
    expect(pargiyotLine?.name).not.toMatch(/עם עצם|ירכיים/i);

    const wineLine = second.bestSingleStore?.lines.find((line) => line.itemIndex === 15);
    expect(Boolean(wineQuestion) || Boolean(wineLine)).toBe(true);
  });
});
