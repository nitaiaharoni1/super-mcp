import { query } from "@super-mcp/db";
import { AppError, mapPool, resolvePurchaseQty, type SemanticProfile } from "@super-mcp/shared";
import {
  activeOntologyVersion,
  getActiveOntology,
  loadSemanticProfiles,
  searchProductsScored,
} from "../search/index.js";
import { toSearchLocationParams } from "../search/locationScope.js";
import { hitToCandidate } from "./candidates.js";
import { loadProductClasses, type ProductClassInfo } from "./productClasses.js";
import { rankQueryCandidates } from "./rankQueryCandidates.js";
import {
  searchQueryItem,
  type QuerySearchContext,
} from "./resolveQuery.js";
import type {
  BasketCandidate,
  BasketItemInput,
  ResolvedItem,
  ResolveLocationScope,
} from "./types.js";

/** Bounded concurrency for basket line resolution (search is DB-heavy). */
export const RESOLVE_ITEMS_CONCURRENCY = 6;

type ValidatedItem = {
  index: number;
  item: BasketItemInput;
  hasAmount: boolean;
  amount: number | null;
  unit: string | null;
};

type Phase1Direct = {
  kind: "direct";
  index: number;
  resolved: ResolvedItem;
};

type Phase1Query = {
  kind: "query";
  index: number;
  amount: number | null;
  unit: string | null;
  ctx: QuerySearchContext;
};

type Phase1Result = Phase1Direct | Phase1Query;

type ProductRow = {
  id: string;
  name: string;
  size_qty: number | null;
  size_unit: string | null;
  piece_count: number | null;
};

function validateItem(index: number, item: BasketItemInput): ValidatedItem {
  const hasQty = item.packQty != null && Number.isFinite(item.packQty) && item.packQty > 0;
  const hasAmount = item.amount != null && Number.isFinite(item.amount) && item.amount > 0;
  if (!hasQty && !hasAmount) {
    throw new AppError("bad_request", `items[${index}] requires packQty or amount`, 400);
  }
  if (hasAmount && !(item.unit && item.unit.trim())) {
    throw new AppError(
      "bad_request",
      `items[${index}] amount requires unit (kg, g, L, ml, unit, יח, …)`,
      400,
    );
  }
  return {
    index,
    item,
    hasAmount,
    amount: hasAmount ? item.amount! : null,
    unit: hasAmount ? item.unit!.trim() : null,
  };
}

/** One batched product lookup for every product_id line in the basket. */
async function loadProductsById(productIds: string[]): Promise<Map<string, ProductRow>> {
  const map = new Map<string, ProductRow>();
  if (productIds.length === 0) return map;
  const res = await query<ProductRow>(
    `SELECT id, name, size_qty, size_unit, piece_count
     FROM product
     WHERE id = ANY($1::uuid[])`,
    [productIds],
  );
  for (const row of res.rows) map.set(row.id, row);
  return map;
}

function stampCandidateClass(candidate: BasketCandidate, info: ProductClassInfo): void {
  candidate.classL1 = info.l1;
  candidate.classL2 = info.l2;
  candidate.classL3 = info.l3;
  candidate.variant = info.variant;
  candidate.brandExtracted = info.brand;
  if (!candidate.productClass) candidate.productClass = info.l1;
}

function stampDirectResolvedClasses(
  resolved: ResolvedItem,
  classMap: Map<string, ProductClassInfo>,
): void {
  if (!resolved.productId) return;
  const info = classMap.get(resolved.productId);
  if (!info) return;
  for (const c of resolved.candidates) {
    if (c.productId === resolved.productId) stampCandidateClass(c, info);
  }
}

function resolveProductIdItem(
  validated: ValidatedItem,
  row: ProductRow | undefined,
): ResolvedItem {
  const { index, item, amount, unit } = validated;
  const base = {
    index,
    amount,
    unit,
    primaryProductId: null as string | null,
    primaryName: null as string | null,
    substitution: null,
  };
  if (!row) {
    return {
      ...base,
      qty: item.packQty ?? item.amount ?? 1,
      qtyMode: "packs",
      productId: null,
      name: null,
      resolvedBy: "unresolved",
      confidence: null,
      lowConfidence: true,
      candidates: [],
    };
  }
  const purchase = resolvePurchaseQty({
    packQty: item.packQty,
    amount: item.amount,
    unit: item.unit,
    productSizeQty: row.size_qty,
    productSizeUnit: row.size_unit,
    productName: row.name,
    pieceCount: row.piece_count,
  });
  return {
    ...base,
    qty: purchase.qty,
    qtyMode: purchase.mode,
    productId: row.id,
    name: row.name,
    resolvedBy: "product_id",
    confidence: 1,
    lowConfidence: false,
    candidates: [
      {
        productId: row.id,
        name: row.name,
        score: 1,
        matchedVia: "product",
        sizeQty: row.size_qty,
        sizeUnit: row.size_unit,
        pieceCount: row.piece_count,
        // Direct product_id resolution hasn't checked local price yet; do not
        // fabricate availability.
        hasPrice: false,
        hasLocalPrice: false,
        productClass: null,
      },
    ],
  };
}

