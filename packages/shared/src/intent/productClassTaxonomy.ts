/**
 * Closed 3-level grocery taxonomy for LLM product classification.
 *
 * Single source of truth for BOTH the classifier prompt/schema (packages/db
 * classifyProducts.ts) and the read side (basket resolution). No free text: every
 * level is a closed enum so results stay groupable. L1 reuses the exact strings
 * `produce` and `beverage` that the ontology already emits, for backward compat.
 *
 * L3 ("commodity family") is populated ONLY for fragmentation-prone L2s (fresh
 * produce, deli spreads, fresh meat/fish, basic dairy, soda, wine, coffee,
 * flatbread, salt/sugar). It is null everywhere else — most packaged goods stop
 * at L2. L3 is what separates onion≠scallion, hummus-spread≠chickpeas,
 * lemon≠lime, coarse-salt≠sugar.
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
};

export const TAXONOMY_L1: readonly string[] = Object.keys(TAXONOMY_L2);
export const ALL_L2: readonly string[] = Object.values(TAXONOMY_L2).flat();
export const ALL_L3: readonly string[] = Object.values(TAXONOMY_L3).flat();

/** Sentinel a classifier may use when no L3 family applies. Stored as NULL. */
export const L3_NONE = "none";

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
