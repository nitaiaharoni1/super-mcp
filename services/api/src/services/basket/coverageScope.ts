import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";
import type { BasketCandidate } from "./types.js";

/**
 * How deeply taxonomy must constrain commodity peers for this query.
 * `l3` = deepest leaf (default). `l2` = family only (e.g. bare יין → all wines).
 */
export type CoverageClassDepth = "l1" | "l2" | "l3";

export interface CoverageClassScope {
  classL1: string;
  classL2: string | null;
  classL3: string | null;
  depth: CoverageClassDepth;
}

/** Hebrew tokens that pin a wine leaf (color / style). */
const WINE_LEAF_QUERY_TOKENS: ReadonlySet<string> = new Set([
  "אדום",
  "אדומה",
  "לבן",
  "לבנה",
  "רוזה",
  "ורוד",
  "ורודה",
  "מבעבע",
  "מבעבעת",
  "שמפניה",
  "קאווה",
  "פרוסקו",
  "ריזלינג",
  "קברנה",
  "מרלו",
  "שרדונה",
  "פינו",
  "סירה",
  "שיראז",
  "גוורצטרמינר",
]);

/**
 * Decide the taxonomy scope justified by the user's query — not solely by the
 * representative SKU's deepest leaf. Bare `יין` uses the wine family (L2);
 * `יין אדום` / varietal tokens keep L3.
 */
export function resolveCoverageClassScope(
  queryText: string,
  primary: Pick<BasketCandidate, "classL1" | "classL2" | "classL3">,
): CoverageClassScope | null {
  if (!primary.classL1) return null;
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  const depth = coverageDepthForQuery(tokens, primary);
  return {
    classL1: primary.classL1,
    classL2: depth === "l1" ? null : (primary.classL2 ?? null),
    classL3: depth === "l3" ? (primary.classL3 ?? null) : null,
    depth,
  };
}

function coverageDepthForQuery(
  tokens: string[],
  primary: Pick<BasketCandidate, "classL2" | "classL3">,
): CoverageClassDepth {
  if (!primary.classL2) return "l1";
  if (!primary.classL3) return "l2";

  // Bare wine category: shopper did not pin color/style → any wine family member.
  if (primary.classL2 === "wine" && isBareWineFamilyQuery(tokens)) {
    return "l2";
  }

  return "l3";
}

function isBareWineFamilyQuery(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  // Must include the wine head and no leaf/varietal pin.
  if (!tokens.includes("יין")) return false;
  return !tokens.some((t) => WINE_LEAF_QUERY_TOKENS.has(t));
}

/**
 * Whether two class paths conflict under a query-aware scope. When depth is L2,
 * differing L3 leaves under the same L2 (red vs white wine) are interchangeable.
 */
export function scopedClassesConflict(
  a: Pick<BasketCandidate, "classL1" | "classL2" | "classL3">,
  b: Pick<BasketCandidate, "classL1" | "classL2" | "classL3">,
  scope: CoverageClassScope,
): boolean {
  if (!a.classL1 || !b.classL1) return false;
  if (a.classL1 !== b.classL1) return true;
  if (scope.depth === "l1") return false;
  if (scope.classL2) {
    if (a.classL2 && b.classL2 && a.classL2 !== b.classL2) return true;
  }
  if (scope.depth === "l2") return false;
  if (scope.classL3) {
    if (a.classL3 && b.classL3 && a.classL3 !== b.classL3) return true;
  }
  return false;
}
