export {
  drainSemanticIndex,
  markProductsDirty,
} from "./drain.js";
export { embedText, getEmbedder } from "./embedder.js";
export { loadOntologySnapshot } from "./ontology.js";
export {
  getCachedQueryEmbedding,
  putCachedQueryEmbedding,
} from "./queryCache.js";
export type {
  DrainSemanticIndexOptions,
  DrainSemanticIndexResult,
} from "./types.js";
