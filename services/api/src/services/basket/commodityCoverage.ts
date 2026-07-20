import { query } from "@super-mcp/db";
import {
  mapPool,
  normalizeEmbedInput,
  packSizesCompatible,
  queryTokensSatisfied,
  tokenizeNormalized,
} from "@super-mcp/shared";
import { queryHeadAnchored } from "./equivalence.js";
import { buildBasketIntentProfile } from "./intentProfile.js";
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
  piece_count: number | null;
  /** Chain that carries a priced listing — used to diversify the capped peer set. */
  chain_id?: string | null;
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
  // Cap per chain first so large classes (produce/bakery) don't fill a global
  // LIMIT with one chain's SKUs before diversifyByChain can help.
  const res = await query<CarriedProductRow>(
    `WITH priced AS (
       SELECT DISTINCT ON (l.product_id) l.product_id, p.name, p.size_qty, p.size_unit,
              p.piece_count, l.chain_id, sp.price
         FROM product p
         JOIN product_class_map m ON m.product_id = p.id AND m.input_name = p.name
         JOIN listing l ON l.product_id = p.id
         JOIN store_price sp ON sp.listing_id = l.id AND sp.price > 0
        WHERE sp.store_id = ANY($1::uuid[]) AND ${conds.join(" AND ")}
        ORDER BY l.product_id, sp.price ASC
     ),
     ranked AS (
       SELECT product_id, name, size_qty, size_unit, piece_count, chain_id,
              row_number() OVER (PARTITION BY chain_id ORDER BY price ASC, product_id) AS rn
         FROM priced
     )
     SELECT product_id, name, size_qty, size_unit, piece_count, chain_id
       FROM ranked
      WHERE rn <= 40
      LIMIT 400`,
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
    (primary.classL1 === "produce" || primary.classL2 === "pita_flatbread");
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
  // others of equivalents (false not_carried_by_chain).
  return diversifyByChain(compatible, MAX_COVERAGE_EQUIVALENTS);
}

/** Round-robin across chains, then fill remaining slots in original order. */
function diversifyByChain(rows: CarriedProductRow[], max: number): CarriedProductRow[] {
  if (rows.length <= max) return rows;
  const byChain = new Map<string, CarriedProductRow[]>();
  const noChain: CarriedProductRow[] = [];
  for (const row of rows) {
    const key = row.chain_id?.trim();
    if (!key) {
      noChain.push(row);
      continue;
    }
    const list = byChain.get(key) ?? [];
    list.push(row);
    byChain.set(key, list);
  }
  const out: CarriedProductRow[] = [];
  const queues = [...byChain.values()];
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (const q of queues) {
      if (out.length >= max) break;
      const next = q.shift();
      if (next) {
        out.push(next);
        progressed = true;
      }
    }
  }
  for (const row of noChain) {
    if (out.length >= max) break;
    out.push(row);
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
 * Broaden resolved commodity lines to the SKUs the in-scope stores actually
 * carry. Loose produce/deli goods fragment into a per-chain product id (no shared
 * barcode), so the in-memory shortlist sees only a few, leaving most chains
 * showing not_carried_by_chain even though they stock the item.
 *
 * Peer broadening runs only for commodity intent. Exact intent (product_id /
 * gtin without query, brand/variant pins, or pin confirmation answers) keeps
 * the confirmed SKU identity — fetching class peers would swap Taster's Choice
 * for Turkish coffee or Coke Zero for regular Coke. Those lines still get class
 * metadata stamped when missing; any equivalents already attached earlier in
 * resolution are left untouched.
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
    const intent = buildBasketIntentProfile(input, primary);
    // Exact intent must not broaden to class peers (Turkish coffee ≠ Taster's
    // Choice; Coke Zero ≠ regular Coke). Keep primary and any equivalents that
    // already passed query gates.
    if (intent.mode === "exact") return;

    const queryText = intent.queryText || coverageQueryText(input, primary);

    const rows = await fetchCarriedClassPeers(primary, storeIds);
    // Commodity intent: require query tokens so specificity holds (אבטיח≠מלון
    // even when both are misclassified under the same L3).
    const peers = filterClassPeers(queryText, primary, rows, {
      requireQueryTokens: true,
      allowCountToWeight: intent.allowCountToWeight,
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
        pieceCount: row.piece_count,
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
