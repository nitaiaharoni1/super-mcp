/**
 * Closed 3-level grocery taxonomy for LLM product classification.
 *
 * Single source of truth for BOTH the classifier prompt/schema (packages/db
 * classifyProducts.ts) and the read side (basket resolution). No free text: every
 * level is a closed enum so results stay groupable. L1 reuses the exact strings
 * `produce` and `beverage` that the ontology already emits, for backward compat.
 *
 * L3 ("commodity family") is populated for fragmentation-prone L2s: the ones
 * where two products share a name and a shopper would not accept one for the
 * other. It separates onion≠scallion, hummus-spread≠chickpeas, lemon≠lime,
 * coarse-salt≠sugar, and since 2026-08-03 the non-food branches too, where its
 * absence was doing real damage: `household/disposables` held 4,711 products at
 * L2 with nothing below, so bin liners and ziplock bags were indistinguishable
 * and a "שקיות זבל" line got filled with "שקיות זיפר L". It is still null for
 * L2s with no such split.
 */

/** L1 → L2[] map. */
export const TAXONOMY_L2: Record<string, readonly string[]> = {
  produce: ["vegetable_fresh", "fruit_fresh", "herbs_fresh", "sprouts_mushrooms"],
  meat_fish: [
    "poultry",
    "beef",
    "lamb_veal",
    "pork",
    "fish",
    "seafood",
    "deli_cured",
    "meat_processed",
  ],
  dairy_eggs: ["milk", "cheese", "yogurt", "butter_cream", "eggs", "dairy_dessert", "plant_dairy"],
  bakery: ["bread", "pita_flatbread", "pastry", "cake", "crackers_drybread"],
  pantry_dry: [
    "grains_rice",
    "pasta",
    "flour_baking",
    "legumes_dry",
    "spices_seasoning",
    "salt_sugar",
    "oil_vinegar",
    "cereal",
    "nuts_seeds",
    "soup_bouillon",
  ],
  canned_preserved: [
    "canned_vegetable",
    "canned_fish",
    "canned_legume",
    "pickled",
    "canned_fruit",
    "tomato_paste_sauce",
  ],
  spreads_condiments: [
    "hummus_tahini_salads",
    "sauce_ketchup_mayo",
    "honey_jam",
    "chocolate_spread",
    "olives",
  ],
  snacks_sweets: [
    "chips_savory",
    "candy",
    "chocolate",
    "cookies_biscuits",
    "ice_cream",
    "dried_fruit_snack",
    "energy_bar",
  ],
  beverage: ["soda", "juice", "water", "coffee", "tea", "energy_sports_drink", "syrup_concentrate"],
  alcohol: ["wine", "beer", "spirits", "liqueur"],
  frozen: ["frozen_vegetable", "frozen_meat_fish", "frozen_prepared", "frozen_dessert", "frozen_dough"],
  household: ["cleaning", "laundry", "paper_goods", "kitchenware", "disposables"],
  personal_care: ["hygiene", "hair", "oral", "cosmetics", "baby_care", "health_supplement"],
  non_food_other: ["deposit_fee", "pet", "tobacco", "misc"],
};

