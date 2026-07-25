/**
 * Percentage-attribute gate (fat content, mostly).
 *
 * Israeli dairy is differentiated almost entirely by fat percentage, and it is
 * written into the product name rather than exposed as an attribute: cottage
 * ships at 1% / 3% / 5% / 9% / 12%, milk at 1% / 2% / 3%, cheese at 5% / 9% /
 * 15% / 28%. The ontology has no `fat` attribute at all
 * (`semantic_attribute_definition` covers brand, cut, variant, species,
 * product_class, pack, kosher, freshness, form), and the LLM taxonomy labels all
 * of them `variant = "regular"`, so `variantConflict` sees no disagreement.
 *
 * Two consequences, both observed on the live catalog:
 *   • a plain `קוטג׳` line grouped 12%, 5%, 1% and a garlic-dill flavour as one
 *     interchangeable set, then priced whichever was cheapest;
 *   • an explicit `קוטג׳ תנובה 5%` resolved to `קוטג תנובה 1% 250 גרם` — the
 *     shopper's stated constraint was silently dropped.
 *
 * Percentages are read off the NAME because that is where they live. Sets rather
 * than single values, since names carry more than one ("קוטג' תנובה 5% שומן",
 * "20% פחות סוכר", "100% גבינה"). Absent on either side is not a conflict, which
 * matches how `variantConflict` treats an unknown variant.
 */

const PERCENT_PATTERN = /(\d+(?:[.,]\d+)?)\s*%/g;

/** Every percentage written into a product or query string. */
export function percentagesIn(text: string | null | undefined): Set<number> {
  const out = new Set<number>();
  if (!text) return out;
  for (const match of text.matchAll(PERCENT_PATTERN)) {
    const value = Number(match[1]!.replace(",", "."));
    if (Number.isFinite(value) && value >= 0) out.add(value);
  }
  return out;
}

/**
 * The percentage the shopper asked for, when they named exactly one.
 *
 * Only a single unambiguous value counts as a constraint — a query carrying two
 * percentages is not a filter we can honour, so it is treated as unspecified.
 */
export function requestedPercent(queryText: string | null | undefined): number | null {
  const found = [...percentagesIn(queryText)];
  return found.length === 1 ? found[0]! : null;
}

/**
 * True when the query named a percentage and the candidate contradicts it.
 *
 * A candidate with NO percentage in its name is not rejected: plenty of correct
 * SKUs omit it, and rejecting them would starve the pool for a constraint the
 * catalog simply does not always state.
 */
export function rejectPercentMismatch(
  queryText: string | null | undefined,
  candidateName: string | null | undefined,
): boolean {
  const wanted = requestedPercent(queryText);
  if (wanted == null) return false;
  const got = percentagesIn(candidateName);
  if (got.size === 0) return false;
  return !got.has(wanted);
}

/**
 * True when two candidates state percentages that do not overlap — different
 * products (1% vs 9% cottage), never interchangeable on one basket line.
 */
export function percentConflict(
  a: { name: string | null | undefined },
  b: { name: string | null | undefined },
): boolean {
  const left = percentagesIn(a.name);
  const right = percentagesIn(b.name);
  if (left.size === 0 || right.size === 0) return false;
  for (const value of left) {
    if (right.has(value)) return false;
  }
  return true;
}
