import type { BasketItemInput } from "../../services/basket/types.js";

/** Carrefour בעיר נווה עמל (4170) — confirmed incident branch. */
export const DEFAULT_NEVE_AMAL_STORE_ID = "e0099e24-af29-49c0-976d-97e15c398436";

export const BBQ_ITEMS: BasketItemInput[] = [
  { query: "פרגיות", amount: 1.75, unit: "kg" },
  { query: "קבבים", amount: 1.5, unit: "kg" },
  { query: "אנטרקוט", amount: 0.75, unit: "kg" },
  { query: "פיתות", amount: 20, unit: "יח" },
  { query: "חומוס", amount: 1.5, unit: "kg" },
  { query: "טחינה", amount: 0.5, unit: "kg" },
  { query: "מלח גס", packQty: 1 },
  { query: "עגבניות", amount: 1, unit: "kg" },
  { query: "מלפפונים", amount: 1, unit: "kg" },
  { query: "פלפל", amount: 3, unit: "יח" },
  { query: "בצל", amount: 3, unit: "יח" },
  { query: "חסה", amount: 1, unit: "יח" },
  { query: "לימון", amount: 4, unit: "יח" },
  { query: "אבטיח", amount: 1, unit: "יח" },
  { query: "קוקה קולה 1.5 ליטר", amount: 2, unit: "יח" },
  { query: "יין", amount: 3, unit: "יח" },
  { query: "טייסטרס צ׳ויס", packQty: 1 },
  { query: "שקית קרח", packQty: 1 },
];

/** Tahini, wine, and Taster's Choice line indexes in BBQ_ITEMS. */
export const TAHINI_INDEX = 5;
export const WINE_INDEX = 15;
export const TASTERS_INDEX = 16;
