import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import type { OntologySnapshot, QueryProfile } from "../types/semanticTypes.js";
import { extractConstraints, profileFromText } from "./semanticMatcher.js";
import { tokenizeNormalized } from "./tokenMatcher.js";

export function buildQueryProfile(
  query: string,
  ontology: OntologySnapshot,
  opts?: { amount?: number | null; unit?: string | null },
): QueryProfile {
  const normalizedText = normalizeEmbedInput(query);
  const profile = profileFromText(query, ontology);
  const constraints = extractConstraints(query, ontology);
  const attributes = { ...profile.attributes };

  for (const c of constraints) {
    if (attributes[c.attribute] == null) attributes[c.attribute] = c.value;
  }
  applyCategoryDefaults(attributes, profile.concepts, ontology);

  const coreTerms = tokenizeNormalized(normalizedText, ontology.locale).filter(
    (t) =>
      !ontology.terms.some(
        (term) => term.kind === "stopword" && normalizeEmbedInput(term.term) === t,
      ),
  );

  const requestedAmount =
    opts?.amount != null && opts.unit?.trim()
      ? { quantity: opts.amount, unit: opts.unit.trim() }
      : null;

  return {
    normalizedText,
    coreTerms,
    category: attributes.product_class ?? null,
    attributes,
    requestedAmount,
  };
}

function applyCategoryDefaults(
  attributes: Record<string, string>,
  concepts: string[],
  ontology: OntologySnapshot,
): void {
  for (const term of ontology.terms) {
    if (term.kind !== "concept" || !term.value) continue;
    if (!concepts.includes(term.value)) continue;
    if (term.impliesAttribute && term.impliesValue && attributes[term.impliesAttribute] == null) {
      attributes[term.impliesAttribute] = term.impliesValue;
    }
  }
}
