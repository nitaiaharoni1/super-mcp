/**
 * ============================================================================
 *  MACHINE-PROPOSED LABELS — PENDING HUMAN REVIEW. NOT GROUND TRUTH YET.
 * ============================================================================
 *
 * Every entry below was written by an agent, not by a shopper and not by a
 * domain expert. Until a Hebrew-speaking human has read and corrected them, the
 * benchmark score is a CONSISTENCY measure (did behaviour change?) and NOT an
 * accuracy measure (is behaviour right?). Do not quote the score as accuracy in
 * anything external until this header is removed.
 *
 * How they were derived: the catalog was queried for what is actually stocked in
 * each `class_l2` bucket across nearby branches, then a query was written for the
 * staple a shopper would type. That surfaced the traps the labels exist to catch,
 * because in this catalog "most stocked in the class" is emphatically NOT "the
 * plain staple":
 *
 *   grains_rice  top stocked = מנה חמה נודלס (instant noodle cups), not rice
 *   bread        top stocked = לחמית (crispbread), not a loaf
 *   milk         top stocked = שוקו / soy drink, mixed in with actual milk
 *   yogurt       top stocked = דנונה פרו protein pots and chocolate desserts
 *   paper_goods  top stocked = ממחטות (tissues), not toilet paper
 *   oil_vinegar  top stocked = vinegar and soy sauce, not cooking oil
 *   canned_fish  top stocked = אינסלטיסימי prepared salads and 4-packs
 *
 * So a benchmark that assumed "widely stocked = correct" would score the wrong
 * answers as right. Labels are predicates instead.
 *
 * REVIEWER: start with everything marked confidence "low", then "medium". The
 * "high" ones are unambiguous head nouns and should need only a skim.
 */
import type { BenchmarkBasket, StapleLabel } from "../types.js";

/** Traps that recur across many staples: a product MADE FROM the staple. */
const DERIVED = ["דפי", "מקלוני", "פריכיות", "פירורי", "אבקת", "תערובת", "קמח"];

