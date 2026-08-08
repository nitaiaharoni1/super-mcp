import { query } from "@super-mcp/db";
import {
  mapPool,
  normalizeEmbedInput,
  effectiveVariant,
  packSizesCompatible,
  queryTokensSatisfied,
  tokenizeNormalized,
} from "@super-mcp/shared";
import { rejectUnsafeChickenName } from "./chickenSafety.js";
import { rejectUnsafePlainMilkName } from "./milkSafety.js";
import { rejectUnsafePlainYogurtName } from "./yogurtSafety.js";
import { allowsCountToWeight } from "./countWeightPolicy.js";
import { resolveCoverageClassScope, type CoverageClassScope } from "./coverageScope.js";
import { diversifyByChain, selectCoveringPeers } from "./diversifyByChain.js";
import {
  DEFAULT_PACK_TOLERANCE,
  hasUnrequestedAddedIngredient,
  hasUnrequestedPreservedForm,
  pieceCountsConflict,
  queryHeadAnchored,
} from "./equivalence.js";
import { hasUnrequestedDerivedForm } from "./derivedForm.js";
import { rejectPercentMismatch } from "./percentAttribute.js";
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
  /** plain | flavoured | prepared_meal | derived_ingredient (migration 025); NULL = unclassified. */
  preparation?: string | null;
  /** single | multipack (migration 025); NULL = unclassified. */
  pack_form?: string | null;
  /** In-scope stores that price this product — drives per-storefront peer coverage. */
  store_ids?: readonly string[] | null;
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
  params.push(effectiveVariant(primary.variant));
  // Same axis, one level more fundamental: a peer must share the primary's
  // PREPARATION. This is what stops a plain "אורז" line pricing rice paper or rice
  // noodles, and a plain "יוגורט" line pricing a chocolate-cornflake dessert. Only
  // applied when the primary is itself labelled; an unlabelled peer (NULL) is
  // unknown, not disqualified, so the name-based guard stays the fallback and
  // coverage never drops because classification is incomplete.
  if (primary.preparation) {
    // Same coarse grouping as preparationConflict: plain and flavoured are the same
    // food to a shopping list, so they are interchangeable peers. Only a prepared
    // dish or a derived ingredient is a different kind of thing.
    const sameKind =
      primary.preparation === "plain" || primary.preparation === "flavoured"
        ? ["plain", "flavoured"]
        : [primary.preparation];
    conds.push(
      `(m.preparation IS NULL OR m.preparation = ANY($${params.length + 1}::text[]))`,
    );
    params.push(sameKind);
  }
  // Cap per chain first so large classes (produce/bakery) don't fill a global
  // LIMIT with one chain's SKUs before the peer cap can help, and take the
  // truncation in rank order so every chain keeps its cheapest.
  //
  // WHICH in-scope storefronts price each peer is attached only to the survivors.
  // The cap downstream is a set cover over those storefronts, so the column has to
  // exist — but computing it inside `priced` (GROUP BY + array_agg over the whole
  // class join) cost 371ms where DISTINCT ON costs 6ms, and on a large class it
  // blew past the statement timeout. As a correlated lookup over ≤600 already
  // chosen products it is two index probes each: 59ms vs 36ms on produce.
  const res = await query<CarriedProductRow>(
    `WITH priced AS (
       SELECT DISTINCT ON (l.product_id) l.product_id, p.name, p.size_qty, p.size_unit,
              p.piece_count, l.chain_id, sp.price, m.brand_extracted,
              m.preparation, m.pack_form
         FROM product p
         JOIN product_class_map m ON m.product_id = p.id AND m.input_name = p.name
         JOIN listing l ON l.product_id = p.id
         JOIN store_price sp ON sp.listing_id = l.id AND sp.price > 0
        WHERE sp.store_id = ANY($1::uuid[]) AND ${conds.join(" AND ")}
        ORDER BY l.product_id, sp.price ASC
     ),
     ranked AS (
       SELECT product_id, name, size_qty, size_unit, piece_count, chain_id, price AS min_price,
              brand_extracted, preparation, pack_form,
              row_number() OVER (PARTITION BY chain_id ORDER BY price ASC, product_id) AS rn
         FROM priced
     ),
     top AS (
       SELECT * FROM ranked WHERE rn <= 40 ORDER BY rn, min_price ASC LIMIT 600
     )
     SELECT t.product_id, t.name, t.size_qty, t.size_unit, t.piece_count, t.chain_id,
            t.min_price, t.brand_extracted, t.preparation, t.pack_form,
            (SELECT array_agg(DISTINCT sp2.store_id)
               FROM listing l2
               JOIN store_price sp2 ON sp2.listing_id = l2.id AND sp2.price > 0
              WHERE l2.product_id = t.product_id
                AND sp2.store_id = ANY($1::uuid[])) AS store_ids
       FROM top t`,
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
    preparation: row.preparation ?? null,
    packForm: row.pack_form ?? null,
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
  /** In-scope storefronts. Each one keeps a peer it can price (see selectCoveringPeers). */
  storeIds?: readonly string[];
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
  const queryTokenSet = new Set(queryTokens);
  const seen = new Set<string>();
  const compatible: CarriedProductRow[] = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    if (requireQueryTokens && !queryTokensSatisfied(queryTokens, row.name)) continue;
    // Drop prepared-food hosts that share a produce token (עוגת לימונים).
    if (requireQueryTokens && !queryHeadAnchored(queryText, row.name)) continue;
    if (rejectUnsafeChickenName(queryText, row.name)) continue;
    if (rejectUnsafePlainMilkName(queryText, row.name)) continue;
    if (rejectUnsafePlainYogurtName(queryText, row.name, row.preparation)) continue;
    // The SAME form / percentage / pack gates the resolution path applies.
    //
    // These were missing here, so anything resolution rejected as the wrong form
    // could still be substituted at PRICING time as a "chain equivalent". That is
    // how a correctly resolved 32-roll toilet paper was billed as moist wipes:
    // resolution rejected the wipes, coverage peers let them straight back in.
    if (hasUnrequestedPreservedForm(queryTokenSet, row.name)) continue;
    if (hasUnrequestedAddedIngredient(queryText, row.name)) continue;
    if (hasUnrequestedDerivedForm(queryText, row.name)) continue;
    if (rejectPercentMismatch(queryText, row.name)) continue;
    // Pack COUNT equality: without this a 6-egg pack peers with a 12-egg request,
    // because a "1 unit" size stub makes every pack look compatible.
    if (
      pieceCountsConflict(
        {
          pieceCount: primary.pieceCount,
          sizeQty: primary.sizeQty,
          sizeUnit: primary.sizeUnit,
          name: primary.name,
        },
        {
          pieceCount: row.piece_count ?? null,
          sizeQty: row.size_qty,
          sizeUnit: row.size_unit,
          name: row.name,
        },
      )
    ) {
      continue;
    }
    if (
      !packSizesCompatible(
        { sizeQty: primary.sizeQty, sizeUnit: primary.sizeUnit, name: primary.name },
        { sizeQty: row.size_qty, sizeUnit: row.size_unit, name: row.name },
        // Must match the resolution path's tolerance. Omitting it fell back to the
        // shared default of 0.5, so the ±50% window that lets the smaller pack win
        // every line survived here even after resolution tightened to 0.15.
        { allowCountToWeight, packTolerance: DEFAULT_PACK_TOLERANCE },
      ).compatible
    ) {
      continue;
    }
    seen.add(row.product_id);
    compatible.push(row);
  }
  // Cap peers, but never below what pricing needs: one peer per in-scope
  // storefront. Chain diversity alone left storefronts with nothing to price
  // (false not_carried_by_chain); the globally cheapest compatible peer is still
  // always retained so a soft cap cannot hide the store minimum.
  return selectCoveringPeers(compatible, opts.storeIds ?? [], MAX_COVERAGE_EQUIVALENTS);
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

