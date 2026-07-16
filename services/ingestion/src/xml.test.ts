import { describe, expect, it } from "vitest";
import { parsePricesXml, parsePromosXml, parseStoresXml } from "./xml.js";

const storesXml = `<?xml version="1.0"?><Root><ChainId>7290027600007</ChainId>
<Stores><Store><StoreId>001</StoreId><StoreName>Test Store</StoreName><Address>A</Address><City>תל אביב</City></Store></Stores></Root>`;

const pricesXml = `<?xml version="1.0"?><Root><ChainId>7290027600007</ChainId><StoreId>001</StoreId>
<Item><ItemCode>7290000173199</ItemCode><ItemType>1</ItemType><ItemName>חלב</ItemName>
<ManufacturerName>תנובה</ManufacturerName><Quantity>1</Quantity><UnitQty>ליטר</UnitQty>
<ItemPrice>7.90</ItemPrice><bIsWeighted>0</bIsWeighted><AllowDiscount>1</AllowDiscount>
<PriceUpdateDate>2026-07-16</PriceUpdateDate></Item></Root>`;

const promosXml = `<?xml version="1.0"?><Root><ChainId>7290058140886</ChainId><StoreId>001</StoreId>
<Promotion><PromotionId>P1</PromotionId><PromotionDescription>2 ב-20 חלב</PromotionDescription>
<PromotionStartDate>2026-07-01</PromotionStartDate><PromotionEndDate>2026-07-31</PromotionEndDate>
<MinQty>2</MinQty><ItemCode>7290000173199</ItemCode></Promotion></Root>`;

describe("xml parsers", () => {
  it("parses stores", () => {
    const stores = parseStoresXml(storesXml, "7290027600007");
    expect(stores).toHaveLength(1);
    expect(stores[0]?.city).toBe("תל אביב");
  });

  it("parses prices", () => {
    const prices = parsePricesXml(pricesXml, "7290027600007", "001");
    expect(prices[0]?.itemCode).toBe("7290000173199");
    expect(prices[0]?.price).toBeCloseTo(7.9);
  });

  it("parses promos with n_for_price", () => {
    const promos = parsePromosXml(promosXml, "7290058140886", "001");
    expect(promos[0]?.mechanic.type).toBe("n_for_price");
    expect(promos[0]?.itemCodes).toContain("7290000173199");
  });
});
