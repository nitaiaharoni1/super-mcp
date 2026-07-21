import type { Freshness } from "../products/types.js";
import type { SearchProductHit } from "../search/types.js";
import type { GeoPoint } from "../../lib/geo.js";
import type { StoreLocationMetadata } from "../../lib/resolveStoreLocation.js";

/**
 * How a confirmation answer should resume pricing identity:
 * - representative → commodity (cheapest safe peer)
 * - brand_family → same brand + family + compatible pack peers
 * - pin → exact SKU (hard GTIN/product identity)
 */
export type BasketSelectionEffect = "representative" | "brand_family" | "pin";

/**
 * Request-time identity scope for pricing / coverage:
 * - exact — hard SKU (GTIN / product_id / size+variant pin)
 * - brand_family — same brand + family + compatible packs; larger packs as alternatives
 * - commodity — cheapest same-class safe peer
 */
export type BasketPricingIntent = "exact" | "brand_family" | "commodity";
export type BasketIntentMode = BasketPricingIntent | "needs_confirmation" | "unresolved";

export interface BasketItemInput {
  productId?: string;
  gtin?: string;
  query?: string;
  /** Pack/shelf count requested (mapped from boundary `pack_qty`). */
  packQty?: number;
  /** Physical amount requested (e.g. 1.5 with unit=kg). */
  amount?: number;
  /** Unit for amount: kg, g, L, ml, unit, יח, etc. */
  unit?: string;
  /** Internal only; never accepted from the public initial schema. */
  intentModeOverride?: BasketPricingIntent;
}

/** Provenance of a resolved user origin (never includes raw location text). */
export interface BasketLocationOrigin {
  precision: "address" | "street" | "neighborhood" | "city" | "coordinates";
  provider: "nominatim" | "city_centroid" | "coordinates";
  cached: boolean;
  fallbackApplied: boolean;
  displayName: string | null;
  attribution: string | null;
  warning: string | null;
}

export interface BasketLocationInput {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  /**
   * Set by the boundary adapter after resolving `location` / `near`.
   * Frozen into the signed continuation so resume never re-geocodes.
   */
  locationOrigin?: BasketLocationOrigin;
}

export type BasketResolutionMode = "fast" | "strict";
export type BasketResponseDetail = "summary" | "standard" | "debug";

export interface BasketAssumption {
  itemIndex: number;
  query: string | null;
  selectedProductId: string | null;
  selectedName: string | null;
  reason:
    | "commodity_best_effort"
    | "generic_variant_default"
    | "location_city_fallback"
    | "unsafe_line_omitted";
  message: string;
}

export interface BasketInitialInput extends BasketLocationInput {
  items: BasketItemInput[];
  includeClub?: boolean;
  /** Max store breakdowns to return (default 5). Use 0 for all. */
  storesLimit?: number;
  /** Shekels of "cost" per km when ranking bestSingleStore (default 3). */
  distancePenaltyPerKm?: number;
  /**
   * When false (default), per-store `lines` are dropped from every store except
   * the recommended ones (bestSingleStore / cheapestCompleteStore) to keep the
   * response small; `missingItems` is always kept. Set true for full detail.
   * @deprecated Prefer `responseDetail: "debug"`. Kept for migration compatibility.
   */
  verbose?: boolean;
  /** fast (default) best-effort one-call; strict pauses for material ambiguity. */
  resolutionMode: BasketResolutionMode;
  /** summary (default) | standard | debug — controls response size. */
  responseDetail: BasketResponseDetail;
}

export interface BasketAnswer {
  itemIndex: number;
  productId: string;
}

export interface BasketResumeInput {
  continuation: string;
  answers: BasketAnswer[];
}

export type BasketOptimizeRequest = BasketInitialInput | BasketResumeInput;

export interface BasketContinuationQuestion {
  itemIndex: number;
  selectionEffect: BasketSelectionEffect;
  allowedProductIds: string[];
}

export interface BasketContinuationV1 {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  input: BasketInitialInput;
  questions: BasketContinuationQuestion[];
  /**
   * Opaque nonce for the in-process resolution snapshot (resolutionCache). Lets a
   * resume reuse the initial call's resolved lines instead of re-searching them.
   * Absent on older tokens → resume simply re-resolves (correct, just slower).
   */
  resolutionKey?: string;
}