/** L2 → L3[] map. Only fragmentation-critical L2s have children; others resolve L3=null. */
export const TAXONOMY_L3: Record<string, readonly string[]> = {
  vegetable_fresh: [
    "onion",
    "scallion",
    "garlic",
    "tomato",
    "cucumber",
    "pepper_bell",
    "potato",
    "sweet_potato",
    "carrot",
    "lettuce",
    "cabbage",
    "eggplant",
    "zucchini_squash",
    "leafy_green",
    "root_vegetable",
    "other_vegetable",
  ],
  fruit_fresh: [
    "apple",
    "banana",
    "orange_citrus",
    "lemon",
    "lime",
    "grape",
    "melon",
    "watermelon",
    "berry",
    "stone_fruit",
    "tropical_fruit",
    "other_fruit",
  ],
  herbs_fresh: ["parsley", "cilantro", "mint", "dill", "basil", "other_herb"],
  poultry: [
    "chicken_whole",
    "chicken_breast",
    "chicken_thigh",
    "chicken_wing",
    "turkey",
    "chicken_ground",
    "chicken_processed",
  ],
  beef: ["beef_steak", "beef_ground", "beef_roast", "beef_stew", "kebab_skewer"],
  fish: ["salmon", "tuna", "tilapia", "sea_bass", "other_fish"],
  hummus_tahini_salads: ["hummus_spread", "tahini", "matbucha", "eggplant_salad", "other_salad"],
  soda: ["cola", "citrus_soda", "other_soda"],
  wine: ["red_wine", "white_wine", "rose_wine", "sparkling_wine"],
  cheese: ["hard_cheese", "white_soft_cheese", "yellow_cheese", "cream_cheese", "specialty_cheese"],
  milk: ["cow_milk", "plant_milk"],
  salt_sugar: ["salt", "sugar", "sweetener"],
  coffee: ["instant_coffee", "ground_coffee", "coffee_beans", "coffee_capsule"],
  pita_flatbread: ["pita", "laffa", "tortilla_wrap"],

  // Non-food. Added because these L2s were the whole story behind the worst
  // substitutions on the delivery surface: `household/disposables` held 4,711
  // products with L3 null, so bin liners and ziplock bags were one bucket and a
  // "שקיות זבל" line was filled with "שקיות זיפר L". `personal_care/hygiene`
  // likewise put hand soap, body wash and deodorant together, and this basket
  // asks for two of those three on separate lines.
  disposables: ["waste_bags", "food_storage_bags", "foil_wrap", "tableware_disposable"],
  paper_goods: ["toilet_paper", "paper_towel", "tissues", "napkins"],
  cleaning: [
    "dish_soap",
    "dishwasher_detergent",
    "surface_cleaner",
    "floor_cleaner",
    "bleach",
    "toilet_cleaner",
  ],
  laundry: ["laundry_detergent", "fabric_softener", "stain_remover"],
  kitchenware: ["cookware", "utensils", "storage_containers", "cleaning_tools"],
  hygiene: [
    "body_wash",
    "bar_soap",
    "hand_soap",
    "deodorant",
    "feminine_hygiene",
    "wet_wipes",
  ],
  oral: ["toothpaste", "toothbrush", "mouthwash", "dental_floss"],
  hair: ["shampoo", "conditioner", "hair_styling", "hair_color"],

  // Same reasoning inside food: this basket's bulgur and quinoa lines both sit in
  // `grains_rice`, which held 12,653 products with nothing below it.
  grains_rice: ["rice", "bulgur", "quinoa", "couscous", "oats", "barley_freekeh"],
  legumes_dry: ["lentil", "chickpea", "bean_dry", "split_pea"],
};

export const TAXONOMY_L1: readonly string[] = Object.keys(TAXONOMY_L2);
export const ALL_L2: readonly string[] = Object.values(TAXONOMY_L2).flat();
export const ALL_L3: readonly string[] = Object.values(TAXONOMY_L3).flat();

/** Sentinel a classifier may use when no L3 family applies. Stored as NULL. */
export const L3_NONE = "none";

/**
 * Cross-cutting VARIANT — the axis L3 can't express: two products of the same L3
 * that a shopper would NOT accept as substitutes (Coke `regular` vs `diet_zero`,
 * tomato `regular` vs `cherry_grape`, `regular` vs `organic` at a different price).
 * A generic line defaults to `regular` (cheapest); an explicit query token
 * (זירו/אורגני/שרי) requires the matching variant. `regular` is the unmarked
 * default and the sentinel for "no special variant".
 */
export const VARIANTS: readonly string[] = [
  "regular",
  "diet_zero",
  "sugar_free",
  "decaf",
  "organic",
  "premium",
  "baby_mini",
  "cherry_grape",
  "sliced_prepared",
  "whole_wheat",
  "lactose_free",
  "spicy",
  // A product formulated or sold for children. Its own axis because the class
  // path cannot see it: Sensodyne and "משחת שיניים לילדים בטעם ענבים" are both
  // personal_care/oral/toothpaste/regular, so a basket asking for toothpaste was
  // filled with two tubes of children's grape.
  "kids",
  // A colour that makes it a different shopping-list line: קינואה אדומה for a
  // bare קינואה, עדשים כתומות for עדשים. 1,564 colour-marked products currently
  // label as `regular`.
  "colour_variant",
  "other",
];
export const VARIANT_DEFAULT = "regular";

