import { query } from "@super-mcp/db";
import {
  mapPool,
  normalizeEmbedInput,
  packSizesCompatible,
  queryTokensSatisfied,
  tokenizeNormalized,
} from "@super-mcp/shared";
import { allowsCountToWeight } from "./countWeightPolicy.js";
import { resolveCoverageClassScope, type CoverageClassScope } from "./coverageScope.js";
import { diversifyByChain } from "./diversifyByChain.js";
import { queryHeadAnchored } from "./equivalence.js";
import { buildBasketIntentProfile } from "./intentProfile.js";
import { brandMatches, riskTokens } from "./lineRisk.js";
import { packageFormsCompatible } from "./packageForm.js";
import { loadProductClasses } from "./productClasses.js";
import type { BasketCandidate, BasketItemInput, ResolvedItem } from "./types.js";

// Re-export extracted helpers so existing test/import paths stay stable.
export { diversifyByChain } from "./diversifyByChain.js";
export {
  packageFormKind,
  packageFormsCompatible,
  type PackageFormKind,
} from "./packageForm.js";

/** Bounded concurrency for the per-line coverage queries (DB-heavy). */
const COVERAGE_CONCURRENCY = 6;
/** Max interchangeable SKUs to attach per line (enough to span every local chain). */
const MAX_COVERAGE_EQUIVALENTS = 20;

interface CarriedProductRow {
  product_id: string;
  name: string;
  size_qty: number | null;
  size_unit: string | null;
  piece_count: number | null;
  /** Chain that carries a priced listing — used to diversify the capped peer set. */
  chain_id?: string | null;
  /** Cheapest in-scope store price for this product — used to retain store minima. */
  min_price?: number | string | null;
  /** Catalog brand_extracted for brand-family equality checks. */
  brand_extracted?: string | null;
}

export interface BrandFamilyPeerSets {
  /** Same brand + form + packSizesCompatible — may auto-price. */
  auto: CarriedProductRow[];
  /** Same brand + form but incompatible pack size (e.g. 200g vs 95g) — alternatives only. */
  alternatives: CarriedProductRow[];
}

/**
 * Products actually priced in the in-scope stores that share the query-aware
 * commodity CLASS scope AND the primary's VARIANT. Scope depth comes from the
 * user query (bare יין → wine family; יין אדום → red_wine leaf), not solely from
 * the representative SKU's deepest leaf.
 */
async function fetchCarriedClassPeers(
  primary: BasketCandidate,
  storeIds: string[],
  scope: CoverageClassScope,
): Promise<CarriedProductRow[]> {
  const conds: string[] = ["m.class_l1 = $2"];
  const params: unknown[] = [storeIds, scope.classL1];
  if (scope.classL2) {
    conds.push(`m.class_l2 = $${params.length + 1}`);
    params.push(scope.classL2);
  }
  if (scope.classL3) {
    conds.push(`m.class_l3 = $${params.length + 1}`);
    params.push(scope.classL3);
  }
  // EXACT variant match (default a stale/unknown primary to regular). A NULL peer
  // variant is NOT a wildcard: a stale row (classified before the variant pass)
  // whose name implies שרי/דיאט/אורגני would otherwise group into a generic line.
  conds.push(`m.variant = $${params.length + 1}`);
  params.push(primary.variant ?? "regular");
  // Cap per chain first so large classes (produce/bakery) don't fill a global
  // LIMIT with one chain's SKUs before diversifyByChain can help.
  const res = await query<CarriedProductRow>(
    `WITH priced AS (
       SELECT DISTINCT ON (l.product_id) l.product_id, p.name, p.size_qty, p.size_unit,
              p.piece_count, l.chain_id, sp.price, m.brand_extracted
         FROM product p
         JOIN product_class_map m ON m.product_id = p.id AND m.input_name = p.name
         JOIN listing l ON l.product_id = p.id
         JOIN store_price sp ON sp.listing_id = l.id AND sp.price > 0
        WHERE sp.store_id = ANY($1::uuid[]) AND ${conds.join(" AND ")}
        ORDER BY l.product_id, sp.price ASC
     ),
     ranked AS (
       SELECT product_id, name, size_qty, size_unit, piece_count, chain_id, price AS min_price,
              brand_extracted,
              row_number() OVER (PARTITION BY chain_id ORDER BY price ASC, product_id) AS rn
         FROM priced
     )
     SELECT product_id, name, size_qty, size_unit, piece_count, chain_id, min_price, brand_extracted
       FROM ranked
      WHERE rn <= 40
      LIMIT 400`,
    params,
  );
  return res.rows;
}

