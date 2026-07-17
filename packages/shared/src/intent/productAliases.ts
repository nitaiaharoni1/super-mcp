/**
 * Query expansion is ontology-driven. This module only re-exports the generic
 * helper so existing imports keep working; pass an OntologySnapshot at call sites.
 */
export { expandQueryAliases as expandProductQuery } from "./semanticMatcher.js";
