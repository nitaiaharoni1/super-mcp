/**
 * Labeled marketing sample derived from the BBQ / Neve Amal canary narrative.
 * Not live API data. All numbers are fixture values for UI proof only.
 */
export const DEMO_SAMPLE_LABEL = "דוגמה מסומנת · לא חי";

export const demoBasket = {
  label: DEMO_SAMPLE_LABEL,
  prompt: "מצא סל ברביקיו ל־18 אנשים ליד נווה עמל, הרצליה.",
  tool: "optimize_basket",
  location: "נווה עמל, הרצליה",
  statusFlow: ["needs_confirmation", "complete"] as const,
  question: {
    query: "קוקה קולה 1.5 ליטר",
    selectionEffect: "pin" as const,
    options: [
      { name: "קוקה קולה 1.5 ל׳", nearbyPricedStores: 4, minPrice: 6.9 },
      { name: "קוקה קולה זירו 1.5 ל׳", nearbyPricedStores: 3, minPrice: 7.2 },
      { name: "קוקה קולה זירו ליים 1.5 ל׳", nearbyPricedStores: 2, minPrice: 7.5 },
    ],
  },
  complete: {
    bestSingleStore: {
      storeName: "קארפור נווה עמל",
      chainName: "קארפור",
      total: 412.4,
      currency: "ILS",
      distanceKm: 0.8,
      pricedLines: 16,
      requestedLines: 18,
      coverageRatio: 16 / 18,
      missingItems: ["טייסטרס צ׳ויס", "שקית קרח"],
      freshness: {
        sourceTs: "2026-07-20T14:12:00+03:00",
        ingestedAt: "2026-07-20T14:40:00+03:00",
      },
      lines: [
        { name: "פרגיות", qty: "1.75 ק״ג", lineTotal: 78.75, unitPrice: 45 },
        { name: "פיתות ביתי", qty: "2 × 10 יח", lineTotal: 18.9, unitPrice: 0.95 },
        { name: "קוקה קולה 1.5 ל׳", qty: "2 יח", lineTotal: 13.8, unitPrice: 6.9 },
      ],
    },
    cheapestCompleteStore: {
      storeName: "רמי לוי הרצליה",
      chainName: "רמי לוי",
      total: 448.2,
      currency: "ILS",
      pricedLines: 18,
      requestedLines: 18,
      coverageRatio: 1,
      missingItems: [] as string[],
    },
    multiStore: {
      storeCount: 2,
      total: 399.1,
      currency: "ILS",
      pricedLines: 18,
      requestedLines: 18,
      coverageRatio: 1,
    },
  },
  normalization: {
    product: "קוקה קולה 1.5 ליטר",
    gtin: "7290112490463",
    listings: [
      { chain: "רמי לוי", rawName: "קוקה קולה 1.5 ליטר", rawQty: "1.5 ל" },
      { chain: "שופרסל", rawName: "קוקה-קולה בקבוק 1.5L", rawQty: "1500" },
      { chain: "ויקטורי", rawName: "Coca Cola 1.5", rawQty: "1.5L" },
    ],
    canonical: {
      displayName: "קוקה קולה 1.5 ל׳",
      size: "1500 ml",
      unitPricePer100ml: 0.46,
    },
  },
} as const;

export type DemoBasket = typeof demoBasket;