/** Same brand via catalog brand_extracted, or all brand tokens present in the peer name. */
function sameBrandFamily(primaryBrand: string, row: CarriedProductRow): boolean {
  const rowBrand = row.brand_extracted?.trim() || null;
  if (brandMatches(primaryBrand, rowBrand)) return true;
  if (rowBrand) return false;
  const brandToks = riskTokens(primaryBrand);
  if (brandToks.length === 0) return false;
  const nameToks = new Set(riskTokens(row.name));
  return brandToks.every((t) => nameToks.has(t));
}

/**
 * Same-brand, same-form peers for brand_family intent. Auto peers must also pass
 * packSizesCompatible; larger/incompatible packs become alternatives (not priced
 * coverage). Other brands, decaf/variant mismatches (SQL), and form mismatches
 * are dropped entirely.
 */
export function classifyBrandFamilyPeers(
  queryText: string,
  primary: BasketCandidate,
  rows: CarriedProductRow[],
  opts: { allowCountToWeight?: boolean } = {},
): BrandFamilyPeerSets {
  const brand = primary.brandExtracted?.trim() || null;
  if (!brand) return { auto: [], alternatives: [] };

  const allowCountToWeight = opts.allowCountToWeight ?? false;
  const requireQueryTokens = Boolean(queryText.trim());
  const queryTokenList = tokenizeNormalized(normalizeEmbedInput(queryText));
  const seen = new Set<string>();
  const auto: CarriedProductRow[] = [];
  const alternatives: CarriedProductRow[] = [];

  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    if (row.product_id === primary.productId) continue;
    if (!sameBrandFamily(brand, row)) continue;

    if (requireQueryTokens && queryTokenList.length > 0) {
      if (!queryTokensSatisfied(queryTokenList, row.name)) continue;
      if (!queryHeadAnchored(queryText, row.name)) continue;
    }

    if (
      !packageFormsCompatible(
        { name: primary.name, pieceCount: primary.pieceCount },
        { name: row.name, pieceCount: row.piece_count },
      )
    ) {
      continue;
    }

    seen.add(row.product_id);
    const packOk = packSizesCompatible(
      { sizeQty: primary.sizeQty, sizeUnit: primary.sizeUnit, name: primary.name },
      { sizeQty: row.size_qty, sizeUnit: row.size_unit, name: row.name },
      { allowCountToWeight },
    ).compatible;
    if (packOk) auto.push(row);
    else alternatives.push(row);
  }

  return {
    auto: diversifyByChain(auto, MAX_COVERAGE_EQUIVALENTS),
    alternatives: diversifyByChain(alternatives, MAX_COVERAGE_EQUIVALENTS),
  };
}

function candidateFromPeerRow(
  row: CarriedProductRow,
  primary: BasketCandidate,
  scope: CoverageClassScope,
): BasketCandidate {
  return {
    productId: row.product_id,
    name: row.name,
    score: primary.score,
    matchedVia: "product",
    sizeQty: row.size_qty,
    sizeUnit: row.size_unit,
    pieceCount: row.piece_count,
    hasPrice: true,
    hasLocalPrice: true,
    productClass: primary.productClass,
    classL1: scope.classL1,
    classL2: scope.classL2 ?? primary.classL2,
    classL3: scope.classL3 ?? null,
    variant: primary.variant,
    brandExtracted: row.brand_extracted ?? primary.brandExtracted,
    intentTier: primary.intentTier,
  };
}

function mergeCoverageEquivalents(
  primary: BasketCandidate,
  existing: BasketCandidate[] | undefined,
  peerRows: CarriedProductRow[],
  scope: CoverageClassScope,
): BasketCandidate[] {
  const byId = new Map<string, BasketCandidate>();
  const push = (c: BasketCandidate) => {
    if (!byId.has(c.productId)) byId.set(c.productId, c);
  };
  push(primary);
  for (const c of existing ?? []) push(c);
  for (const row of peerRows) push(candidateFromPeerRow(row, primary, scope));
  return [...byId.values()];
}

