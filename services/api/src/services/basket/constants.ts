/**
 * Fallback auto-accept thresholds. Prefer `ontology.searchConfig.autoAcceptScore`
 * / `autoAcceptGap` when an active ontology is available.
 */
export const AUTO_ACCEPT_SCORE = 0.55;
/** Accept top hit when it beats #2 by at least this margin. */
export const AUTO_ACCEPT_GAP = 0.15;
export const DEFAULT_CANDIDATE_LIMIT = 5;
export const DEFAULT_STORES_LIMIT = 5;
/**
 * Fallback shortlist size. Prefer `ontology.searchConfig.lexicalLimit` for the
 * search pool when an active ontology is available.
 */
export const SEMANTIC_CANDIDATE_LIMIT = 24;
