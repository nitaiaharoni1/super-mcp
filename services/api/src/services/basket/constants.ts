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

/**
 * Deliberately NOT widened for generic queries, though it is tempting.
 *
 * A bare staple query fills its 24 slots with tight name matches and can miss the
 * widely-stocked SKU, which is the largest remaining accuracy gap (21 of 24 benchmark
 * failures are a correct product stocked in too few branches). Raising the cap to 48
 * and the search to the full lexical pool was measured on both axes:
 *
 *   accuracy  11 -> 12 failing labels, i.e. within label noise
 *   latency   Tel Aviv staples median 2,470ms -> 23,248ms, against a 9,000ms budget
 *
 * The cost is a bigger candidate set flowing into class loading, the availability
 * query and coverage enrichment, all of which scale with it. Closing that gap needs a
 * cheaper mechanism (coverage-aware retrieval, or an availability signal pushed into
 * the search ranking) rather than a deeper shortlist.
 */
