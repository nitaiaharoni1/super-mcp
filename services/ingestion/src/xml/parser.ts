import { XMLParser } from "fast-xml-parser";

export const feedParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  // Keep all tag text as strings. Numeric coercion (v5 default) turns "007"→7,
  // "1E5"→100000, "0x1F"→31, and rounds 16+ digit codes at the float boundary,
  // corrupting item-code / store identity. All consumers go through text()/num().
  parseTagValue: false,
  isArray: (name) =>
    ["Item", "Promotion", "Store", "ItemCode", "PromotionItems", "PromotionItem"].includes(name),
});
