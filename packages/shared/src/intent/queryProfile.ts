import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import type { OntologySnapshot, QueryProfile } from "../types/semanticTypes.js";
import {
  extractConstraints,
  parseExplicitPackConstraints,
  profileFromText,
  queryBlocksFreshProduce,
  queryLooksLikeProduce,
} from "./semanticMatcher.js";
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

  const parsed = parseExplicitPackConstraints(query);
  if (parsed.pieceCount && attributes.piece_count == null) {
    attributes.piece_count = parsed.pieceCount;
  }

  const requestedAmount = resolveRequestedAmount(opts, parsed.requestedAmount);
  applyFreshProduceIntent(attributes, profile.concepts, query, requestedAmount, opts);

  const coreTerms = tokenizeNormalized(normalizedText, ontology.locale).filter(
    (t) =>
      !ontology.terms.some(
        (term) => term.kind === "stopword" && normalizeEmbedInput(term.term) === t,
      ),
  );

  return {
    normalizedText,
    coreTerms,
    category: attributes.product_class ?? null,
    attributes,
    requestedAmount,
  };
}

function resolveRequestedAmount(
  opts: { amount?: number | null; unit?: string | null } | undefined,
  parsedFromQuery: { quantity: number; unit: string } | null,
): { quantity: number; unit: string } | null {
  if (opts?.amount != null && opts.unit?.trim()) {
    return { quantity: opts.amount, unit: opts.unit.trim() };
  }
  return parsedFromQuery;
}

/**
 * Set form=fresh only when the caller asked for a weight amount of produce and
 * the query does not already name a preserved/prepared/flour form.
 * Ontology concept implications may still set fresh for bare produce nouns;
 * preserved cues clear that inference.
 */
function applyFreshProduceIntent(
  attributes: Record<string, string>,
  concepts: string[],
  query: string,
  requestedAmount: { quantity: number; unit: string } | null,
  opts?: { amount?: number | null; unit?: string | null },
): void {
  if (queryBlocksFreshProduce(query)) {
    if (attributes.form === "fresh") delete attributes.form;
    return;
  }

  const unitRaw = (opts?.unit ?? requestedAmount?.unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/[׳′]/g, "'")
    .replace(/[״″]/g, '"')
    .replace(/\s+/g, "");
  const isWeightUnit =
    unitRaw === "kg" ||
    unitRaw === "g" ||
    unitRaw === "גרם" ||
    unitRaw === "גרמים" ||
    unitRaw === "קג" ||
    unitRaw === 'ק"ג' ||
    unitRaw === "ק'ג" ||
    unitRaw === "קילו" ||
    unitRaw === "קילוגרם";

  const isProduce =
    concepts.includes("produce") ||
    attributes.product_class === "produce" ||
    queryLooksLikeProduce(query);

  if (isWeightUnit && isProduce && attributes.form == null) {
    attributes.form = "fresh";
  }
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
