import { XMLParser } from "fast-xml-parser";

export const feedParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  isArray: (name) =>
    ["Item", "Promotion", "Store", "ItemCode", "PromotionItems", "PromotionItem"].includes(name),
});
