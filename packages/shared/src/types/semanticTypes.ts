/** Generic, data-driven semantic types. Domain vocabulary lives in ontology rows. */

import type { SemanticSearchConfig } from "./semanticSearch.js";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "./semanticSearch.js";

export type SemanticTermKind = "concept" | "attribute" | "alias" | "stopword" | "penalty";
export type SemanticMatchMode = "token" | "phrase" | "exact" | "alias";
export type ConstraintStrength = "hard" | "soft" | "ranking";
export type MissingValueBehavior = "allow" | "relax" | "reject";
export type ConflictPolicy = "different_value" | "explicit_pairs";

export interface SemanticAttributeDefinition {
  attribute: string;
  constraintStrength: ConstraintStrength;
  missingValueBehavior: MissingValueBehavior;
  enablesNearbyAlternative: boolean;
  conflictPolicy: ConflictPolicy;
}

export interface OntologyTerm {
  kind: SemanticTermKind;
  attribute: string | null;
  value: string | null;
  term: string;
  impliesAttribute: string | null;
  impliesValue: string | null;
  weight: number;
  matchMode: SemanticMatchMode;
  priority: number;
}

export interface OntologyRelaxation {
  attribute: string;
  fromValue: string;
  toValue: string;
  label: string | null;
}

export interface OntologySnapshot {
  version: string;
  locale: string;
  terms: OntologyTerm[];
  relaxations: OntologyRelaxation[];
  attributes: SemanticAttributeDefinition[];
  searchConfig: SemanticSearchConfig;
}

/** A single extracted constraint from query or product text. */
export interface SemanticConstraint {
  attribute: string;
  value: string;
  strength: "hard" | "soft" | "ranking";
  source: "explicit" | "implied" | "penalty";
  matchedTerm?: string;
}

export interface SemanticProfile {
  attributes: Record<string, string>;
  concepts: string[];
  penalties: string[];
  conceptTerms: string[];
}

export interface SemanticGateResult {
  allowed: boolean;
  /** 1 exact, 2 relaxed, 3 nearby alternative, 0 rejected */
  tier: 1 | 2 | 3 | 0;
  conflicts: string[];
  relaxed: string[];
  penaltyScore: number;
}

export interface QueryProfile {
  normalizedText: string;
  coreTerms: string[];
  category: string | null;
  attributes: Record<string, string>;
  requestedAmount: { quantity: number; unit: string } | null;
}

/** Deterministic recall signals attached to search hits for basket resolution. */
export interface RetrievalEvidence {
  exactName: boolean;
  exactPhrase: boolean;
  /** Query tokens match the leading name tokens (staple head-anchor). */
  headAnchored?: boolean;
  matchedTokenCount: number;
  queryTokenCount: number;
  trigramSimilarity: number | null;
  aliasMatched: boolean;
  vectorDistance: number | null;
  lexicalScore: number | null;
}

export const DEFAULT_ONTOLOGY_VERSION = "he-retail-v1";
export const DEFAULT_EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const DEFAULT_EMBED_DIMS = 384;

export { DEFAULT_SEMANTIC_SEARCH_CONFIG };
export type { SemanticSearchConfig };