async function resolveDirectItem(
  validated: ValidatedItem,
  location: ResolveLocationScope | undefined,
  productById: Map<string, ProductRow>,
): Promise<ResolvedItem> {
  const { index, item, amount, unit } = validated;
  const base = {
    index,
    amount,
    unit,
    primaryProductId: null as string | null,
    primaryName: null as string | null,
    substitution: null,
  };

  if (item.productId) {
    return resolveProductIdItem(validated, productById.get(item.productId));
  }

  if (item.gtin) {
    const hits = await searchProductsScored({
      q: "",
      gtin: item.gtin,
      limit: 1,
      ...toSearchLocationParams(location ?? {}),
      semanticExpand: false,
    });
    const hit = hits[0];
    if (!hit) {
      return {
        ...base,
        qty: item.packQty ?? item.amount ?? 1,
        qtyMode: "packs",
        productId: null,
        name: null,
        resolvedBy: "unresolved",
        confidence: null,
        lowConfidence: true,
        candidates: [],
      };
    }
    const purchase = resolvePurchaseQty({
      packQty: item.packQty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: hit.sizeQty,
      productSizeUnit: hit.sizeUnit,
      productName: hit.name,
      pieceCount: hit.pieceCount,
    });
    return {
      ...base,
      qty: purchase.qty,
      qtyMode: purchase.mode,
      productId: hit.id,
      name: hit.name,
      resolvedBy: "gtin",
      confidence: 1,
      lowConfidence: false,
      candidates: [hitToCandidate(hit)],
    };
  }

  throw new AppError("bad_request", `items[${index}] must include one of product_id, gtin, or query`, 400);
}

/** Resolve all basket lines concurrently (bounded — search is DB-heavy). */
export async function resolveItems(
  items: BasketItemInput[],
  location?: ResolveLocationScope,
): Promise<ResolvedItem[]> {
  await getActiveOntology();
  const started = Date.now();
  const searchLocation = toSearchLocationParams(location ?? {});
  const queryLineCount = items.filter((item) => !item.productId && !item.gtin && item.query).length;

  const validated = items.map((item, index) => validateItem(index, item));

  // Batch every product_id lookup into one SELECT before phase-1 concurrency.
  const productIdsToLoad = [
    ...new Set(validated.flatMap((v) => (v.item.productId ? [v.item.productId] : []))),
  ];
  const productById = await loadProductsById(productIdsToLoad);

  // Phase 1: product_id/gtin resolve + query search (bounded concurrency).
  const phase1 = await mapPool(
    validated,
    RESOLVE_ITEMS_CONCURRENCY,
    async (entry): Promise<Phase1Result> => {
      if (entry.item.query && !entry.item.productId && !entry.item.gtin) {
        const ctx = await searchQueryItem(
          entry.item,
          { index: entry.index, amount: entry.amount, unit: entry.unit },
          searchLocation,
          entry.hasAmount,
        );
        return {
          kind: "query",
          index: entry.index,
          amount: entry.amount,
          unit: entry.unit,
          ctx,
        };
      }
      const resolved = await resolveDirectItem(entry, searchLocation, productById);
      return { kind: "direct", index: entry.index, resolved };
    },
  );

  // Phase 2: union candidate IDs and load semantic profiles once.
  const queryPhases = phase1.filter((row): row is Phase1Query => row.kind === "query");
  const directPhases = phase1.filter((row): row is Phase1Direct => row.kind === "direct");
  const needsProfiles = queryPhases.some((row) => row.ctx.ontology != null);
  const directProductIds = directPhases.flatMap((row) =>
    row.resolved.productId ? [row.resolved.productId] : [],
  );
  const candidateIds = [
    ...new Set([
      ...queryPhases.flatMap((row) => row.ctx.hits.map((hit) => hit.id)),
      ...directProductIds,
    ]),
  ];
  let profiles = new Map<string, SemanticProfile | Partial<SemanticProfile>>();
  let profileBatchMs = 0;
  if (needsProfiles) {
    const profileStarted = Date.now();
    // Profiles are only needed for query ranking — keep the batch to query hits.
    const queryCandidateIds = [
      ...new Set(queryPhases.flatMap((row) => row.ctx.hits.map((hit) => hit.id))),
    ];
    const loaded = await loadSemanticProfiles(queryCandidateIds, activeOntologyVersion());
    profiles = loaded ?? new Map();
    profileBatchMs = Date.now() - profileStarted;
  }
  // Offline LLM taxonomy (migration 017) for every candidate + direct product id.
  const classMap = await loadProductClasses(candidateIds);

  // Phase 3: rank/decide each query line from the shared profile Map.
  // Ranking is sync/CPU-bound on the main thread; a shared merge cache avoids
  // repeating profileFromText for products that appear on multiple lines.
  const mergedProfileCache = new Map<string, SemanticProfile>();
  const resolved = new Array<ResolvedItem>(items.length);
  for (const row of phase1) {
    if (row.kind === "direct") {
      stampDirectResolvedClasses(row.resolved, classMap);
      resolved[row.index] = row.resolved;
      continue;
    }
    const queryResult = rankQueryCandidates(row.ctx, profiles, {
      profileMs: 0,
      sharedProfileBatch: true,
      mergedProfileCache,
      classMap,
    });
    resolved[row.index] = {
      index: row.index,
      amount: row.amount,
      unit: row.unit,
      ...queryResult,
    };
  }

  console.log(
    JSON.stringify({
      event: "basket_resolve",
      itemCount: items.length,
      queryLineCount,
      durationMs: Date.now() - started,
      concurrency: RESOLVE_ITEMS_CONCURRENCY,
      profileBatchMs,
      profileCandidateCount: candidateIds.length,
    }),
  );
  return resolved;
}
