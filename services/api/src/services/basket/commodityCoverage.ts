import { query } from "@super-mcp/db";
import { mapPool, normalizeEmbedInput, normalizeMeasure, tokenizeNormalized } from "@super-mcp/shared";
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
 * commodity CLASS (matched at the primary's deepest known level: L3 else L2 else
 * L1) AND still contain every query token — class rules out cross-category drift
 * (allspice for pepper, canned/pickled for fresh, lime for lemon), the query
 * tokens rule out brand/variety drift within a class (עלית צ'יקו for טסטרס צ'ויס).
 * Only classified products qualify, so unknown-class noise is excluded by design.
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

// Size / packaging / grade / freshness words that don't change WHAT the product
// is. A peer may add only these to the primary's name; a new CONTENT token means a
// different variety within the same class (עגבניות->עגבניות שרי cherry,
// קוקה קולה->זירו, פלפל אדום->פאלרמו, בצל->גבישי בצל granules) and is excluded.
const NEUTRAL_TOKENS: ReadonlySet<string> = new Set([
  "ארוז", "ארוזה", "ארוזים", "ארוזות", "שקית", "מארז", "אריזה", "קופסה", "קופסא",
  "בקבוק", "פחית", "מגש", "חבילה", "יחידה", "יח", "במשקל", "תפזורת", "משקל",
  "גרם", "גר", "קג", "קילו", "קילוגרם", "ליטר", "מל", "ק", "ג",
  "טרי", "טרייה", "טריה", "שטוף", "שטופה", "שטופים", "שטופות", "קלוף", "קלופה", "קלופים", "נקי",
  // Kosher marks are ubiquitous and not a price tier; organic/premium ARE a
  // pricier variety and must NOT be treated as neutral (else cheapest-per-store
  // is forced onto an organic SKU when a regular one exists elsewhere).
  "מהדרין", "כשר", "בדץ",
  "של", "עם", "ה",
]);

function contentTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenizeNormalized(normalizeEmbedInput(name))) {
    if (NEUTRAL_TOKENS.has(t)) continue;
    if (/^\d+([.,]\d+)?$/.test(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * Keep class peers that are the SAME product as the primary, only differing in
 * size/packaging. Guards: every query token present (relevance), unit agrees, and
 * the peer adds no content word beyond the primary's name (the brand/variety guard
 * that stops cheapest-per-store from picking cherry tomatoes / Coke Zero / onion
 * granules under a generic line). Anchored on the primary's name, not the query,
 * so a specific primary (פלפל אדום) still gathers its per-chain twins.
 */
export function filterClassPeers(
  queryText: string,
  primary: BasketCandidate,
  rows: CarriedProductRow[],
): CarriedProductRow[] {
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return [];
  const primaryContent = contentTokens(primary.name);
  const primaryMeasure = primary.sizeUnit ? normalizeMeasure(1, primary.sizeUnit) : null;
  const primaryCanonUnit =
    primaryMeasure && !primaryMeasure.unparseable ? primaryMeasure.unit : null;
  const seen = new Set<string>();
  const out: CarriedProductRow[] = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    const nameTokens = new Set(tokenizeNormalized(normalizeEmbedInput(row.name)));
    if (!queryTokens.every((t) => nameTokens.has(t))) continue;
    // No new content word beyond the primary: peer content ⊆ primary content.
    let extraContent = false;
    for (const t of contentTokens(row.name)) {
      if (!primaryContent.has(t)) {
        extraContent = true;
        break;
      }
    }
    if (extraContent) continue;
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

/**
 * Broaden auto-resolved commodity lines to the SKUs the in-scope stores actually
 * carry. Loose produce/deli goods fragment into a per-chain product id (no shared
 * barcode), so the in-memory shortlist sees only a few, leaving most chains
 * showing not_carried_by_chain even though they stock the item. This runs one
 * class-scoped query per resolved, CLASSIFIED, free-text line against the in-scope
 * stores and attaches the carried same-class SKUs as equivalents. Purely additive;
 * only touches resolved query lines whose primary has an LLM class (migration 017).
 */
export async function enrichCommodityCoverage(
  items: BasketItemInput[],
  resolved: ResolvedItem[],
  storeIds: string[],
): Promise<void> {
  if (storeIds.length === 0) return;
  const targets = resolved.filter(
    (r) =>
      r.resolvedBy === "query" &&
      r.resolutionStatus === "resolved" &&
      r.productId != null &&
      Boolean(items[r.index]?.query),
  );
  if (targets.length === 0) return;

  await mapPool(targets, COVERAGE_CONCURRENCY, async (item) => {
    const primary = item.candidates.find((c) => c.productId === item.productId);
    // Only class-gated broadening; an unclassified primary keeps today's behavior.
    if (!primary?.classL1) return;
    const queryText = items[item.index]!.query!;

    const rows = await fetchCarriedClassPeers(primary, storeIds);
    const peers = filterClassPeers(queryText, primary, rows);
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
        intentTier: primary.intentTier,
      });
    }
    item.equivalents = [...existing.values()];
  });
}
