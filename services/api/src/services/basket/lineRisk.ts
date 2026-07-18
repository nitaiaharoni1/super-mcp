import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";

export interface RiskCandidate {
  productClass: string | null;
  brand: string | null;
  intentTier: number | null;
  /** LLM taxonomy L1 (migration 017), or null when unclassified. */
  classL1?: string | null;
}

export type LineRisk =
  | { kind: "commodity" }
  | { kind: "cross_class"; classes: string[] }
  | { kind: "brand_pinned"; pinnedBrand: string }
  | { kind: "opaque" }; // no class signal at all — keep today's confirmation behavior

// Hebrew abbreviation/quote marks that appear inside brand names: geresh (׳),
// gershayim (״), the ASCII apostrophe/quote, and the curly right single quote
// (U+2019). normalizeEmbedInput only strips the ASCII apostrophe and geresh; it
// turns gershayim and the curly apostrophe into a SPACE, which splits a brand
// token in two ("צ’ויס" -> "צ ויס") and breaks the brand-pin match. We must not
// edit the shared tokenizer (a parallel task may touch it), so strip these
// marks locally before tokenizing both the query and the brand.
const HEBREW_QUOTE_MARKS = /['’׳״`"]/g;

export function riskTokens(text: string): string[] {
  return tokenizeNormalized(normalizeEmbedInput(text.replace(HEBREW_QUOTE_MARKS, "")));
}

/**
 * Two brand strings name the same brand when their normalized token sets are
 * equal (order- and quote-mark-insensitive). Used to compare a chosen
 * candidate's brand against a pinned brand from the query.
 */
export function brandMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const at = riskTokens(a);
  const bt = riskTokens(b);
  if (at.length === 0 || bt.length === 0) return false;
  const bSet = new Set(bt);
  return at.length === bt.length && at.every((t) => bSet.has(t));
}

/**
 * A line earns a human question only when the shortlist is ambiguous in a way
 * that changes WHAT the user gets: candidates split across product classes,
 * or the query pins a brand. Same-class same-unit near-duplicates are pricing
 * detail, not ambiguity.
 */
export function classifyLineRisk(queryText: string, shortlist: RiskCandidate[]): LineRisk {
  const strong = shortlist.filter(
    (c) => c.intentTier != null && c.intentTier >= 1 && c.intentTier <= 2,
  );
  const pool = strong.length > 0 ? strong : shortlist;

  const queryTokens = new Set(riskTokens(queryText));
  for (const c of pool) {
    if (!c.brand) continue;
    const brandTokens = riskTokens(c.brand);
    // All brand tokens present in the query = the user asked for this brand.
    if (brandTokens.length > 0 && brandTokens.every((t) => queryTokens.has(t))) {
      return { kind: "brand_pinned", pinnedBrand: c.brand };
    }
  }

  // With the LLM taxonomy the TOP (most-relevant) candidate anchors the commodity
  // class, and cross_class is DELIBERATELY not raised for a classified line: the
  // dominant-intent resolution is what the shopper wants ("חומוס"->spread, "פלפל"
  // ->bell pepper), not a "spread or dry beans?" question. Safety is delegated, not
  // dropped: off-class rivals are made non-blocking by the resolution margin
  // (classesDistinguish), and every equivalence builder groups strictly by class
  // path (classesConflict) — so an off-class rival can never be priced as the
  // commodity, and if same-class ambiguity remains unresolved the line still asks.
  const anchor = pool[0];
  if (anchor?.classL1) return { kind: "commodity" };

  // Unclassified fallback: the pre-taxonomy flat-class behavior.
  const classes = [
    ...new Set(pool.map((c) => c.productClass).filter((x): x is string => x != null)),
  ];
  if (classes.length === 0) return { kind: "opaque" };
  if (classes.length > 1) return { kind: "cross_class", classes };
  return { kind: "commodity" };
}