export const STAPLE_LABELS: StapleLabel[] = [
  // ---------------------------------------------------------------- dairy_eggs
  {
    id: "milk-3",
    query: "חלב 3%",
    packQty: 2,
    category: "milk",
    accept: {
      requireTokens: ["חלב"],
      forbidTokens: ["שוקו", "סויה", "שקדים", "אורז", "קוקוס", "אבקת", "מרוכז", "עמיד"],
      anyOfClassL2: ["milk"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.3,
    },
    notes:
      "Plain 3% cow's milk. The milk bucket is full of שוקו (chocolate milk) and plant drinks that all satisfy the token חלב.",
    confidence: "high",
  },
  {
    id: "milk-plain",
    query: "חלב",
    packQty: 1,
    category: "milk",
    accept: {
      requireTokens: ["חלב"],
      forbidTokens: ["שוקו", "סויה", "שקדים", "קוקוס", "אבקת", "מרוכז", "מקציף"],
      anyOfClassL2: ["milk"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.3,
    },
    notes: "Bare 'milk'. Historically resolved to a milk frother; there is a dedicated guard for it.",
    confidence: "high",
  },
  {
    id: "cottage",
    query: "קוטג׳",
    packQty: 2,
    category: "cheese",
    accept: {
      requireTokens: ["קוטג"],
      anyOfClassL2: ["cheese", "yogurt"],
      minNearbyStoreShare: 0.3,
    },
    notes:
      "Fat percentage deliberately unconstrained: a bare query states none, and 1/3/5/9/12% all sit in 665-776 nearby stores so availability cannot pick. REVIEWER: if a shopper saying קוטג׳ means 5%, tighten this.",
    confidence: "low",
  },
  {
    id: "cottage-5",
    query: "קוטג׳ תנובה 5%",
    packQty: 1,
    category: "cheese",
    accept: { requireTokens: ["קוטג", "5"], forbidTokens: ["1%", "9%", "12%"], anyOfClassL2: ["cheese", "yogurt"] },
    notes: "Explicit percentage is a hard constraint the shopper stated. Control for the percent guard.",
    confidence: "high",
  },
  {
    id: "white-cheese",
    query: "גבינה לבנה",
    packQty: 1,
    category: "cheese",
    accept: { requireTokens: ["גבינה"], anyOfClassL2: ["cheese"], minNearbyStoreShare: 0.3 },
    notes: "לבן/לבנה collides with the colour word, so it was excluded from the derived-form guards. Control.",
    confidence: "high",
  },
  {
    id: "yellow-cheese",
    query: "גבינה צהובה",
    packQty: 1,
    category: "cheese",
    accept: { requireTokens: ["גבינה"], forbidTokens: ["לבנה", "שמנת", "קוטג"], anyOfClassL2: ["cheese"] },
    notes: "Hard cheese slices. Must not drift to white cheese or cream cheese.",
    confidence: "medium",
  },
  {
    id: "yogurt-plain",
    query: "יוגורט",
    packQty: 4,
    category: "yogurt",
    accept: {
      requireTokens: ["יוגורט"],
      forbidTokens: ["קורנפלקס", "פצפוצי", "שוקולד", "קראנץ", "מעדן", "פרו", "עם "],
      anyOfClassL2: ["yogurt"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.3,
    },
    notes:
      "Known live failure: resolves to a chocolate-cornflake snack pot. Plain and snack yogurts both sit near 765 stores so availability cannot separate them; this is the case preparation=plain exists for.",
    confidence: "high",
  },
  {
    id: "butter",
    query: "חמאה",
    packQty: 1,
    category: "butter_cream",
    accept: {
      requireTokens: ["חמאה"],
      forbidTokens: ["מרגרינה", "בטעם", "שמרית", "נטורינה", "מזולה", "בצק", "חטיף", "סוכריות"],
      anyOfClassL2: ["butter_cream"],
      minNearbyStoreShare: 0.3,
    },
    notes:
      "Known live failure: resolved to a 1-of-16-store imported butter while a 762-store Tnuva sat in the shortlist. The bucket is also full of בטעם חמאה margarine.",
    confidence: "high",
  },
  {
    id: "cream",
    query: "שמנת",
    packQty: 1,
    category: "butter_cream",
    accept: { requireTokens: ["שמנת"], anyOfClassL2: ["butter_cream"], minNearbyStoreShare: 0.25 },
    notes: "שמנת stems to the same form as שמן (oil) after final-letter folding, which is why it is excluded from guards.",
    confidence: "medium",
  },
  {
    id: "eggs-l",
    query: "ביצים L",
    packQty: 1,
    category: "eggs",
    accept: { requireTokens: ["ביצ"], anyOfClassL2: ["eggs"], minNearbyStoreShare: 0.25 },
    notes:
      "Size L eggs. Pack count deliberately unconstrained here; eggs-tray-12 covers the count case. Known failure: a 6-pack priced for a 12-pack request.",
    confidence: "high",
  },
  {
    id: "eggs-tray-12",
    query: "ביצים תבנית 12",
    packQty: 1,
    category: "eggs",
    accept: { requireTokens: ["ביצ", "12"], anyOfClassL2: ["eggs"] },
    notes: "Explicit pack count. Control for the piece-count gate; piece_count is set on only 16% of the eggs bucket.",
    confidence: "high",
  },

  // -------------------------------------------------------------------- bakery
  {
    id: "bread",
    query: "לחם",
    packQty: 1,
    category: "bread",
    accept: {
      requireTokens: ["לחם"],
      forbidTokens: ["לחמית", "פירורי", "פיתה", "אגוזים", "חטיף"],
      anyOfClassL2: ["bread"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.25,
    },
    notes:
      "A loaf. Top-stocked in the bread bucket is לחמית (crispbread), a different product that shares the head. Also seen resolving to לחם אגוזים (nut bread) for a plain query.",
    confidence: "high",
  },
  {
    id: "bread-white",
    query: "לחם אחיד",
    packQty: 1,
    category: "bread",
    accept: { requireTokens: ["לחם"], forbidTokens: ["לחמית", "פירורי"], anyOfClassL2: ["bread"] },
    notes: "The standard subsidised Israeli loaf. Unambiguous.",
    confidence: "high",
  },
  {
    id: "pita",
    query: "פיתות",
    amount: 10,
    unit: "יח",
    category: "pita_flatbread",
    accept: { requireTokens: ["פית"], anyOfClassL2: ["pita_flatbread", "bread"] },
    notes: "Count request in יח, which must be read as a purchase quantity and not a pack-size constraint.",
    confidence: "high",
  },
  {
    id: "challah",
    query: "חלה",
    packQty: 1,
    category: "bread",
    accept: { requireTokens: ["חלה"], anyOfClassL2: ["bread", "pastry", "cake"] },
    notes:
      "One roll-count iteration gave 'חלה קלועה אנגל 650 ג' a pack count of 650 because אנגל contains גל. Regression sentinel.",
    confidence: "high",
  },

  // ---------------------------------------------------------------- pantry_dry
  {
    id: "rice",
    query: "אורז",
    packQty: 1,
    category: "grains_rice",
    accept: {
      requireTokens: ["אורז"],
      forbidTokens: [...DERIVED, "נודלס", "אטריות", "מנה חמה", "חטיף", "פצפוצי", "משקה"],
      anyOfClassL2: ["grains_rice"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.25,
    },
    notes:
      "The canonical failure. Resolved to Arborio risotto rice, then substituted rice PAPER and rice NOODLES; the whole bucket's top-stocked items are instant noodle cups. All share class_l1/l2 and class_l3 is null.",
    confidence: "high",
  },
  {
    id: "rice-basmati",
    query: "אורז בסמטי",
    packQty: 1,
    category: "grains_rice",
    accept: { requireTokens: ["אורז", "בסמטי"], forbidTokens: DERIVED, anyOfClassL2: ["grains_rice"] },
    notes: "Explicit variety. Control: must stay basmati and must not be rejected by the derived-form guard.",
    confidence: "high",
  },
  {
    id: "pasta",
    query: "פסטה",
    packQty: 2,
    category: "pasta",
    accept: { requireAnyToken: ["פסטה", "ספגטי", "מקרוני", "אטריות"], anyOfClassL2: ["pasta"], minNearbyStoreShare: 0.25 },
    notes: "Any pasta shape counts, so this is OR-of-synonyms rather than AND.",
    confidence: "medium",
  },
  {
    id: "flour",
    query: "קמח",
    packQty: 1,
    category: "flour_baking",
    accept: { requireTokens: ["קמח"], anyOfClassL2: ["flour_baking"], minNearbyStoreShare: 0.25 },
    notes: "קמח is itself a derived-form marker for other staples, so as a query it must be allowed.",
    confidence: "high",
  },
  {
    id: "sugar",
    query: "סוכר",
    packQty: 1,
    category: "salt_sugar",
    accept: { requireTokens: ["סוכר"], forbidTokens: ["ללא סוכר", "תחליף"], anyOfClassL2: ["salt_sugar"] },
    notes: "Plain sugar. Must not resolve to a sugar substitute.",
    confidence: "high",
  },
  {
    id: "salt",
    query: "מלח",
    packQty: 1,
    category: "salt_sugar",
    accept: { requireTokens: ["מלח"], anyOfClassL2: ["salt_sugar"], minNearbyStoreShare: 0.25 },
    notes: "מלח contains לח as a substring; the moist-form guard is token-exact so it must not fire. Regression sentinel.",
    confidence: "high",
  },
  {
    id: "oil-cooking",
    query: "שמן",
    packQty: 1,
    category: "oil_vinegar",
    accept: {
      requireTokens: ["שמן"],
      forbidTokens: ["חומץ", "סויה", "אמבט", "מנוע", "רחצה"],
      // Not a plain "זית" token: עץ הזית is a canola brand. See forbidPatterns.
      forbidPatterns: ["(?<!עץ ה)זית"],
      anyOfClassL2: ["oil_vinegar"],
      minNearbyStoreShare: 0.25,
    },
    notes:
      "Generic cooking oil, expected to prefer canola. The bucket's top-stocked items are vinegar and soy sauce. There is a preferCanola rule for this.",
    confidence: "medium",
  },
  {
    id: "olive-oil",
    query: "שמן זית",
    packQty: 1,
    category: "oil_vinegar",
    accept: { requireTokens: ["שמן", "זית"], forbidTokens: ["אמבט", "רחצה"], anyOfClassL2: ["oil_vinegar"] },
    notes: "Explicit olive oil. Must not resolve to bath oil, which the personal-care guard covers.",
    confidence: "high",
  },
  {
    id: "lentils",
    query: "עדשים",
    packQty: 1,
    category: "legumes_dry",
    accept: { requireTokens: ["עדשים"], anyOfClassL2: ["legumes_dry", "canned_legume"] },
    notes: "Dry lentils; canned is arguably acceptable so both classes allowed. REVIEWER: tighten if dry only.",
    confidence: "medium",
  },
  {
    id: "cereal",
    query: "דגני בוקר",
    packQty: 1,
    category: "cereal",
    accept: { requireTokens: ["דגני"], anyOfClassL2: ["cereal"] },
    notes: "Breakfast cereal.",
    confidence: "medium",
  },
  {
    id: "coffee",
    query: "קפה",
    packQty: 1,
    category: "coffee",
    accept: { requireTokens: ["קפה"], forbidTokens: ["מכונת", "כוסות", "פילטר"], anyOfClassL2: ["coffee"], minNearbyStoreShare: 0.25 },
    notes: "Must be coffee, not a machine or filters. Instant vs ground left open deliberately.",
    confidence: "medium",
  },
  {
    id: "tea",
    query: "תה",
    packQty: 1,
    category: "tea",
    accept: { requireTokens: ["תה"], anyOfClassL2: ["tea"] },
    notes: "תה is a two-letter token, a false-positive risk for any substring matching.",
    confidence: "medium",
  },

  // ---------------------------------------------------------- canned_preserved
  {
    id: "tuna",
    query: "טונה",
    packQty: 4,
    category: "canned_fish",
    accept: {
      requireTokens: ["טונה"],
      forbidTokens: ["עם פסטה", "ארוחה", "אינסלטיסימי", "סלט", "עם אורז", "קינואה"],
      anyOfClassL2: ["canned_fish"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.2,
    },
    notes:
      "Known live failure: a plain-tuna query lands on a ~20-store premium brand while a 136-store one exists outside the retrieved shortlist. Widening retrieval alone makes it worse, because the better-stocked items in this bucket are prepared meals; hence preparation=plain.",
    confidence: "high",
  },
  {
    id: "tomato-paste",
    query: "רסק עגבניות",
    packQty: 1,
    category: "tomato_paste_sauce",
    accept: { requireTokens: ["רסק"], anyOfClassL2: ["tomato_paste_sauce"] },
    notes: "The derived product requested explicitly, so the derived-form guard must NOT reject it. Control.",
    confidence: "high",
  },
  {
    id: "pickles",
    query: "חמוצים",
    packQty: 1,
    category: "pickled",
    accept: { requireAnyToken: ["חמוצים", "חמוץ", "כבוש"], anyOfClassL2: ["pickled"] },
    notes: "Pickled vegetables; any of the pickling words counts.",
    confidence: "medium",
  },

  // ------------------------------------------------------ spreads_condiments
  {
    id: "hummus",
    query: "חומוס",
    packQty: 1,
    category: "hummus_tahini_salads",
    accept: { requireTokens: ["חומוס"], anyOfClassL2: ["hummus_tahini_salads", "canned_legume"], minNearbyStoreShare: 0.25 },
    notes: "Prepared hummus salad; dry chickpeas also called חומוס, hence both classes. REVIEWER.",
    confidence: "medium",
  },
  {
    id: "tahini",
    query: "טחינה",
    packQty: 1,
    category: "hummus_tahini_salads",
    accept: { requireTokens: ["טחינה"], forbidTokens: ["עם חציל", "סלט"], anyOfClassL2: ["hummus_tahini_salads"] },
    notes: "Raw tahini paste, not a tahini-based salad. Seen resolving to a roasted-aubergine tahini salad.",
    confidence: "medium",
  },
  {
    id: "ketchup",
    query: "קטשופ",
    packQty: 1,
    category: "sauce_ketchup_mayo",
    accept: { requireTokens: ["קטשופ"], anyOfClassL2: ["sauce_ketchup_mayo"] },
    notes: "Unambiguous.",
    confidence: "high",
  },
  {
    id: "mayo",
    query: "מיונז",
    packQty: 1,
    category: "sauce_ketchup_mayo",
    accept: { requireTokens: ["מיונז"], anyOfClassL2: ["sauce_ketchup_mayo"] },
    notes: "Unambiguous.",
    confidence: "high",
  },
  {
    id: "chocolate-spread",
    query: "ממרח שוקולד",
    packQty: 1,
    category: "chocolate_spread",
    accept: { requireTokens: ["שוקולד"], anyOfClassL2: ["chocolate_spread"] },
    notes: "Must not drift into the chocolate bar bucket.",
    confidence: "medium",
  },

  // ------------------------------------------------------------------ produce
  {
    id: "tomatoes",
    query: "עגבניות",
    amount: 1,
    unit: "kg",
    category: "vegetable_fresh",
    accept: {
      requireTokens: ["עגבני"],
      forbidTokens: ["רסק", "רוטב", "מיץ", "שימורי", "ממרח", "מחית", "מרק"],
      anyOfClassL2: ["vegetable_fresh"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.2,
    },
    notes: "Fresh tomatoes by weight. רסק/רוטב/מיץ are the derived traps measured in the catalog.",
    confidence: "high",
  },
  {
    id: "cucumbers",
    query: "מלפפונים",
    amount: 1,
    unit: "kg",
    category: "vegetable_fresh",
    accept: {
      // Both morphologies, because Hebrew final letters make one substring
      // unable to cover both: מלפפון ends in a FINAL nun (U+05DF) and מלפפונים
      // carries a MEDIAL one (U+05E0), so the singular token cannot match the
      // plural name and no shared prefix matches the singular. Requiring the
      // singular alone failed a product literally called "מלפפונים" three times
      // per run, against a query that was itself plural.
      requireAnyToken: ["מלפפון", "מלפפוני"],
      forbidTokens: ["חמוץ", "כבוש", "חמוצים"],
      anyOfClassL2: ["vegetable_fresh"],
    },
    notes: "Fresh, not pickled. Accepts singular and plural forms.",
    confidence: "high",
  },
  {
    id: "onion",
    query: "בצל",
    amount: 1,
    unit: "kg",
    category: "vegetable_fresh",
    accept: { requireTokens: ["בצל"], forbidTokens: ["אבקת", "מיובש", "קפוא", "טבעות"], anyOfClassL2: ["vegetable_fresh"] },
    notes: "Fresh onion, not powder or frozen rings.",
    confidence: "high",
  },
  {
    id: "potato",
    query: "תפוחי אדמה",
    amount: 2,
    unit: "kg",
    category: "vegetable_fresh",
    accept: { requireTokens: ["תפוח"], forbidTokens: ["צ'יפס", "פירה", "אבקת", "קפוא"], anyOfClassL2: ["vegetable_fresh"] },
    notes: "Fresh potatoes, not chips or mash powder.",
    confidence: "high",
  },
  {
    id: "carrot",
    query: "גזר",
    amount: 1,
    unit: "kg",
    category: "vegetable_fresh",
    accept: { requireTokens: ["גזר"], forbidTokens: ["מיץ", "קפוא"], anyOfClassL2: ["vegetable_fresh"] },
    notes: "Fresh carrot.",
    confidence: "high",
  },
  {
    id: "lemon",
    query: "לימון",
    amount: 1,
    unit: "kg",
    category: "fruit_fresh",
    accept: { requireTokens: ["לימון"], forbidTokens: ["מיץ", "תרכיז", "עוגת", "סוכריות", "ריח"], anyOfClassL2: ["fruit_fresh"] },
    notes: "Fresh lemon. עוגת לימונים (lemon cake) is a documented host-product trap.",
    confidence: "high",
  },
  {
    id: "banana",
    query: "בננה",
    amount: 1,
    unit: "kg",
    category: "fruit_fresh",
    accept: { requireTokens: ["בננה"], forbidTokens: ["חטיף", "שוקולד", "מיובש"], anyOfClassL2: ["fruit_fresh"] },
    notes: "Fresh banana.",
    confidence: "high",
  },
  {
    id: "apple",
    query: "תפוח עץ",
    amount: 1,
    unit: "kg",
    category: "fruit_fresh",
    accept: { requireTokens: ["תפוח"], forbidTokens: ["אדמה", "מיץ", "חומץ"], anyOfClassL2: ["fruit_fresh"] },
    notes:
      "Apple. Bare תפוח resolves to תפוח אדמה (potato) because Hebrew builds potato as apple-of-the-earth; this label uses the unambiguous תפוח עץ and forbids אדמה.",
    confidence: "high",
  },
  {
    id: "dates",
    query: "תמרים",
    packQty: 1,
    category: "dried_fruit_snack",
    accept: { requireTokens: ["תמר"], anyOfClassL2: ["dried_fruit_snack", "fruit_fresh"] },
    notes:
      "תמר לח (moist dates) is a legitimate form that the moist-form guard rejects for a bare תמרים query, so this label is expected to expose that tension. REVIEWER: decide whether moist dates should satisfy תמרים.",
    confidence: "low",
  },

  // ---------------------------------------------------------------- meat_fish
  {
    id: "chicken",
    query: "עוף",
    amount: 1,
    unit: "kg",
    category: "poultry",
    accept: {
      requireTokens: ["עוף"],
      forbidTokens: ["מרק", "אבקת", "קוביות", "נקניק", "כבד", "לבבות", "קורקבן", "שלד", "בסגנון"],
      anyOfClassL2: ["poultry"],
      minNearbyStoreShare: 0.15,
    },
    notes:
      "Fresh chicken, not organs, soup powder or a prepared dish. There is a dedicated chicken-safety rejector; seen resolving to עוף בסגנון סיני.",
    confidence: "high",
  },
  {
    id: "chicken-schnitzel",
    query: "שניצל עוף",
    amount: 1,
    unit: "kg",
    category: "poultry",
    accept: { requireTokens: ["שניצל"], anyOfClassL2: ["poultry", "frozen_meat_fish", "meat_processed"] },
    notes: "Explicitly a prepared cut, so the chicken guard must allow it. Control.",
    confidence: "high",
  },
  {
    id: "ground-beef",
    query: "בשר טחון",
    amount: 1,
    unit: "kg",
    category: "beef",
    accept: { requireTokens: ["טחון"], anyOfClassL2: ["beef", "meat_processed"] },
    notes: "Ground beef by weight.",
    confidence: "high",
  },

  // ---------------------------------------------------------------- beverage
  {
    id: "coke-1_5",
    query: "קוקה קולה 1.5 ליטר",
    packQty: 2,
    category: "soda",
    accept: { requireTokens: ["קולה"], forbidTokens: ["זירו", "דיאט", "לקריץ"], anyOfClassL2: ["soda"], minNearbyStoreShare: 0.2 },
    notes: "Brand plus size. Must stay regular, not zero/diet. Size is the pack constraint.",
    confidence: "high",
  },
  {
    id: "coke-zero",
    query: "קוקה קולה זירו",
    packQty: 1,
    category: "soda",
    accept: { requireTokens: ["קולה"], anyOfClassL2: ["soda"] },
    notes: "Explicit diet variant; the variant gate must honour it rather than default to regular. Control.",
    confidence: "high",
  },
  {
    id: "water",
    query: "מים מינרלים",
    packQty: 1,
    category: "water",
    accept: { requireTokens: ["מים"], forbidTokens: ["אקדח", "מיצי"], anyOfClassL2: ["water"] },
    notes: "אקדח מים (water gun) is a documented non-commodity-leader trap.",
    confidence: "high",
  },
  {
    id: "beer",
    query: "בירה",
    packQty: 1,
    category: "beer",
    accept: { requireTokens: ["בירה"], anyOfClassL2: ["beer"] },
    notes: "Any beer; brand unconstrained.",
    confidence: "medium",
  },
  {
    id: "red-wine",
    query: "יין אדום",
    packQty: 1,
    category: "wine",
    accept: { requireTokens: ["יין"], forbidTokens: ["חולץ", "פותחן", "חומץ", "לבן", "רוזה"], anyOfClassL2: ["wine"] },
    notes:
      "Corkscrews (חולץ יין) are a documented trap. Also the bucket where גליל means Galilee, which one roll-count iteration misread as a pack count.",
    confidence: "high",
  },

  // --------------------------------------------------------------- household
  {
    id: "toilet-paper",
    query: "נייר טואלט",
    packQty: 1,
    category: "paper_goods",
    accept: {
      requireTokens: ["טואלט"],
      forbidTokens: ["לח", "מגבוני", "ממחטות"],
      anyOfClassL2: ["paper_goods"],
      anyOfPreparation: ["plain"],
      minNearbyStoreShare: 0.25,
    },
    notes:
      "Dry rolls. Two known failures: omitted entirely (the whole household aisle was unreachable), then billed as moist WIPES, which sit in 513-567 stores against 651 for rolls so availability cannot separate them.",
    confidence: "high",
  },
  {
    id: "paper-towels",
    query: "מגבות נייר",
    packQty: 1,
    category: "paper_goods",
    accept: { requireTokens: ["מגבות"], forbidTokens: ["טואלט"], anyOfClassL2: ["paper_goods"] },
    notes: "Kitchen towels, a different product from toilet paper in the same bucket.",
    confidence: "high",
  },
  {
    id: "dish-soap",
    query: "סבון כלים",
    packQty: 1,
    category: "cleaning",
    accept: { requireTokens: ["כלים"], anyOfClassL2: ["cleaning", "dishwashing"], minNearbyStoreShare: 0.2 },
    notes: "Washing-up liquid. Household queries were entirely unreachable before the non-food gate was fixed.",
    confidence: "medium",
  },
  {
    id: "laundry-powder",
    query: "אבקת כביסה",
    packQty: 1,
    category: "laundry",
    accept: { requireTokens: ["כביסה"], anyOfClassL2: ["laundry"], minNearbyStoreShare: 0.2 },
    notes:
      "Note the feed spells it כביסה. A misspelled אבקת כיבוס (0 of 122k products) resolved to אבקת שום (garlic powder) on the shared head אבקת; that is a separate known gap.",
    confidence: "high",
  },
  {
    id: "fabric-softener",
    query: "מרכך כביסה",
    packQty: 1,
    category: "laundry",
    accept: { requireTokens: ["מרכך"], anyOfClassL2: ["laundry"] },
    notes: "Softener, not detergent.",
    confidence: "medium",
  },

  // ------------------------------------------------------------ personal_care
  {
    id: "shampoo",
    query: "שמפו",
    packQty: 1,
    category: "hair",
    accept: { requireTokens: ["שמפו"], anyOfClassL2: ["hair"] },
    notes: "Shampoo. Personal-care queries must reach the non-food classes.",
    confidence: "medium",
  },
  {
    id: "toothpaste",
    query: "משחת שיניים",
    packQty: 1,
    category: "oral",
    accept: { requireTokens: ["שיניים"], forbidTokens: ["מברשת"], anyOfClassL2: ["oral"] },
    notes: "Paste, not a brush.",
    confidence: "medium",
  },

  // --------------------------------------------------------- snacks (controls)
  {
    id: "chocolate",
    query: "שוקולד",
    packQty: 1,
    category: "chocolate",
    accept: { requireTokens: ["שוקולד"], forbidTokens: ["ממרח", "חלב", "משקה"], anyOfClassL2: ["chocolate"] },
    notes: "A bar. שוקולד חלב is the top derived-form collision for the milk staple, so the reverse must still work.",
    confidence: "medium",
  },
  {
    id: "almonds",
    query: "שקדים",
    packQty: 1,
    category: "nuts_seeds",
    accept: { requireTokens: ["שקד"], forbidTokens: ["חלב", "משקה", "אוכמניות"], anyOfClassL2: ["nuts_seeds"] },
    notes: "Plain almonds, not almond milk or a fruit-and-nut mix.",
    confidence: "medium",
  },
];

/** Label lookup by id, for basket composition. */
export const LABELS_BY_ID = new Map(STAPLE_LABELS.map((l) => [l.id, l]));

/**
 * Realistic shopping occasions composed from the labels above.
 * Location is free text, the input the MCP contract tells agents to prefer.
 */
export const BENCHMARK_BASKETS: BenchmarkBasket[] = [
  {
    id: "weekly-large",
    name: "Weekly shop, family",
    location: "רחוב הבנים, הרצליה",
    labelIds: [
      "milk-3", "bread", "eggs-l", "cottage", "tomatoes", "cucumbers", "butter",
      "olive-oil", "rice", "tuna", "coke-1_5", "toilet-paper", "yogurt-plain",
      "yellow-cheese", "chicken", "pasta", "onion", "potato",
    ],
  },
  {
    id: "weekly-small",
    name: "Weekly shop, couple",
    location: "דיזנגוף, תל אביב",
    labelIds: [
      "milk-plain", "bread-white", "eggs-tray-12", "white-cheese", "tomatoes",
      "lemon", "coffee", "sugar", "pasta", "tuna", "yogurt-plain", "banana",
    ],
  },
  {
    id: "topup",
    name: "Small top-up",
    location: "סוקולוב, הרצליה",
    labelIds: ["milk-3", "bread", "eggs-l", "butter", "toilet-paper"],
  },
  {
    id: "breakfast",
    name: "Breakfast run",
    location: "ויצמן, כפר סבא",
    labelIds: ["milk-3", "eggs-l", "cottage", "white-cheese", "bread", "cereal", "coffee", "chocolate-spread", "yogurt-plain"],
  },
  {
    id: "bbq",
    name: "BBQ",
    location: "אחוזה, רעננה",
    labelIds: ["chicken", "ground-beef", "pita", "hummus", "tahini", "ketchup", "mayo", "beer", "coke-1_5", "cucumbers", "onion"],
  },
  {
    id: "cleaning",
    name: "Cleaning and household run",
    location: "רחוב הבנים, הרצליה",
    labelIds: ["toilet-paper", "paper-towels", "dish-soap", "laundry-powder", "fabric-softener", "shampoo", "toothpaste"],
  },
  {
    id: "pantry",
    name: "Pantry restock",
    location: "רחוב הבנים, הרצליה",
    labelIds: ["rice", "rice-basmati", "pasta", "flour", "sugar", "salt", "oil-cooking", "lentils", "tuna", "tomato-paste"],
  },
  {
    id: "produce",
    name: "Produce only",
    location: "בן גוריון, רמת גן",
    labelIds: ["tomatoes", "cucumbers", "onion", "potato", "carrot", "lemon", "banana", "apple"],
  },
  {
    id: "dairy",
    name: "Dairy aisle",
    location: "רחוב הבנים, הרצליה",
    labelIds: ["milk-3", "cottage", "cottage-5", "white-cheese", "yellow-cheese", "yogurt-plain", "butter", "cream", "eggs-l"],
  },
  {
    id: "controls",
    name: "Explicit-request controls",
    location: "רחוב הבנים, הרצליה",
    labelIds: [
      "cottage-5", "rice-basmati", "eggs-tray-12", "coke-zero", "olive-oil",
      "tomato-paste", "chicken-schnitzel", "challah", "salt", "red-wine", "apple",
    ],
  },
];
