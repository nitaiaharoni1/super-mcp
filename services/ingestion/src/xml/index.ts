import type { RawRecord } from "@super-mcp/shared";
import { decodeFeedBytes } from "./decode.js";
import { parseIlDate } from "./helpers.js";
import { parsePricesXml } from "./prices.js";
import { collectPromoItemCodes, parsePromosXml } from "./promos.js";
import { parseStoresXml } from "./stores.js";

export { decodeFeedBytes } from "./decode.js";
export { parseIlDate } from "./helpers.js";
export { parsePricesXml } from "./prices.js";
export { collectPromoItemCodes, parsePromosXml } from "./promos.js";
export { parseStoresXml } from "./stores.js";

export function parseFeedXml(
  xml: string,
  kind: string,
  chainId: string,
  storeId?: string,
): RawRecord[] {
  switch (kind) {
    case "stores":
      return parseStoresXml(xml, chainId);
    case "prices":
    case "pricesfull":
      return parsePricesXml(xml, chainId, storeId ?? "0");
    case "promos":
    case "promosfull":
      return parsePromosXml(xml, chainId, storeId ?? "0");
    case "other":
      return [];
    default: {
      const _exhaustive: never = kind as never;
      void _exhaustive;
      return [];
    }
  }
}
