import { query } from "@super-mcp/db";
import { mapPool, normalizeEmbedInput, normalizeMeasure, tokenizeNormalized } from "@super-mcp/shared";
import { queryTokensSatisfied } from "./equivalence.js";
import { loadProductClasses } from "./productClasses.js";
import type { BasketCandidate, BasketItemInput, ResolvedItem } from "./types.js";

/** Bounded concurrency for the per-line coverage queries (DB-heavy). */
const COVERAGE_CONCURRENCY = 6;
/** Max interchangeable SKUs to attach per line (enough to span every local chain). */
const MAX_COVERAGE_EQUIVALENTS = 20;

interface CarriedProductRow {
  product_id: string;
  name: string;
  size_qty: number | null;
  size_unit: string | null;
}

/**
 * Products actually priced in the in-scope stores that share the primary's
 * commodity CLASS (deepest known level: L3 else L2 else L1) AND its VARIANT
 * (regular/cherry_grape/diet_zero/organic...). Class rules out cross-category
 * drift (allspice for pepper, canned/pickled for fresh, lime for lemon); variant
 * rules out same-class variety drift (cherry tomato / Coke Zero / organic under a
 * generic line) — this is what the old NEUTRAL_TOKENS word list did by hand.
 * Peers whose variant is NULL (unclassified) are allowed and filtered by the
 * query-token check downstream. Only classified products qualify.
 */
async function fetchCarriedClassPeers(
  primary: BasketCandidate,
  storeIds: string[],
): Promise<CarriedProductRow[]> {
  const conds: string[] = ["m.class_l1 = $2"];
  const params: unknown[] = [storeIds, primary.classL1];
  if (primary.classL2) {
    conds.push(`m.class_l2 = $${params.length + 1}`);
    params.push(primary.classL2);
  }
  if (primary.classL3) {
    conds.push(`m.class_l3 = $${params.length + 1}`);
    params.push(primary.classL3);
  }
  // EXACT variant match (default a stale/unknown primary to regular). A NULL peer
  // variant is NOT a wildcard: a stale row (classified before the variant pass)
  // whose name implies שרי/דיאט/אורגני would otherwise group into a generic line.
  conds.push(`m.variant = $${params.length + 1}`);
  params.push(primary.variant ?? "regular");
  const res = await query<CarriedProductRow>(
    `SELECT DISTINCT ON (l.product_id) l.product_id, p.name, p.size_qty, p.size_unit
       FROM product p
       JOIN product_class_map m ON m.product_id = p.id AND m.input_name = p.name
       JOIN listing l ON l.product_id = p.id
       JOIN store_price sp ON sp.listing_id = l.id AND sp.price > 0
      WHERE sp.store_id = ANY($1::uuid[]) AND ${conds.join(" AND ")}
      LIMIT 300`,
    params,
  );
  return res.rows;
}

export interface FilterClassPeersOptions {
  /**
   * When false, skip query-token matching (class+variant SQL + unit still apply).
   * Used for product_id/gtin-only lines where queryText is the primary product
   * name — brand/chain tokens like "שופרסל" must not block other chains' peers.
   */
  requireQueryTokens?: boolean;
}

/**
 * Keep same-class, same-variant peers that also satisfy the query (relevance) and
 * unit. Class+variant were enforced in SQL; here we hold query SPECIFICITY
 * (morphology-tolerant, so plural/singular don't break it, but a cabernet or a
 * brand token is still required) and unit agreement.
 */
export function filterClassPeers(
  queryText: string,
  primary: BasketCandidate,
  rows: CarriedProductRow[],
  opts: FilterClassPeersOptions = {},
): CarriedProductRow[] {
  const requireQueryTokens = opts.requireQueryTokens !== false;
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (requireQueryTokens && queryTokens.length === 0) return [];
  const primaryMeasure = primary.sizeUnit ? normalizeMeasure(1, primary.sizeUnit) : null;
  const primaryCanonUnit =
    primaryMeasure && !primaryMeasure.unparseable ? primaryMeasure.unit : null;
  const seen = new Set<string>();
  const out: CarriedProductRow[] = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    if (requireQueryTokens && !queryTokensSatisfied(queryTokens, row.name)) continue;
    if (primaryCanonUnit && row.size_unit) {
      const m = normalizeMeasure(row.size_qty ?? 1, row.size_unit);
      if (!m.unparseable && m.unit !== primaryCanonUnit) continue;
    }
    seen.add(row.product_id);
    out.push(row);
    if (out.length >= MAX_COVERAGE_EQUIVALENTS) break;
  }
  return out;
}

