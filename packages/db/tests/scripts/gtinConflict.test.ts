import { describe, expect, it } from "vitest";
import {
  classifyConflict,
  nameSimilarity,
  pickListingsToQuarantine,
  sourceKeyForListing,
  type ListingConflictSide,
} from "../../src/scripts/lib/gtinConflict.js";

describe("nameSimilarity", () => {
  it("is high for near-identical Hebrew names", () => {
    expect(nameSimilarity("לחמניה רגילה", "לחמניה רגילה")).toBe(1);
    expect(nameSimilarity("לחמניה רגילה", "לחמניה")).toBeGreaterThan(0.5);
  });

  it("is near-zero for unrelated names (sausages vs bun)", () => {
    const sim = nameSimilarity("נקניקיות הודו", "לחמניה ארוכה");
    expect(sim).toBeLessThan(0.2);
  });

  it("is near-zero for pastrami vs chocolate snacks", () => {
    const sim = nameSimilarity("פסטרמה דק דק", "חטיפי שוקולד");
    expect(sim).toBeLessThan(0.2);
  });

  it("stays high for truncated / spelling-variant same SKU", () => {
    expect(nameSimilarity("נילון נצמד30+91", "ניילון נצמד 30+91 מט")).toBeGreaterThan(0.2);
    expect(nameSimilarity("פייבר וואן 555 גרם", "פייבר1- דגני בוקר עת")).toBeGreaterThan(0.15);
  });
});

describe("classifyConflict", () => {
  it("flags dissimilar names as severe when sim < 0.1", () => {
    const c = classifyConflict({
      gtin: "7290000000465",
      productId: "p1",
      productName: "נקניקיות טליאצי",
      listingId: "l1",
      chainId: "carrefour",
      itemCode: "7290000000465",
      listingName: "לחמניה שמינייה",
      classL1Listing: null,
      classL1Product: null,
    });
    expect(c).not.toBeNull();
    expect(c!.reason).toBe("name_dissimilar");
    expect(c!.severe).toBe(true);
    expect(c!.nameSimilarity).toBeLessThan(0.1);
  });

  it("flags class_l1 mismatch even with moderate name overlap", () => {
    const c = classifyConflict({
      gtin: "x",
      productId: "p1",
      productName: "קפה עלית",
      listingId: "l1",
      chainId: "c",
      itemCode: "1",
      listingName: "קפה נמס עלית",
      classL1Listing: "produce",
      classL1Product: "pantry",
      nameThreshold: 0.05,
    });
    expect(c).not.toBeNull();
    expect(c!.reason).toBe("class_l1_mismatch");
  });
});

describe("pickListingsToQuarantine", () => {
  it("quarantines the mismatched chain listing and keeps the close match", () => {
    const sides: ListingConflictSide[] = [
      {
        listingId: "l-good",
        chainId: "shufersal",
        itemCode: "7290000000465",
        listingName: "לחמניה ארוכה",
        productId: "p1",
        productName: "לחמניה ארוכה",
        productGtin: "7290000000465",
        listingClassL1: "bakery",
        productClassL1: "bakery",
      },
      {
        listingId: "l-bad",
        chainId: "carrefour",
        itemCode: "7290000000465",
        listingName: "נקניקיות הודו",
        productId: "p1",
        productName: "לחמניה ארוכה",
        productGtin: "7290000000465",
        listingClassL1: "meat",
        productClassL1: "bakery",
      },
    ];
    const picked = pickListingsToQuarantine(sides);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.listingId).toBe("l-bad");
    expect(picked[0]!.severe).toBe(true);
  });

  it("keeps the best listing when every side conflicts with product name", () => {
    const sides: ListingConflictSide[] = [
      {
        listingId: "l1",
        chainId: "a",
        itemCode: "1",
        listingName: "נקניקיות",
        productId: "p",
        productName: "לחמניה",
        productGtin: "g",
        listingClassL1: null,
        productClassL1: null,
      },
      {
        listingId: "l2",
        chainId: "b",
        itemCode: "1",
        listingName: "לחמניה רגילה",
        productId: "p",
        productName: "לחמניה",
        productGtin: "g",
        listingClassL1: null,
        productClassL1: null,
      },
    ];
    // l2 is close enough that it may not be a conflict; force product name far from both
    const far: ListingConflictSide[] = [
      {
        ...sides[0]!,
        productName: "משהו אחר לגמרי",
      },
      {
        ...sides[1]!,
        productName: "משהו אחר לגמרי",
        listingName: "עוד משהו שונה",
      },
    ];
    const picked = pickListingsToQuarantine(far);
    expect(picked.length).toBe(1);
  });
});

describe("sourceKeyForListing", () => {
  it("builds chain:item_code", () => {
    expect(sourceKeyForListing("7290055678550", "123")).toBe("7290055678550:123");
  });
});