export type ResolvedBy = "product_id" | "gtin" | "query" | "unresolved";

export type ResolutionStatus = "resolved" | "needs_confirmation" | "unresolved";

export interface BasketCandidate {
  productId: string;
  name: string;
  score: number;
  matchedVia: SearchProductHit["matchedVia"];
  sizeQty: number | null;
  sizeUnit: string | null;
  pieceCount: number | null;
  hasPrice: boolean;
  hasLocalPrice: boolean;
  /** Semantic product-class of the candidate (from its profile), or null when unclassified. */
  productClass: string | null;
  /** Offline LLM taxonomy path (migration 017); null levels when unclassified. */
  classL1?: string | null;
  classL2?: string | null;
  classL3?: string | null;
  /** Cross-cutting variant (migration 018): regular/diet_zero/cherry_grape/organic/... */
  variant?: string | null;
  /** Brand pulled from the name when product.brand was NULL (migration 018). */
  brandExtracted?: string | null;
  intentTier?: 1 | 2 | 3 | 0;
}

export interface BasketSubstitutionMeta {
  originalProductId: string | null;
  originalName: string | null;
  selectedProductId: string;
  selectedName: string;
  reason: string;
  changedAttributes: string[];
  confidence: number | null;
}

export interface ResolvedItem {
  index: number;
  qty: number;
  qtyMode: string;
  amount: number | null;
  unit: string | null;
  productId: string | null;
  name: string | null;
  resolvedBy: ResolvedBy;
  /** Discrete resolution outcome when deterministic-first policy is active. */
  resolutionStatus?: ResolutionStatus;
  /**
   * Pricing intent: commodity compares approved equivalents by line total;
   * brand_family prefers the primary then same-brand compatible packs;
   * exact prefers the pinned primary whenever stocked. Stamped during coverage.
   */
  intentMode?: BasketPricingIntent;
  confidence: number | null;
  lowConfidence: boolean;
  candidates: BasketCandidate[];
  /** Lexical/global top pick before local/intent re-rank (for substitution explain). */
  primaryProductId: string | null;
  primaryName: string | null;
  substitution: BasketSubstitutionMeta | null;
  /**
   * Gated candidates a chain may price interchangeably (commodity peers or
   * brand-family auto-compatible packs). Never includes hard-pin exact SKUs'
   * class-wide peers.
   */
  equivalents?: BasketCandidate[];
  /**
   * Same brand-family peers that are NOT auto-compatible (e.g. larger pack).
   * Surfaced as alternative_available when no auto peer is priced locally.
   */
  alternatives?: BasketCandidate[];
}

export interface BasketItemStatus {
  index: number;
  qty: number;
  qtyMode: string;
  amount: number | null;
  unit: string | null;
  productId: string | null;
  name: string | null;
  resolved: boolean;
  resolvedBy: ResolvedBy;
  /** Discrete outcome used to determine whether this line may be auto-priced. */
  resolutionStatus: ResolutionStatus;
  confidence: number | null;
  lowConfidence: boolean;
  candidates: BasketCandidate[];
  substitution: BasketSubstitutionMeta | null;
}

export interface BasketLine {
  itemIndex: number;
  productId: string;
  name: string;
  qty: number;
  /** Purchase qty basis for this priced SKU (may differ from the resolved primary). */
  qtyMode: string;
  listingId: string;
  itemCode: string;
  unitPrice: number;
  lineTotal: number;
  promoApplied: boolean;
  promoDescription: string | null;
  /** True when a lower-ranked candidate was used because the primary SKU wasn't stocked. */
  substituted: boolean;
  substitutionReason: string | null;
  originalProductId: string | null;
  /** Storefront link to open this product on the chain's site (search-by-barcode/name). Null if the chain has no online store. */
  link: string | null;
  freshness: Freshness;
}

export interface BasketMissingAlternative {
  productId: string;
  name: string;
  sizeQty: number | null;
  sizeUnit: string | null;
  pieceCount: number | null;
}

