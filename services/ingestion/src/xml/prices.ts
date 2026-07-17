import type { RawPriceRecord } from "@super-mcp/shared";
import { asArray, num, parseIlDate, text } from "./helpers.js";
import { feedParser } from "./parser.js";

export function parsePricesXml(
  xml: string,
  chainId: string,
  storeId: string,
): RawPriceRecord[] {
  const doc = feedParser.parse(xml);
  const root = doc.Root ?? doc.Items ?? doc;
  const resolvedChain = text(root.ChainId) || chainId;
  // Prefer StoreId from XML body over filename guess (avoids "unknown").
  const resolvedStore = text(root.StoreId) || storeId;
  if (!resolvedStore || resolvedStore === "unknown") {
    return [];
  }
  const items = asArray(root.Item ?? root.Items?.Item);
  const out: RawPriceRecord[] = [];

  for (const item of items) {
    const it = item as Record<string, unknown>;
    const itemCode = text(it.ItemCode);
    const price = num(it.ItemPrice);
    if (!itemCode || price == null) continue;
    out.push({
      kind: "price",
      chainId: resolvedChain,
      storeId: resolvedStore,
      itemCode,
      itemType: num(it.ItemType) ?? 1,
      name: text(it.ItemName ?? it.ManufacturerItemDescription) || itemCode,
      brand: text(it.ManufacturerName) || undefined,
      qty: num(it.Quantity),
      unit: text(it.UnitQty ?? it.UnitOfMeasure) || undefined,
      isWeighted: text(it.bIsWeighted) === "1" || text(it.bIsWeighted).toLowerCase() === "true",
      price,
      unitPrice: num(it.UnitOfMeasurePrice),
      allowDiscount: text(it.AllowDiscount) === "1" || text(it.AllowDiscount).toLowerCase() === "true",
      currency: "ILS",
      // Missing PriceUpdateDate → ingest clock (true UTC instant), not a fake IL wall time.
      ts: parseIlDate(text(it.PriceUpdateDate)) ?? new Date(),
      raw: it,
    });
  }
  return out;
}