/** Query text for peer filtering: prefer the line's free-text query, else primary name. */
export function coverageQueryText(
  item: BasketItemInput | undefined,
  primary: BasketCandidate,
): string {
  const q = item?.query?.trim();
  return q || primary.name;
}

/**
 * Lines eligible for class-gated coverage broadening: auto-resolved query lines
 * with free text, plus confirmed product_id / gtin lines (name used when query
 * is absent).
 */
export function isCoverageTarget(r: ResolvedItem, items: BasketItemInput[]): boolean {
  if (r.productId == null) return false;
  switch (r.resolvedBy) {
    case "query":
      return r.resolutionStatus === "resolved" && Boolean(items[r.index]?.query);
    case "product_id":
    case "gtin":
      // Direct resolves often omit resolutionStatus; treat confident product hits as resolved.
      return r.resolutionStatus === "resolved" || !r.lowConfidence;
    case "unresolved":
      return false;
    default: {
      const _exhaustive: never = r.resolvedBy;
      return _exhaustive;
    }
  }
}

function applyClassInfo(primary: BasketCandidate, info: { l1: string; l2: string | null; l3: string | null; variant: string | null; brand: string | null }): void {
  primary.classL1 = info.l1;
  primary.classL2 = info.l2;
  primary.classL3 = info.l3;
  primary.variant = info.variant;
  primary.brandExtracted = info.brand;
  if (!primary.productClass) primary.productClass = info.l1;
}

/**
 * Broaden resolved commodity lines to the SKUs the in-scope stores actually
 * carry. Loose produce/deli goods fragment into a per-chain product id (no shared
 * barcode), so the in-memory shortlist sees only a few, leaving most chains
 * showing not_carried_by_chain even though they stock the item. This runs one
 * class-scoped query per resolved, CLASSIFIED line (free-text query, confirmed
 * product_id, or gtin) against the in-scope stores and attaches the carried
 * same-class SKUs as equivalents. Purely additive; only touches lines whose
 * primary has (or can load) an LLM class (migration 017). For product_id-only
 * lines, peer filtering uses the primary product name when no query is present.
 */
export async function enrichCommodityCoverage(
  items: BasketItemInput[],
  resolved: ResolvedItem[],
  storeIds: string[],
): Promise<void> {
  if (storeIds.length === 0) return;
  const targets = resolved.filter((r) => isCoverageTarget(r, items));
  if (targets.length === 0) return;

  // Batch-load classes for primaries that arrived without classL1 (common on
  // product_id / gtin paths when resolve didn't stamp, or stale candidates).
  const missingClassIds = [
    ...new Set(
      targets.flatMap((item) => {
        const primary = item.candidates.find((c) => c.productId === item.productId);
        return primary && !primary.classL1 && item.productId ? [item.productId] : [];
      }),
    ),
  ];
  const classMap =
    missingClassIds.length > 0 ? await loadProductClasses(missingClassIds) : new Map();

  await mapPool(targets, COVERAGE_CONCURRENCY, async (item) => {
    const primary = item.candidates.find((c) => c.productId === item.productId);
    if (!primary) return;

    if (!primary.classL1) {
      const info = item.productId ? classMap.get(item.productId) : undefined;
      if (!info?.l1) return;
      applyClassInfo(primary, info);
    }

    const input = items[item.index];
    const hasFreeTextQuery = Boolean(input?.query?.trim());
    const queryText = coverageQueryText(input, primary);

    const rows = await fetchCarriedClassPeers(primary, storeIds);
    // product_id/gtin-only: class+variant+unit gate peers; do not require every
    // token of the primary's branded name to appear on other chains' SKUs.
    const peers = filterClassPeers(queryText, primary, rows, {
      requireQueryTokens: hasFreeTextQuery,
    });
    if (peers.length === 0) return;

    const existing = new Map<string, BasketCandidate>();
    const push = (c: BasketCandidate) => {
      if (!existing.has(c.productId)) existing.set(c.productId, c);
    };
    push(primary);
    for (const c of item.equivalents ?? []) push(c);
    for (const row of peers) {
      push({
        productId: row.product_id,
        name: row.name,
        score: primary.score, // inherit so priceStoreBasket's worse-match guard keeps them
        matchedVia: "product",
        sizeQty: row.size_qty,
        sizeUnit: row.size_unit,
        hasPrice: true,
        hasLocalPrice: true,
        productClass: primary.productClass,
        classL1: primary.classL1,
        classL2: primary.classL2,
        classL3: primary.classL3,
        variant: primary.variant,
        brandExtracted: primary.brandExtracted,
        intentTier: primary.intentTier,
      });
    }
    item.equivalents = [...existing.values()];
  });
}
