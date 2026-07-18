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
import { loadProductClasses } from "./productClasses.js";
import { rankQueryCandidates } from "./rankQueryCandidates.js";
import {
  searchQueryItem,
  type QuerySearchContext,
} from "./resolveQuery.js";
import type {
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

function validateItem(index: number, item: BasketItemInput): ValidatedItem {
  const hasQty = item.qty != null && Number.isFinite(item.qty) && item.qty > 0;
  const hasAmount = item.amount != null && Number.isFinite(item.amount) && item.amount > 0;
  if (!hasQty && !hasAmount) {
    throw new AppError("bad_request", `items[${index}] requires qty or amount`, 400);
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

async function resolveDirectItem(
  validated: ValidatedItem,
  location?: ResolveLocationScope,
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
    const res = await query<{
      id: string;
      name: string;
      size_qty: number | null;
      size_unit: string | null;
    }>(`SELECT id, name, size_qty, size_unit FROM product WHERE id = $1`, [item.productId]);
    const row = res.rows[0];
    if (!row) {
      return {
        ...base,
        qty: item.qty ?? item.amount ?? 1,
        qtyMode: "legacy_packs",
        productId: null,
        name: null,
        resolvedBy: "unresolved",
        confidence: null,
        lowConfidence: true,
        candidates: [],
      };
    }
    const purchase = resolvePurchaseQty({
      packQty: item.qty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: row.size_qty,
      productSizeUnit: row.size_unit,
      productName: row.name,
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
          // Direct product_id resolution hasn't checked local price yet; do not
          // fabricate availability.
          hasPrice: false,
          hasLocalPrice: false,
          productClass: null,
        },
      ],
    };
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
        qty: item.qty ?? item.amount ?? 1,
        qtyMode: "legacy_packs",
        productId: null,
        name: null,
        resolvedBy: "unresolved",
        confidence: null,
        lowConfidence: true,
        candidates: [],
      };
    }
    const purchase = resolvePurchaseQty({
      packQty: item.qty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: hit.sizeQty,
      productSizeUnit: hit.sizeUnit,
      productName: hit.name,
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
      const resolved = await resolveDirectItem(entry, searchLocation);
      return { kind: "direct", index: entry.index, resolved };
    },
  );

  // Phase 2: union candidate IDs and load semantic profiles once.
  const queryPhases = phase1.filter((row): row is Phase1Query => row.kind === "query");
  const needsProfiles = queryPhases.some((row) => row.ctx.ontology != null);
  const candidateIds = [
    ...new Set(queryPhases.flatMap((row) => row.ctx.hits.map((hit) => hit.id))),
  ];
  let profiles = new Map<string, SemanticProfile | Partial<SemanticProfile>>();
  let profileBatchMs = 0;
  if (needsProfiles) {
    const profileStarted = Date.now();
    const loaded = await loadSemanticProfiles(candidateIds, activeOntologyVersion());
    profiles = loaded ?? new Map();
    profileBatchMs = Date.now() - profileStarted;
  }
  // Offline LLM taxonomy (migration 017) for every candidate id, one batched read.
  const classMap = await loadProductClasses(candidateIds);

  // Phase 3: rank/decide each query line from the shared profile Map.
  // Ranking is sync/CPU-bound on the main thread; a shared merge cache avoids
  // repeating profileFromText for products that appear on multiple lines.
  const mergedProfileCache = new Map<string, SemanticProfile>();
  const resolved = new Array<ResolvedItem>(items.length);
  for (const row of phase1) {
    if (row.kind === "direct") {
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
