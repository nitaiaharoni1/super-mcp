import type { OntologySnapshot, SemanticProfile } from "@super-mcp/shared";
import {
  activeOntologyVersion,
  getActiveOntology,
  loadSemanticProfiles,
  searchProductsScored,
  type SearchProductHit,
} from "../search/index.js";
import { toSearchLocationParams } from "../search/locationScope.js";
import {
  semanticBasketEnabled,
  semanticV2RecallEnabled,
} from "../../lib/features.js";
import {
  DEFAULT_CANDIDATE_LIMIT,
  SEMANTIC_CANDIDATE_LIMIT,
} from "./constants.js";
import { rankQueryCandidates } from "./rankQueryCandidates.js";
import type {
  BasketItemInput,
  BasketSubstitutionMeta,
  ResolveLocationScope,
  ResolutionStatus,
} from "./types.js";
import { hitToCandidate } from "./candidates.js";

export interface QueryResolveBase {
  index: number;
  amount: number | null;
  unit: string | null;
}

export interface QueryResolveResult {
  qty: number;
  qtyMode: string;
  productId: string | null;
  name: string | null;
  resolvedBy: "query" | "unresolved";
  confidence: number | null;
  lowConfidence: boolean;
  candidates: ReturnType<typeof hitToCandidate>[];
  primaryProductId: string | null;
  primaryName: string | null;
  substitution: BasketSubstitutionMeta | null;
  resolutionStatus?: ResolutionStatus;
  /** Gated same-class equivalents attached when a commodity line auto-resolves. */
  equivalents?: ReturnType<typeof hitToCandidate>[];
}

/** Search-phase output for a free-text basket line (profiles not yet loaded). */
export interface QuerySearchContext {
  item: BasketItemInput;
  base: QueryResolveBase;
  hasAmount: boolean;
  wantsPackSize: boolean;
  hits: SearchProductHit[];
  searchMs: number;
  candidateLimit: number;
  semantic: boolean;
  ontology: OntologySnapshot | null;
  location: ResolveLocationScope | undefined;
}

/** Run product search for a free-text query line (no profile load / rank). */
export async function searchQueryItem(
  item: BasketItemInput,
  base: QueryResolveBase,
  location: ResolveLocationScope | undefined,
  hasAmount: boolean,
): Promise<QuerySearchContext> {
  const wantsPackSize = hasAmount && Boolean(item.unit?.trim());
  const semantic = semanticBasketEnabled();
  const ontology = semantic ? await getActiveOntology() : null;
  const searchConfig = ontology?.searchConfig;
  const candidateLimit = searchConfig?.lexicalLimit ?? SEMANTIC_CANDIDATE_LIMIT;
  // Adaptive limits: pack-size needs a wider pool; other lines stay near first-pass.
  const searchLimit = semantic
    ? wantsPackSize
      ? candidateLimit
      : Math.min(
          candidateLimit,
          Math.max(searchConfig?.firstPassLexicalLimit ?? 20, 20) * 2,
        )
    : wantsPackSize
      ? 60
      : DEFAULT_CANDIDATE_LIMIT;

  const locationParams = {
    ...toSearchLocationParams(location ?? {}),
    // Honor V2_RECALL=0 when basket is on (basket remains the master kill switch).
    semanticExpand: semantic && semanticV2RecallEnabled(),
  };

  // searchProductsScored owns alias expansion and merges those lexical results.
  // Expanding here as well repeated the same DB searches (e.g. קרח variants twice).
  const searchStarted = Date.now();
  const hits = await searchProductsScored({
    q: item.query!,
    limit: searchLimit,
    ...locationParams,
  });
  const searchMs = Date.now() - searchStarted;

  return {
    item,
    base,
    hasAmount,
    wantsPackSize,
    hits,
    searchMs,
    candidateLimit,
    semantic,
    ontology,
    location,
  };
}

/**
 * Resolve a free-text query line into a product candidate shortlist.
 * Convenience wrapper: search → load profiles for those hits → rank.
 * Prefer the batched path in `resolveItems` for multi-line baskets.
 */
export async function resolveQueryItem(
  item: BasketItemInput,
  base: QueryResolveBase,
  location: ResolveLocationScope | undefined,
  hasAmount: boolean,
): Promise<QueryResolveResult> {
  const ctx = await searchQueryItem(item, base, location, hasAmount);
  let profiles = new Map<string, SemanticProfile | Partial<SemanticProfile>>();
  let profileMs = 0;
  if (ctx.ontology) {
    const profileStarted = Date.now();
    const loaded = await loadSemanticProfiles(
      ctx.hits.map((hit) => hit.id),
      activeOntologyVersion(),
    );
    profiles = loaded ?? new Map();
    profileMs = Date.now() - profileStarted;
  }
  return rankQueryCandidates(ctx, profiles, { profileMs });
}
