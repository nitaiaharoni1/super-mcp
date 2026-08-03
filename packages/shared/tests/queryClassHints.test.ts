import { describe, expect, it } from "vitest";
import { intendedL3ForQuery, l2ForL3 } from "../src/intent/queryClassHints.js";

describe("the words a shopper types, mapped to the class the catalogue uses", () => {
  it("reads bin liners out of a query the catalogue never spells that way", () => {
    // The observed failure: "שקיות זבל" was filled with "שקיות זיפר L". The
    // catalogue files bin liners under "אשפה", so name similarity ranked the
    // ziplock bags first on the shared word "שקיות".
    expect(intendedL3ForQuery("שקיות זבל")).toBe("waste_bags");
    expect(intendedL3ForQuery("שקיות אשפה")).toBe("waste_bags");
    expect(intendedL3ForQuery("שקיות זיפר")).toBe("food_storage_bags");
  });

  it("survives the qualifiers a real line carries", () => {
    expect(intendedL3ForQuery("שקיות זבל גדולות 20 יח")).toBe("waste_bags");
  });

  it("keeps hand soap and body wash apart", () => {
    // Both were personal_care/hygiene with no L3, and this basket asks for the
    // two of them on separate lines.
    expect(intendedL3ForQuery("סבון ידיים")).toBe("hand_soap");
    expect(intendedL3ForQuery("סבון רחצה")).toBe("body_wash");
    // "אל סבון" stays out: the catalogue reads it as hand soap 63 times against
    // 15 body washes, so a hint would make the wrong reading confident.
    expect(intendedL3ForQuery("אל סבון")).toBeNull();
  });

  it("prefers the longer phrase so a specific reading is not shadowed", () => {
    // "סבון ידיים" contains "סבון"; the more specific entry has to win.
    expect(intendedL3ForQuery("סבון ידיים נוזלי")).toBe("hand_soap");
  });

  it("maps the chain's own word for ground coffee", () => {
    // Every unit of Rami Levy's ground coffee is called "קפה טורקי".
    expect(intendedL3ForQuery("קפה טורקי")).toBe("ground_coffee");
    expect(intendedL3ForQuery("קפה שחור")).toBe("ground_coffee");
    expect(intendedL3ForQuery("קפה נמס")).toBe("instant_coffee");
  });

  it("says nothing when the query is not unambiguous", () => {
    // A hint hard-narrows the pool, so silence has to be the default. A wrong
    // entry here is worse than a missing one.
    expect(intendedL3ForQuery("קינואה")).toBeNull();
    expect(intendedL3ForQuery("")).toBeNull();
    expect(intendedL3ForQuery("משהו שאין לו שום קשר")).toBeNull();
  });

  it("reports the owning L2 for a hint", () => {
    expect(l2ForL3("waste_bags")).toBe("disposables");
    expect(l2ForL3("not_a_real_l3")).toBeNull();
  });
});