function applyClassInfo(
  primary: BasketCandidate,
  info: {
    l1: string;
    l2: string | null;
    l3: string | null;
    variant: string | null;
    brand: string | null;
    preparation?: string | null;
    packForm?: string | null;
  },
): void {
  primary.classL1 = info.l1;
  primary.classL2 = info.l2;
  primary.classL3 = info.l3;
  primary.variant = info.variant;
  primary.brandExtracted = info.brand;
  primary.preparation = info.preparation ?? null;
  primary.packForm = info.packForm ?? null;
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

    // Broadening a line is an IMPROVEMENT on an already-resolved basket, so it
    // fails soft. The peer query is the heaviest statement in the request and the
    // first to hit the 30s statement_timeout on a cold buffer cache; before this
    // catch, one such line rejected mapPool's Promise.all and aborted the whole
    // call, so a 12-line basket returned nothing after 72s (prod, 2026-08-05).
    // Losing this line's peers costs it coverage against chains that stock the
    // commodity under their own item code — the exact state the delivery surface
    // shipped in — which is strictly better than losing the basket.
    const rows = await fetchCarriedClassPeers(primary, storeIds, scope).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          severity: "WARNING",
          event: "coverage_peers_unavailable",
          index: item.index,
          classL1: scope.classL1,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return [] as CarriedProductRow[];
    });

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
      storeIds,
    });

    // Last-resort tier: same class, same variant, every safety gate still
    // applied, but not required to repeat the shopper's words.
    //
    // A chain names the category its own way. Rami Levy prices 157 body washes
    // as "אל סבון" and not one says "רחצה", so a "סבון רחצה" line matched their
    // class and variant exactly and was still reported not_carried_by_chain.
    // Same for its ground coffee, every unit of which is called "קפה טורקי".
    // Pricing reaches for these only when the primary and its gated equivalents
    // all failed to price at that store, so a line that already finds its
    // product is untouched.
    const loose = filterClassPeers(queryText, primary, rows, {
      requireQueryTokens: false,
      allowCountToWeight: intent.allowCountToWeight,
      storeIds,
    });
    const strictIds = new Set(peers.map((row) => row.product_id));
    const looseOnly = loose.filter((row) => !strictIds.has(row.product_id));
    if (looseOnly.length > 0) {
      item.looseEquivalents = looseOnly.map((row) => candidateFromPeerRow(row, primary, scope));
    }

    if (peers.length === 0) return;

    item.equivalents = mergeCoverageEquivalents(primary, item.equivalents, peers, scope);
  });
}