/**
 * Cross-cutting PREPARATION — is this the plain staple, or something made from it?
 *
 * The axis that actually produces wrong basket answers, and the one L3 was supposed
 * to cover but does not: 95,974 of 118,156 stocked products have no L3 at all. So a
 * plain `אורז` query resolved to rice PAPER and rice NOODLES, and `יוגורט` to a
 * chocolate-cornflake snack pot, because every candidate shares the staple's token
 * and its L1/L2.
 *
 * Today those are blocked by hand-tuned Hebrew token deny-lists (derivedForm.ts).
 * Those lists are a standing false-positive hazard: one iteration of the roll-count
 * guard gave a challah a pack count of 650, and 196 of its 255 catalog matches were
 * wrong. A labelled attribute replaces guessing from names with a fact.
 *
 *  - plain              the staple itself: אורז לבן, חלב 3%, יוגורט לבן
 *  - flavoured          same food, flavour/additive: יוגורט תות, חלב שוקו
 *  - prepared_meal      a dish built around it: טונה עם פסטה, ארוחת אורז ועדשים
 *  - derived_ingredient made FROM it, different product: דפי אורז, קמח אורז,
 *                       רסק עגבניות, פירורי לחם
 *
 * A generic query wants `plain`. An explicit one ("רסק עגבניות") asks for its own
 * preparation and must still match.
 */
export const PREPARATIONS: readonly string[] = [
  "plain",
  "flavoured",
  "prepared_meal",
  "derived_ingredient",
];

export const PREPARATION_DEFAULT = "plain";

/**
 * Cross-cutting PACK FORM — one unit, or several bundled?
 *
 * Pack count decides price comparability and `piece_count` is populated for 1.5% of
 * the catalog (paper_goods 5.6%, canned_fish 3.3%), so a 4-pack of tuna and a single
 * tin were compared as the same line until name regexes caught it. `multipack` is
 * the fact those regexes were trying to infer.
 */
export const PACK_FORMS: readonly string[] = ["single", "multipack"];

export const PACK_FORM_DEFAULT = "single";

const L2_TO_L1 = new Map<string, string>();
for (const [l1, l2s] of Object.entries(TAXONOMY_L2)) for (const l2 of l2s) L2_TO_L1.set(l2, l1);
const L3_TO_L2 = new Map<string, string>();
for (const [l2, l3s] of Object.entries(TAXONOMY_L3)) for (const l3 of l3s) L3_TO_L2.set(l3, l2);

/** Validate an L1/L2/L3 triple against the closed hierarchy (l3 may be null/none). */
export function isValidClassPath(
  l1: string,
  l2: string | null | undefined,
  l3: string | null | undefined,
): boolean {
  if (!TAXONOMY_L2[l1]) return false;
  if (l2 == null) return l3 == null || l3 === L3_NONE;
  if (L2_TO_L1.get(l2) !== l1) return false;
  if (l3 == null || l3 === L3_NONE) return true;
  return L3_TO_L2.get(l3) === l2;
}

/** Deepest class level both candidates carry, for equivalence/risk comparison. */
export interface ClassPath {
  l1: string | null;
  l2: string | null;
  l3: string | null;
}

/**
 * How two classified candidates compare. "unknown" when either lacks a class
 * (never a disagreement — preserves pre-classification behavior). Otherwise the
 * verdict is taken at the DEEPEST level both share.
 */
export function compareClassPaths(a: ClassPath, b: ClassPath): "unknown" | "same" | "different" {
  if (!a.l1 || !b.l1) return "unknown";
  if (a.l1 !== b.l1) return "different";
  // both have l1 equal; go deeper only where BOTH have the level
  if (a.l2 && b.l2) {
    if (a.l2 !== b.l2) return "different";
    if (a.l3 && b.l3) return a.l3 === b.l3 ? "same" : "different";
    return "same"; // share l2, at least one lacks l3 → same commodity at l2
  }
  return "same"; // share l1, at least one lacks l2
}
