import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import type { RetrievalEvidence } from "../types/semanticTypes.js";
import { tokenizeNormalized } from "./tokenMatcher.js";

/**
 * True when the query phrase dominates the product name.
 * Blocks incidental token hits like query "בצלים" inside "לחם מחמצת עם בצלים".
 */
export function isDominantPhraseMatch(
  name: string,
  evidence: Pick<RetrievalEvidence, "exactName" | "exactPhrase" | "queryTokenCount">,
  locale = "he",
): boolean {
  if (evidence.exactName) return true;
  if (!evidence.exactPhrase) return false;
  const queryTokens = evidence.queryTokenCount ?? 0;
  if (queryTokens <= 0) return false;
  const nameTokens = tokenizeNormalized(normalizeEmbedInput(name), locale);
  // Allow short modifiers ("בצל אדום", "מלפפון בייבי") but not long host names.
  return nameTokens.length > 0 && nameTokens.length <= queryTokens + 2;
}
