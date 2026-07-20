import type { Freshness } from "../products/types.js";
import type { SearchProductHit } from "../search/types.js";
import type { GeoPoint } from "../../lib/geo.js";
import type { StoreLocationMetadata } from "../../lib/resolveStoreLocation.js";

export type BasketSelectionEffect = "representative" | "pin";
export type BasketIntentMode = "exact" | "commodity" | "needs_confirmation" | "unresolved";

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
  intentModeOverride?: Extract<BasketIntentMode, "exact" | "commodity">;
}

export interface BasketLocationInput {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
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
   */
  verbose?: boolean;
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
  confidence: number | null;
  lowConfidence: boolean;
  candidates: BasketCandidate[];
  /** Lexical/global top pick before local/intent re-rank (for substitution explain). */
  primaryProductId: string | null;
  primaryName: string | null;
  substitution: BasketSubstitutionMeta | null;
  /**
   * Gated same-class candidates a chain may price interchangeably. Present only
   * on auto-resolved query lines whose confirmation was pure same-class margin
   * ambiguity (commodity risk); never on brand-pinned or cross-class lines.
   */
  equivalents?: BasketCandidate[];
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

export interface BasketMissingItem {
  itemIndex: number;
  productId: string | null;
  name: string | null;
  reason: "product_not_found" | "not_carried_by_chain" | "no_price_data";
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

export interface BasketStorePlan extends BasketCoverage {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  total: number;
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
  /** Storefront link to open this product on the chain's site. Null if the chain has no online store. */
  link: string | null;
}

export interface BasketMultiStorePlan extends BasketCoverage {
  total: number;
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
