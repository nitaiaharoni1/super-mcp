import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import { tokenizeNormalized } from "./tokenMatcher.js";

// Hebrew final letters → medial form, then strip ONE plural/feminine suffix, so
// a query token and a name token reduce to the SAME stem across morphology:
//   מלפפונים→מלפפונ, מלפפון→מלפפונ ; עגבניות→עגבני, עגבניה→עגבני ; פיתות→פית, פיתה→פית.
// Stem EQUALITY (not prefix) keeps specificity — בצל≠בצלצל (onion vs onion-rings).
const FINAL_FORMS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const MEDIAL_TO_FINAL: Record<string, string> = { כ: "ך", מ: "ם", נ: "ן", פ: "ף", צ: "ץ" };
// Suffixes in MEDIAL form (compared after final letters are folded), so the
// plural ים (final mem) is written ימ here. Longest first.
const NOUN_SUFFIXES = ["ות", "ימ", "ה", "ת"] as const;

function foldFinalLetters(token: string): string {
  return token.replace(/[ךםןףץ]/g, (c) => FINAL_FORMS[c] ?? c);
}

/** Re-apply final-letter form on the last character (לימונ→לימון). */
function toFinalLetterForm(stem: string): string {
  if (!stem) return stem;
  const last = stem[stem.length - 1]!;
  const final = MEDIAL_TO_FINAL[last];
  return final ? stem.slice(0, -1) + final : stem;
}

/**
 * Which noun suffix was stripped (medial form), or null if none.
 * Mirrors stemHebrewToken's suffix rules.
 */
function strippedNounSuffix(token: string): (typeof NOUN_SUFFIXES)[number] | null {
  const t = foldFinalLetters(token);
  for (const suf of NOUN_SUFFIXES) {
    if (!t.endsWith(suf)) continue;
    const restLen = t.length - suf.length;
    const minRest = suf.length >= 2 ? 2 : 3;
    if (restLen >= minRest) return suf;
  }
  return null;
}

/**
 * Fold final letters and strip one Hebrew noun suffix when the remaining stem
 * is long enough. Short staples (פיתות/פיתה, length 4) must stem — there is no
 * minimum input length gate.
 */

/**
 * Drop the optional yod/vav (matres lectionis) so ktiv male and ktiv haser
 * spellings of one word compare equal.
 *
 * Hebrew writes many words both with and without those letters and the feeds are
 * inconsistent even inside a single chain. Measured: a shopper asking for
 * `קורנפלייקס` was refused `קורנפלקס 500 גרם`, the same product, because the two
 * heads differ by two yods.
 *
 * Only applied to words of at least MIN_MATRES_FOLD_LEN letters, because in short
 * words those letters usually carry the meaning rather than decorate it: `שמן`
 * (oil) and `שומן` (fat) are different products and must not collapse together.
 * Used when comparing HEAD words, never on search text at large.
 */
const MIN_MATRES_FOLD_LEN = 5;

export function foldMatresLectionis(token: string): string {
  if (token.length < MIN_MATRES_FOLD_LEN) return token;
  const folded = token.replace(/[יו]/g, "");
  // A word that is mostly matres (e.g. "אוויר") would fold to almost nothing and
  // start matching unrelated words; keep the original when too little survives.
  return folded.length >= 3 ? folded : token;
}

export function stemHebrewToken(token: string): string {
  const t = foldFinalLetters(token);
  for (const suf of NOUN_SUFFIXES) {
    if (!t.endsWith(suf)) continue;
    const restLen = t.length - suf.length;
    // Longer suffixes (ות, ימ): allow short stems (פיתות→פית).
    // Short suffixes (ה, ת): require ≥3 so we don't over-strip tiny tokens.
    const minRest = suf.length >= 2 ? 2 : 3;
    if (restLen >= minRest) return t.slice(0, -suf.length);
  }
  return t;
}

/**
 * Surface singular forms for a plural (or feminine-plural) token, for lexical
 * recall. Stem equality alone cannot retrieve via FTS/ILIKE — לימונים does not
 * contain לימון — so search must also probe reconstructed singulars.
 *
 *   ימ plurals: stem + final letter → לימונים→לימון, מלפפונים→מלפפון
 *   ות plurals: stem+ה and stem+ת → עגבניות→עגבניה, פרגיות→פרגית
 */
export function hebrewSingularVariants(token: string): string[] {
  const suf = strippedNounSuffix(token);
  if (suf !== "ימ" && suf !== "ות") return [];
  const stem = stemHebrewToken(token);
  if (!stem) return [];
  const out = new Set<string>();
  if (suf === "ימ") {
    out.add(toFinalLetterForm(stem));
  } else {
    out.add(stem + "ה");
    out.add(stem + "ת");
  }
  return [...out].filter((v) => v !== token);
}

/**
 * Expand a query with Hebrew plural→singular surface variants for recall.
 * Always includes the original query. Does not depend on ontology aliases.
 */
export function expandHebrewQueryVariants(query: string, limit = 4): string[] {
  const q = query.trim();
  if (!q) return [];
  const out = new Set<string>([q]);
  const tokens = tokenizeNormalized(normalizeEmbedInput(q));
  for (let i = 0; i < tokens.length; i++) {
    for (const singular of hebrewSingularVariants(tokens[i]!)) {
      if (tokens.length === 1) {
        out.add(singular);
      } else {
        const next = tokens.slice();
        next[i] = singular;
        out.add(next.join(" "));
      }
      if (out.size >= limit) return [...out];
    }
  }
  return [...out];
}

/**
 * Does every query token appear in the name, tolerant of Hebrew plural/singular?
 * Compares STEMS (final-letter normalized, one plural/feminine suffix stripped).
 */
export function queryTokensSatisfied(queryTokens: string[], name: string): boolean {
  const nameStems = new Set(tokenizeNormalized(normalizeEmbedInput(name)).map(stemHebrewToken));
  return queryTokens.every((qt) => nameStems.has(stemHebrewToken(qt)));
}
