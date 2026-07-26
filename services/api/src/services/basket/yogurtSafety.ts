import { normalizeEmbedInput, tokenizeNormalized } from "@super-mcp/shared";

/**
 * Drinking-yogurt markers that share the יוגורט token with the cup.
 *
 * A bare "יוגורט" means something you eat with a spoon. Drinking yogurt is a
 * different purchase, and it is stocked widely enough to win on availability:
 * a live "4 יוגורט" line returned four 8-packs of Actimel, 32 bottles for
 * ₪79.60, while a plain cup carried by 766 stores sat unused in the same pool.
 *
 * `אקטימל` and `אירן` are here because the product is inherently a drink and
 * its name carries no other marker ("יוגורט אקטימל 8*100 מ\"ל"). `דני` is the
 * chocolate drink, which the catalog files as "דני בטעם שוקולד לשתייה".
 *
 * Deliberately NOT keyed on the size unit: Israeli feeds label spoonable yogurt
 * in ml as often as in grams ("יוגורט פרופ מולר 150 מ\"ל" is a cup, "יוגורט
 * סמיך GO 200 מל" is thick spoonable), so a g/ml test would throw away real
 * cups and keep real drinks.
 */
const DRINKING_YOGURT_TOKENS: ReadonlySet<string> = new Set([
  "משקה",
  "משקאות",
  "לשתיה",
  "לשתייה",
  "שתיה",
  "שתייה",
  "אקטימל",
  "אקטיויה",
  "יקולט",
  "דנאקטיב",
  "אירן",
  "לבן",
  "שייק",
  "דרינק",
  "drink",
]);

/**
 * Tokens whose presence means the shopper ASKED for a drink, so the guard must
 * stand down. Kept separate from the marker set because `לבן` is ambiguous:
 * "לבן" alone is a drinkable fermented product, but "יוגורט ביו לבן" is a plain
 * white cup, so it may never reject on its own.
 */
const AMBIGUOUS_MARKERS: ReadonlySet<string> = new Set(["לבן"]);

/** Query that names yogurt without asking for the drinking form. */
export function isGenericYogurtQuery(queryText: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (!tokens.some((t) => t.startsWith("יוגורט"))) return false;
  return !tokens.some((t) => DRINKING_YOGURT_TOKENS.has(t));
}

/**
 * Drop drinking yogurt, and flavoured yogurt, when the query is a plain
 * יוגורט line.
 *
 * `preparation` (migration 025, LLM-labelled) is ground truth for the flavour
 * axis and is used whenever the caller has it. Matching flavour words in the
 * name instead was measured against those labels and is not good enough to
 * stand alone: it catches 261 of 369 flavoured yogurts (71%) while wrongly
 * flagging 14 of 236 plain ones. So the name only ever decides the DRINK axis,
 * which `preparation` does not model at all — Actimel is labelled plain, and it
 * is plain, it is just not a thing you eat with a spoon.
 */
export function rejectUnsafePlainYogurtName(
  queryText: string,
  candidateName: string,
  preparation?: string | null,
): boolean {
  if (!isGenericYogurtQuery(queryText)) {
    // An explicit drink query (or any non-yogurt line) is none of our business.
    return false;
  }
  if (preparation === "flavoured") return true;
  const tokens = tokenizeNormalized(normalizeEmbedInput(candidateName));
  return tokens.some(
    (token) => DRINKING_YOGURT_TOKENS.has(token) && !AMBIGUOUS_MARKERS.has(token),
  );
}
