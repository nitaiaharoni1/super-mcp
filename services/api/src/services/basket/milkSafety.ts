import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";

/**
 * Non-plain milk forms that share the חלב token with drinking milk.
 * Bare "חלב" must resolve to fresh/UHT cow milk, not condensed, powder, or flavored.
 */
export const NON_PLAIN_MILK_TOKENS: ReadonlySet<string> = new Set([
  "מרוכז",
  "מרוכזת",
  "ממותק",
  "ממותקת",
  "ממותקים",
  "אבקה",
  "אבקת",
  "בטעם",
  "וניל",
  "שוקולד",
  "אגוזי",
  "לוז",
  // Reconstituted "milk drink" is not fresh/UHT cow milk.
  "משקה",
  // Facial / body cleanser ("חלב פנים", "חלב גוף") — personal care, not food.
  "פנים",
  "גוף",
  // Evaporated / milk jam — distinct from drinking milk.
  "מאודה",
  "ריבת",
  // Plant / alternative milks — distinct ask from bare חלב.
  "שקדים",
  "סויה",
  "קוקוס",
  "אורז",
  "שיבולת",
  "קצפת",
]);

/**
 * Halvah (חלבה) is a classic false friend of חלב — substring/trigram recall
 * floods milk queries with confectionery. Reject unless the query names it.
 */
export function isHalvahFalseFriend(queryText: string, candidateName: string): boolean {
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (!queryTokens.includes("חלב") || queryTokens.includes("חלבה")) return false;
  const nameTokens = tokenizeNormalized(normalizeEmbedInput(candidateName));
  return nameTokens.includes("חלבה");
}

/**
 * True when a milk candidate is condensed, powdered, flavored, or plant-based
 * and the query did not request that form.
 */
export function plainMilkNameIsUndesired(
  name: string,
  queryTokens: readonly string[],
): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(name));
  const querySet = new Set(queryTokens);
  for (const token of tokens) {
    if (NON_PLAIN_MILK_TOKENS.has(token) && !querySet.has(token)) return true;
  }
  return false;
}

/** Query that names milk but not a specialty milk form. */
export function isGenericMilkQuery(queryText: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (!tokens.includes("חלב")) return false;
  for (const token of tokens) {
    if (NON_PLAIN_MILK_TOKENS.has(token)) return false;
  }
  return true;
}

/** Drop specialty milk / halvah when the query is a plain חלב line. */
export function rejectUnsafePlainMilkName(queryText: string, candidateName: string): boolean {
  if (isHalvahFalseFriend(queryText, candidateName)) return true;
  if (!isGenericMilkQuery(queryText)) return false;
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  return plainMilkNameIsUndesired(candidateName, queryTokens);
}
