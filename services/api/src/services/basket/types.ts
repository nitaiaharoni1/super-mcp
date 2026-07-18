import type { Freshness } from "../products/types.js";
import type { SearchProductHit } from "../search/types.js";
import type { GeoPoint } from "../../lib/geo.js";
import type { StoreLocationMetadata } from "../../lib/resolveStoreLocation.js";

export interface BasketItemInput {
  productId?: string;
  gtin?: string;
  query?: string;
  /** Internal pack count mapped from boundary `pack_qty` (or deprecated `qty`). */
  qty?: number;
  /** Physical amount requested (e.g. 1.5 with unit=kg). */
  amount?: number;
  /** Unit for amount: kg, g, L, ml, unit, יח, etc. */
  unit?: string;
}

export interface BasketLocationInput {
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
}

export interface BasketPrepareInput extends BasketLocationInput {
  items: BasketItemInput[];
}

export interface BasketOptimizeInput extends BasketLocationInput {
  items: BasketItemInput[];
  includeClub?: boolean;
  /** Max store breakdowns to return (default 5). Use 0 for all. */
  storesLimit?: number;
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
  hasPrice: boolean;
  hasLocalPrice: boolean;
  /** Semantic product-class of the candidate (from its profile), or null when unclassified. */
  productClass: string | null;
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

export interface BasketRecommendation {
  storeId: string;
  storeName: string;
  chainId: string;
  chainName: string;
  total: number;
  currency: string;
  itemsFound: number;
  itemsRequested: number;
  distanceKm: number | null;
  /** Why this store was picked as the cheapest practical option. */
  reason: string;
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

export interface MultiStorePlan {
  total: number;
  currency: string;
  itemsFound: number;
  itemsRequested: number;
  storeCount: number;
  lines: MultiStoreLine[];
  missingItemIndexes: number[];
  reason: string;
}

export interface BasketCompleteness {
  requestedLines: number;
  resolvedLines: number;
  needsConfirmationLines: number;
  unresolvedLines: number;
  safeResolutionRatio: number;
  totalsArePartial: boolean;
}

export interface BasketPrepareQuestionOption {
  productId: string;
  name: string;
  sizeQty: number | null;
  sizeUnit: string | null;
  hasLocalPrice: boolean;
}

export interface BasketPrepareQuestion {
  itemIndex: number;
  /** Stable within the basket contract so callers can associate an answer with a line. */
  id: string;
  prompt: string;
  reason: string;
  required: boolean;
  options: BasketPrepareQuestionOption[];
}

export interface BasketPrepareResult {
  items: BasketItemStatus[];
  completeness: BasketCompleteness;
  /** Safe automatic selections applied during resolution (query → chosen product). */
  assumptions: string[];
  /** Required confirmations for lines that cannot be safely auto-selected. */
  questions: BasketPrepareQuestion[];
  location: StoreLocationMetadata;
}

export interface BasketOptimizeResult {
  items: BasketItemStatus[];
  /** Candidate stores ranked cheapest / most-complete first (trimmed). */
  stores: BasketStoreResult[];
  storesCompared: number;
  storesTruncated: boolean;
  /** Same as stores[0] when any store can fill at least one item; null otherwise. */
  cheapest: BasketRecommendation | null;
  /** Per-item cheapest across stores (may require multiple trips). */
  multiStore: MultiStorePlan | null;
  /** Resolution coverage; when below minSafeResolutionRatio, cheapest/multiStore are null. */
  completeness: BasketCompleteness;
  location: StoreLocationMetadata;
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
}

export interface StorePriceRow {
  listing_id: string;
  store_id: string;
  price: string;
  currency: string;
  source_ts: string;
  ingested_at: string;
}
