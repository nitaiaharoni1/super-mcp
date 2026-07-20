import { normalizeMeasure, type CanonicalUnit } from "@super-mcp/shared";
import { classifyLineRisk, type RiskCandidate } from "./lineRisk.js";
import type { BasketCandidate, BasketIntentMode, BasketItemInput } from "./types.js";

/**
 * Request-time intent for equivalence / coverage. Derived from the user's line
 * (query + amount/unit), not from accidental attributes of the selected primary
 * SKU (brand, pack label, feed unit string).
 */
export interface BasketIntentProfile {
  mode: Extract<BasketIntentMode, "exact" | "commodity">;
  /** Free-text query when present; otherwise primary name for product_id lines. */
  queryText: string;
  /** True when the caller supplied a free-text query (token specificity applies). */
  hasFreeTextQuery: boolean;
  /** Canonical unit of the requested amount, if parseable. */
  requestedCanonUnit: CanonicalUnit | null;
  /**
   * Allow unit/count peers against weighted g/ml SKUs. True for produce (₪/kg)
   * and bakery count staples (pita packs labeled as grams). Pricing already
   * converts via resolvePurchaseQty / name-inferred piece counts.
   */
  allowCountToWeight: boolean;
}

/** Classes where a count request / unit primary may match a weighted shelf SKU. */
function classAllowsCountToWeight(primary: BasketCandidate): boolean {
  const l1 = primary.classL1 ?? primary.productClass;
  // Loose produce (₪/kg). Flatbread multipacks often labeled as grams — not all bakery/bread.
  return l1 === "produce" || primary.classL2 === "pita_flatbread";
}

function toRiskCandidate(primary: BasketCandidate): RiskCandidate {
  return {
    productClass: primary.productClass,
    brand: primary.brandExtracted ?? null,
    intentTier: primary.intentTier ?? null,
    classL1: primary.classL1 ?? null,
  };
}

function resolveIntentMode(
  item: BasketItemInput | undefined,
  primary: BasketCandidate,
  queryText: string,
  hasFreeTextQuery: boolean,
): Extract<BasketIntentMode, "exact" | "commodity"> {
  if (item?.intentModeOverride === "exact" || item?.intentModeOverride === "commodity") {
    return item.intentModeOverride;
  }

  // Confirmed SKU identity without free text pins the exact product.
  if ((item?.productId || item?.gtin) && !hasFreeTextQuery) {
    return "exact";
  }

  // Non-regular variant primaries (diet_zero / organic / …) must not broaden.
  if (primary.variant && primary.variant !== "regular") {
    return "exact";
  }

  if (hasFreeTextQuery) {
    const risk = classifyLineRisk(queryText, [toRiskCandidate(primary)]);
    switch (risk.kind) {
      case "commodity":
        return "commodity";
      case "brand_pinned":
      case "cross_class":
      case "opaque":
        return "exact";
      default: {
        const exhaustive: never = risk;
        return exhaustive;
      }
    }
  }

  return "exact";
}

/** Build intent from the basket line + classified primary candidate. */
export function buildBasketIntentProfile(
  item: BasketItemInput | undefined,
  primary: BasketCandidate,
): BasketIntentProfile {
  const hasFreeTextQuery = Boolean(item?.query?.trim());
  const queryText = (item?.query?.trim() || primary.name || "").trim();

  let requestedCanonUnit: CanonicalUnit | null = null;
  if (item?.amount != null && item.unit) {
    const m = normalizeMeasure(item.amount, item.unit);
    if (!m.unparseable) requestedCanonUnit = m.unit;
  }

  return {
    mode: resolveIntentMode(item, primary, queryText, hasFreeTextQuery),
    queryText,
    hasFreeTextQuery,
    requestedCanonUnit,
    allowCountToWeight: classAllowsCountToWeight(primary),
  };
}
