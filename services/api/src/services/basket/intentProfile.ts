import { normalizeMeasure, type CanonicalUnit } from "@super-mcp/shared";
import { allowsCountToWeight } from "./countWeightPolicy.js";
import { classifyLineRisk, isBrandFamilyPin, type RiskCandidate } from "./lineRisk.js";
import type { BasketCandidate, BasketItemInput, BasketPricingIntent } from "./types.js";

/**
 * Request-time intent for equivalence / coverage. Derived from the user's line
 * (query + amount/unit), not from accidental attributes of the selected primary
 * SKU (brand, pack label, feed unit string).
 */
export interface BasketIntentProfile {
  mode: BasketPricingIntent;
  /** Free-text query when present; otherwise primary name for product_id lines. */
  queryText: string;
  /** True when the caller supplied a free-text query (token specificity applies). */
  hasFreeTextQuery: boolean;
  /** Canonical unit of the requested amount, if parseable. */
  requestedCanonUnit: CanonicalUnit | null;
  /**
   * Allow unit/count peers against weighted g/ml SKUs. True for produce (₪/kg),
   * bakery count staples (pita packs labeled as grams), and wine bottles asked
   * by count (`יח`) against catalog ml volumes. Pricing already converts via
   * resolvePurchaseQty / name-inferred piece counts.
   */
  allowCountToWeight: boolean;
}

function toRiskCandidate(primary: BasketCandidate): RiskCandidate {
  return {
    productClass: primary.productClass,
    // Do not feed brandExtracted into generic risk here — bare commodity nouns
    // can equal brand_extracted ("קולה"). Brand-family is detected separately
    // via isBrandFamilyPin against the primary's brand metadata.
    brand: null,
    intentTier: primary.intentTier ?? null,
    classL1: primary.classL1 ?? null,
  };
}

function resolveIntentMode(
  item: BasketItemInput | undefined,
  primary: BasketCandidate,
  queryText: string,
  hasFreeTextQuery: boolean,
): BasketPricingIntent {
  if (
    item?.intentModeOverride === "exact" ||
    item?.intentModeOverride === "brand_family" ||
    item?.intentModeOverride === "commodity"
  ) {
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
    // Named brand + product family (Taster's Choice) → brand_family scope.
    // Bare commodity nouns that coincide with brand_extracted stay commodity.
    if (isBrandFamilyPin(queryText, primary.brandExtracted ?? null)) {
      return "brand_family";
    }

    const risk = classifyLineRisk(queryText, [toRiskCandidate(primary)]);
    switch (risk.kind) {
      case "commodity":
        return "commodity";
      case "brand_pinned":
        // Should not fire with brand:null, but keep brand_family if it does.
        return "brand_family";
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
    allowCountToWeight: allowsCountToWeight({
      classL1: primary.classL1,
      classL2: primary.classL2,
      productClass: primary.productClass,
      constrainWineByRequestUnit: true,
      requestedCanonUnit,
    }),
  };
}
