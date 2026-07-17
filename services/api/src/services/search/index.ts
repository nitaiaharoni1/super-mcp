export type {
  SearchProductsParams,
  SearchProductHit,
  SearchMatchedVia,
  RetrievalCandidate,
} from "./types.js";
export { searchProducts, searchProductsScored, orderByLocationStock } from "./scoredSearch.js";
export { getQueryEmbedding, QueryEmbeddingError } from "./queryEmbedding.js";
export type { QueryEmbeddingResult } from "./queryEmbedding.js";
export { fuseRankedCandidates } from "./rankFusion.js";
export { searchByQueryVector } from "./vectorSearch.js";
export {
  rankHitsForIntent,
  searchQueriesForIntent,
  mergeSearchHits,
  type RankedIntentHit,
  type RankHitsOptions,
} from "./intentRank.js";
export {
  activeEmbedModel,
  activeOntologyVersion,
  getActiveOntology,
  clearOntologyCache,
  loadSemanticProfiles,
  type SemanticProfileRow,
} from "./ontology.js";
