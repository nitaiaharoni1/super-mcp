import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import { L3_TO_L2 } from "./productClassTaxonomy.js";

/**
 * Everyday Hebrew for a taxonomy concept, so a typed query lands where the
 * classifier put the products.
 *
 * Classification normalises the CATALOGUE: every bin liner is now
 * `household/disposables/waste_bags` whatever the chain called it. Nothing
 * normalises the SHOPPER, who types "שקיות זבל" while the catalogue says
 * "שקיות אשפה". Name-similarity search then ranks ziplock bags first, because
 * they at least share the word "שקיות", and the wrong product becomes the
 * primary that every downstream gate is measured against.
 *
 * This is the query-side half of the same normalisation, kept as data rather
 * than inferred at runtime. Only phrases whose meaning is unambiguous belong
 * here: a hint HARD-NARROWS the candidate pool, so a wrong entry is worse than
 * a missing one. When a shopper's words are already the catalogue's words, no
 * entry is needed.
 */
export const L3_QUERY_PHRASES: Record<string, readonly string[]> = {
  // The observed failure: a "שקיות זבל" line was filled with "שקיות זיפר L".
  waste_bags: ["שקיות זבל", "שקית זבל", "שקיות אשפה", "שקית אשפה", "שקיות למטבח"],
  food_storage_bags: ["שקיות זיפר", "שקית זיפר", "שקיות הקפאה", "שקיות סנדוויץ"],
  foil_wrap: ["נייר כסף", "נייר אלומיניום", "ניילון נצמד", "נייר אפייה"],

  // Rami Levy prices 157 body washes and never once says "רחצה".
  // "אל סבון" is deliberately absent: the catalogue reads it as hand soap 63
  // times against 15 body washes, so it fails this table's one rule. The
  // last-resort pricing tier still reaches those products; a hint would only
  // make the wrong reading confident.
  body_wash: ["סבון רחצה", "גל רחצה", "ג'ל רחצה", "תחליב רחצה", "סבון גוף"],
  hand_soap: ["סבון ידיים", "סבון לידיים"],
  bar_soap: ["סבון מוצק", "סבון אמבט"],

  // Every unit of Rami Levy's ground coffee is called "קפה טורקי".
  ground_coffee: ["קפה טחון", "קפה שחור", "קפה טורקי", "קפה ערבי"],
  instant_coffee: ["קפה נמס", "נס קפה"],

  dishwasher_detergent: ["קפסולות למדיח", "טבליות למדיח", "ג'ל למדיח", "חומר למדיח"],
  dish_soap: ["סבון כלים", "נוזל כלים", "אקונומיקה לכלים"],
  laundry_detergent: ["אבקת כביסה", "ג'ל כביסה", "נוזל כביסה"],
  fabric_softener: ["מרכך כביסה"],

  toilet_paper: ["נייר טואלט"],
  paper_towel: ["מגבות נייר", "נייר סופג"],

  toothpaste: ["משחת שיניים"],
  mouthwash: ["מי פה", "שטיפת פה"],
};

/** Phrase → L3, longest phrase first so "סבון ידיים" beats a bare "סבון". */
const PHRASE_TO_L3: ReadonlyArray<readonly [string, string]> = Object.entries(L3_QUERY_PHRASES)
  .flatMap(([l3, phrases]) => phrases.map((phrase) => [normalizeEmbedInput(phrase), l3] as const))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * The L3 a query unambiguously asks for, or null.
 *
 * Substring rather than token match: "שקיות זבל גדולות 20 יח" has to hit, and
 * Hebrew compounds do not split cleanly. Longest phrase wins so a more specific
 * reading is never shadowed by a shorter one.
 */
export function intendedL3ForQuery(queryText: string): string | null {
  const q = normalizeEmbedInput(queryText ?? "");
  if (!q) return null;
  for (const [phrase, l3] of PHRASE_TO_L3) {
    if (q.includes(phrase)) return l3;
  }
  return null;
}

/** The L2 owning an L3 hint, for callers gating one level up. */
export function l2ForL3(l3: string): string | null {
  return L3_TO_L2.get(l3) ?? null;
}
