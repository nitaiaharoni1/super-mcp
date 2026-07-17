/**
 * Compatibility façade over the generic semantic matcher.
 * Prefer extractConstraints / gateAgainstConstraints / profileFromText directly.
 */
import {
  extractConstraints,
  gateAgainstConstraints,
  profileFromText,
} from "./semanticMatcher.js";
import type { OntologySnapshot, SemanticGateResult, SemanticProfile } from "../types/semanticTypes.js";

export interface ProductIntent {
  query: string;
  conceptTerms: string[];
  freshness: string | null;
  species: string | null;
  cut: string | null;
  brand: string | null;
  kosher: boolean | null;
  isGenericProduceLike: boolean;
  profile: SemanticProfile;
  ontologyVersion: string;
}

export type IntentGateResult = SemanticGateResult;

export function extractProductIntent(
  query: string,
  ontology: OntologySnapshot,
): ProductIntent {
  if (!ontology) {
    throw new Error("extractProductIntent requires ontology");
  }
  const profile = profileFromText(query, ontology);
  return {
    query: query.trim(),
    conceptTerms: profile.conceptTerms,
    freshness: profile.attributes.freshness ?? null,
    species: profile.attributes.species ?? null,
    cut: profile.attributes.cut ?? null,
    brand: profile.attributes.brand ?? null,
    kosher: profile.attributes.kosher === "true" ? true : null,
    isGenericProduceLike:
      profile.concepts.length > 0 ||
      profile.attributes.cut != null ||
      profile.attributes.species != null,
    profile,
    ontologyVersion: ontology.version,
  };
}

export function gateProductAgainstIntent(
  candidateName: string,
  intent: ProductIntent,
  ontology: OntologySnapshot,
): IntentGateResult {
  if (!ontology) {
    throw new Error("gateProductAgainstIntent requires ontology");
  }
  const constraints = extractConstraints(intent.query, ontology);
  return gateAgainstConstraints(candidateName, constraints, ontology, {
    queryText: intent.query,
  });
}