export interface BasketMissingItem {
  itemIndex: number;
  productId: string | null;
  name: string | null;
  reason: "product_not_found" | "not_carried_by_chain" | "no_price_data" | "alternative_available";
  /** Present when reason is alternative_available — a same-family larger/other pack. */
  alternative?: BasketMissingAlternative;
}

export interface BasketStoreResult {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  city: string | null;
  address: string | null;
  distanceKm: number | null;
  currency: string;
  total: number;
  itemsFound: number;
  itemsRequested: number;
  lines: BasketLine[];
  missingItems: BasketMissingItem[];
}

export interface BasketCoverage {
  pricedLines: number;
  resolvableLines: number;
  requestedLines: number;
  coverageRatio: number;
}

/** Whether `total` covers every requested line or only the priced subset. */
export type BasketTotalScope = "complete_basket" | "priced_lines_only";

export interface BasketStorePlan extends BasketCoverage {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  total: number;
  /** complete_basket when coverageRatio === 1; otherwise priced_lines_only. */
  totalScope: BasketTotalScope;
  currency: string;
  distanceKm: number | null;
  lines: BasketLine[];
  missingItems: BasketMissingItem[];
}

export interface MultiStoreLine {
  itemIndex: number;
  productId: string;
  name: string;
  qty: number;
  storeId: string;
  storeName: string;
  chainName: string;
  address: string | null;
  lineTotal: number;
  unitPrice: number;
  promoApplied: boolean;
  promoDescription: string | null;
  /** Storefront link to open this product on the chain's site. Null if the chain has no online store. */
  link: string | null;
}

export interface BasketMultiStorePlan extends BasketCoverage {
  total: number;
  /** complete_basket when coverageRatio === 1; otherwise priced_lines_only. */
  totalScope: BasketTotalScope;
  currency: string;
  storeCount: number;
  lines: MultiStoreLine[];
  missingItemIndexes: number[];
}

export interface CandidateAvailability {
  pricedStoreCount: number;
  chainCount: number;
  minPrice: number | null;
}

export interface BasketQuestionOption {
  productId: string;
  name: string;
  pack: {
    pieceCount: number | null;
    sizeQty: number | null;
    sizeUnit: string | null;
  };
  nearbyPricedStores: number;
  nearbyPricedChains: number;
  minimumNearbyPrice: number | null;
}

export interface BasketQuestion {
  itemIndex: number;
  /** Stable within the basket contract so callers can associate an answer with a line. */
  id: string;
  prompt: string;
  reason: string;
  required: true;
  selectionEffect: BasketSelectionEffect;
  options: BasketQuestionOption[];
}

export interface BasketPreview {
  priceScope: "resolved_subset";
  resolvedLines: number;
  requestedLines: number;
  candidateStores: number;
}

export interface BasketNeedsConfirmationResult {
  status: "needs_confirmation";
  continuation: string;
  questions: BasketQuestion[];
  preview: BasketPreview;
  items: BasketItemStatus[];
  location: StoreLocationMetadata;
}

export interface BasketCompleteResult {
  status: "complete";
  bestSingleStore: BasketStorePlan | null;
  cheapestCompleteStore: BasketStorePlan | null;
  multiStore: BasketMultiStorePlan | null;
  items: BasketItemStatus[];
  stores: BasketStoreResult[];
  storesCompared: number;
  storesTruncated: boolean;
  location: StoreLocationMetadata;
  /** Best-effort choices and omissions surfaced in fast mode. */
  assumptions: BasketAssumption[];
}

export type BasketOptimizeResult =
  | BasketNeedsConfirmationResult
  | BasketCompleteResult;

export interface BasketOptimizeOptions {
  continuationSecret: string;
  now?: number;
}

export interface ResolveLocationScope {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
}

export interface ListingRow {
  id: string;
  product_id: string;
  chain_id: string;
  item_code: string;
  name: string;
  gtin: string | null;
  /** Feed/backfill: sold by weight (₪/kg or ₪/L). */
  is_weighted?: boolean | null;
  /** per_kg | per_l | per_piece | per_pack | unknown */
  sale_basis?: string | null;
  piece_count?: number | null;
}

export interface StorePriceRow {
  listing_id: string;
  store_id: string;
  price: string;
  currency: string;
  source_ts: string;
  ingested_at: string;
}