export interface FilterClassPeersOptions {
  /**
   * When false, skip query-token matching (class+variant SQL + unit still apply).
   * Used for product_id/gtin-only lines where queryText is the primary product
   * name — brand/chain tokens like "שופרסל" must not block other chains' peers.
   */
  requireQueryTokens?: boolean;
  /** Override produce/bakery count↔weight policy from intent profile. */
  allowCountToWeight?: boolean;
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
  const allowCountToWeight =
    opts.allowCountToWeight ??
    allowsCountToWeight({
      classL1: primary.classL1,
      classL2: primary.classL2,
      productClass: primary.productClass,
    });
  const seen = new Set<string>();
  const compatible: CarriedProductRow[] = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    if (requireQueryTokens && !queryTokensSatisfied(queryTokens, row.name)) continue;
    // Drop prepared-food hosts that share a produce token (עוגת לימונים).
    if (requireQueryTokens && !queryHeadAnchored(queryText, row.name)) continue;
    if (
      !packSizesCompatible(
        { sizeQty: primary.sizeQty, sizeUnit: primary.sizeUnit, name: primary.name },
        { sizeQty: row.size_qty, sizeUnit: row.size_unit, name: row.name },
        { allowCountToWeight },
      ).compatible
    ) {
      continue;
    }
    seen.add(row.product_id);
    compatible.push(row);
  }
  // Cap peers but prefer chain diversity so one chain's SKU flood doesn't starve
  // others of equivalents (false not_carried_by_chain). Always retain the
  // globally cheapest compatible peer so a soft cap cannot hide the store minimum.
  return diversifyByChain(compatible, MAX_COVERAGE_EQUIVALENTS);
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
 * Lines eligible for class stamping + (when free-text query is present) peer
 * broadening. product_id/gtin lines without a query are still targets so we can
 * load/stamp class metadata, but enrichCommodityCoverage skips peer fetch for
 * them — a confirmed branded SKU must not be swapped for class peers.
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
 * Broaden resolved lines for commodity or brand_family intent to SKUs the
 * in-scope stores actually carry.
 *
 * - commodity: cheapest same-class safe peer (produce / bare wine, etc.)
 * - brand_family: same-brand compatible packs as auto equivalents; larger packs
 *   as alternatives (not priced coverage)
 * - exact: keep confirmed SKU identity (product_id / GTIN / pin / variant)
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

    const input = items[item.index];
    if (!primary.classL1) {
      const info = item.productId ? classMap.get(item.productId) : undefined;
      if (!info?.l1) {
        // Still stamp intent so pricing knows commodity vs exact without class.
        item.intentMode = buildBasketIntentProfile(input, primary).mode;
        return;
      }
      applyClassInfo(primary, info);
    }

    // Stamp intent once after optional class/variant stamp so pricing knows
    // commodity vs exact (variant may force exact).
    const intent = buildBasketIntentProfile(input, primary);
    item.intentMode = intent.mode;
    // Exact intent must not broaden to class peers (Turkish coffee ≠ Taster's
    // Choice; Coke Zero ≠ regular Coke). Keep primary and any equivalents that
    // already passed query gates.
    if (intent.mode === "exact") return;

    const queryText = intent.queryText || coverageQueryText(input, primary);
    const scope = resolveCoverageClassScope(queryText, primary);
    if (!scope) return;

    const rows = await fetchCarriedClassPeers(primary, storeIds, scope);

    if (intent.mode === "brand_family") {
      const { auto, alternatives } = classifyBrandFamilyPeers(queryText, primary, rows, {
        allowCountToWeight: intent.allowCountToWeight,
      });
      item.equivalents = mergeCoverageEquivalents(primary, item.equivalents, auto, scope);
      if (alternatives.length > 0) {
        item.alternatives = alternatives.map((row) => candidateFromPeerRow(row, primary, scope));
      }
      return;
    }

    // Commodity intent: require query tokens so specificity holds (אבטיח≠מלון
    // even when both are misclassified under the same L3).
    const peers = filterClassPeers(queryText, primary, rows, {
      requireQueryTokens: true,
      allowCountToWeight: intent.allowCountToWeight,
    });
    if (peers.length === 0) return;

    item.equivalents = mergeCoverageEquivalents(primary, item.equivalents, peers, scope);
  });
}
