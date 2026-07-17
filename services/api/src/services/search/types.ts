import type { RetrievalEvidence } from "@super-mcp/shared";
import type { GeoPoint } from "../../lib/geo.js";
import type { ProductSummary } from "../products/types.js";

export interface SearchProductsParams {
  q?: string;
  /**
   * Original user query when `q` is an expanded alias variant.
   * Evidence (exactPhrase / token counts) is always computed against this.
   */
  originalQuery?: string;
  category?: string;
  brand?: string;
  gtin?: string;
  limit?: number;
  /** Optional location scope — boosts / filters by local price availability. */
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
  /** Enable V2 hybrid recall (lexical + query-vector ANN + RRF). Default: feature flags. */
  semanticExpand?: boolean;
  /** When true and location is set, drop products with no local price. Default false. */
  inStockOnly?: boolean;
}

export type SearchMatchedVia = "product" | "listing" | "gtin" | "vector" | "alias";

export interface SearchProductHit extends ProductSummary {
  /** 0–1 relevance score (prefix/contains/trigram + listing-name matches). */
  score: number;
  /** Whether the hit came primarily from product.name or a chain listing.name. */
  matchedVia: SearchMatchedVia;
  hasPrice: boolean;
  /** True when priced in the requested city/near/store scope (same as hasPrice when unscoped). */
  hasLocalPrice: boolean;
  /** Cosine distance when recalled via direct query-vector ANN. */
  vectorDistance?: number | null;
  /** Raw lexical SQL score (0–1), preserved separately from fused RRF score. */
  lexicalScore?: number | null;
  /** Deterministic recall signals for basket resolution. */
  evidence?: RetrievalEvidence;
}

/** Hybrid retrieval candidate after weighted RRF of lexical + vector lists. */
export interface RetrievalCandidate extends SearchProductHit {
  lexicalRank: number | null;
  vectorRank: number | null;
  vectorDistance: number | null;
  fusedScore: number;
}

export interface SearchHitRow {
  id: string;
  gtin: string | null;
  name: string;
  brand: string | null;
  category_l1: string | null;
  category_l2: string | null;
  size_qty: number | null;
  size_unit: string | null;
  score: string | number;
  matched_via: SearchMatchedVia;
  has_price: boolean;
  has_local_price: boolean;
}

export interface SearchScopeParams {
  scoped: boolean;
  cityParam?: number;
  nearLatParam?: number;
  nearLngParam?: number;
  radiusParam?: number;
  storeIdsParam?: number;
}

export interface SearchPriceExistsOpts extends SearchScopeParams {
  localExists: string;
  globalExists: string;
  stockFilter: string;
}
