import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";

/** Processed / prepared chicken — never a safe default for generic עוף. */
export const PROCESSED_CHICKEN_TOKENS: ReadonlySet<string> = new Set([
  "קפוא",
  "קפואה",
  "מעובד",
  "מעושן",
  "נקניק",
  "נקניקיות",
  "שניצל",
  "נאגטס",
  "אצבעות",
  // Ground chicken is a distinct ask ("עוף טחון"); never the bare-עוף default.
  "טחון",
  "טחונה",
]);

/**
 * Organ / carcass bits that share productClass with fresh chicken and pass
 * head-anchor on fat catalogs. Reject for generic עוף unless the query names them.
 */
export const ORGAN_CHICKEN_TOKENS: ReadonlySet<string> = new Set([
  "קורקבן",
  "כבד",
  "לבבות",
  "צוואר",
  "גרון",
  "גב",
  "עצמות",
  "עצם",
]);

/**
 * True when a chicken candidate name is processed or an unrequested organ cut.
 * Token-based (not substring) so names like עגבניות are unaffected by "גב".
 */
export function chickenNameIsUndesired(
  name: string,
  queryTokens: readonly string[],
): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(name));
  const querySet = new Set(queryTokens);
  for (const token of tokens) {
    if (PROCESSED_CHICKEN_TOKENS.has(token)) return true;
    if (ORGAN_CHICKEN_TOKENS.has(token) && !querySet.has(token)) return true;
  }
  return false;
}

/** Bare / generic chicken query that must not resolve to organ or processed cuts. */
export function isGenericChickenQuery(queryText: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (!tokens.includes("עוף")) return false;
  // Explicit organ/cut request — allow those tokens through.
  for (const token of tokens) {
    if (ORGAN_CHICKEN_TOKENS.has(token)) return false;
    if (PROCESSED_CHICKEN_TOKENS.has(token)) return false;
  }
  return true;
}

/** Drop organ/processed chicken peers when the query is a generic עוף line. */
export function rejectUnsafeChickenName(queryText: string, candidateName: string): boolean {
  if (!isGenericChickenQuery(queryText)) return false;
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  return chickenNameIsUndesired(candidateName, queryTokens);
}
