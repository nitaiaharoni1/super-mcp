import type { BasketItemInput } from "../../src/services/basket/types.js";

export const TEL_AVIV_LOCATION = "רחוב בן גוריון, תל אביב";

export const TEL_AVIV_STAPLES_ITEMS: BasketItemInput[] = [
  { query: "חלב", packQty: 3 },
  { query: "ביצים תבנית 12", packQty: 1 },
  { query: "לחם", packQty: 2 },
  { query: "קוטג'", packQty: 2 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "תפוחי אדמה", amount: 2, unit: "kg" },
  { query: "עוף", amount: 1.5, unit: "kg" },
  { query: "אורז", amount: 1, unit: "kg" },
  { query: "שמן", amount: 1, unit: "L" },
];
