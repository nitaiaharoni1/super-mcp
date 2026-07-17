import { describe, expect, it } from "vitest";
import {
  collectPromoItemCodes,
  decodeFeedBytes,
  parseIlDate,
  parsePricesXml,
  parsePromosXml,
  parseStoresXml,
} from "../src/xml.js";

const storesXml = `<?xml version="1.0"?><Root><ChainId>7290027600007</ChainId>
<Stores><Store><StoreId>001</StoreId><StoreName>Test Store</StoreName><Address>A</Address><City>תל אביב</City></Store></Stores></Root>`;

const shufersalChainStoresXml = `<?xml version="1.0" encoding="UTF-8"?>
<Chain><ChainID>7290027600007</ChainID><ChainName>שופרסל</ChainName>
<SubChains><SubChain><SubChainID>1</SubChainID>
<Stores><Store><StoreID>374</StoreID><StoreName>שלי הרצליה</StoreName>
<Address>הבנים 46</Address><City>6400</City><ZIPCode>4637948</ZIPCode></Store></Stores>
</SubChain></SubChains></Chain>`;

const pricesXml = `<?xml version="1.0"?><Root><ChainId>7290027600007</ChainId><StoreId>001</StoreId>
<Item><ItemCode>7290000173199</ItemCode><ItemType>1</ItemType><ItemName>חלב</ItemName>
<ManufacturerName>תנובה</ManufacturerName><Quantity>1</Quantity><UnitQty>ליטר</UnitQty>
<ItemPrice>7.90</ItemPrice><bIsWeighted>0</bIsWeighted><AllowDiscount>1</AllowDiscount>
<PriceUpdateDate>2026-07-16</PriceUpdateDate></Item></Root>`;

const promosXml = `<?xml version="1.0"?><Root><ChainId>7290058140886</ChainId><StoreId>001</StoreId>
<Promotion><PromotionId>P1</PromotionId><PromotionDescription>2 ב-20 חלב</PromotionDescription>
<PromotionStartDate>2026-07-01</PromotionStartDate><PromotionEndDate>2026-07-31</PromotionEndDate>
<MinQty>2</MinQty><ItemCode>7290000173199</ItemCode></Promotion></Root>`;

const nestedGroupsPromoXml = `<?xml version="1.0"?><Root><ChainId>7290055700007</ChainId><StoreId>009</StoreId>
<Promotion><PromotionID>G1</PromotionID><PromotionDescription>2 ב-10</PromotionDescription>
<PromotionStartDateTime>2026-07-01T00:00:00.000</PromotionStartDateTime>
<PromotionEndDateTime>2026-07-31T23:59:00.000</PromotionEndDateTime>
<Groups><Group><GroupID>1</GroupID>
<PromotionItems>
  <PromotionItem><ItemCode>7290110114853</ItemCode><ItemType>1</ItemType><MinQty>2</MinQty><DiscountedPrice>10</DiscountedPrice></PromotionItem>
  <PromotionItem><ItemCode>0000000000000</ItemCode><ItemType>1</ItemType></PromotionItem>
</PromotionItems></Group></Groups></Promotion></Root>`;

describe("parseIlDate", () => {
  it("returns null for empty / garbage input", () => {
    expect(parseIlDate("")).toBeNull();
    expect(parseIlDate("   ")).toBeNull();
    expect(parseIlDate("not-a-date")).toBeNull();
  });
});

describe("decodeFeedBytes", () => {
  it("decodes UTF-16 LE BOM Stores XML", () => {
    const xml = "<Root><Store><StoreID>002</StoreID><City>5000</City></Store></Root>";
    const bytes = Buffer.from(`\uFEFF${xml}`, "utf16le");
    const decoded = decodeFeedBytes(bytes);
    expect(decoded.startsWith("<Root>")).toBe(true);
    expect(parseStoresXml(decoded, "7290055700007")).toHaveLength(1);
  });
});

describe("xml parsers", () => {
  it("parses stores", () => {
    const stores = parseStoresXml(storesXml, "7290027600007");
    expect(stores).toHaveLength(1);
    expect(stores[0]?.city).toBe("תל אביב");
  });

  it("parses Shufersal <Chain> Stores with CBS city codes and ZIPCode", () => {
    const stores = parseStoresXml(shufersalChainStoresXml, "7290027600007");
    expect(stores).toHaveLength(1);
    expect(stores[0]?.storeId).toBe("374");
    expect(stores[0]?.city).toBe("6400");
    expect(stores[0]?.zip).toBe("4637948");
    expect(stores[0]?.name).toContain("הרצליה");
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

  it("parses nested Groups/PromotionItems and skips all-zero ItemCodes", () => {
    const promos = parsePromosXml(nestedGroupsPromoXml, "7290055700007", "009");
    expect(promos).toHaveLength(1);
    expect(promos[0]?.itemCodes).toEqual(["7290110114853"]);
    expect(promos[0]?.startTs.toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(promos[0]?.endTs.toISOString()).toBe("2026-07-31T20:59:00.000Z");
  });

  it("uses open-ended promo window when start/end dates are missing", () => {
    const xml = `<?xml version="1.0"?><Root><ChainId>7290058140886</ChainId><StoreId>001</StoreId>
<Promotion><PromotionId>P2</PromotionId><PromotionDescription>2 ב-20</PromotionDescription>
<ItemCode>7290000173199</ItemCode></Promotion></Root>`;
    const promos = parsePromosXml(xml, "7290058140886", "001");
    expect(promos[0]?.startTs.toISOString()).toBe("1999-12-31T22:00:00.000Z");
    expect(promos[0]?.endTs.getUTCFullYear()).toBe(2099);
    expect(promos[0]?.endTs.getTime()).toBeGreaterThan(Date.now());
  });

  it("collectPromoItemCodes unwraps array-wrapped Cerberus PromotionItems", () => {
    // Shape produced by fast-xml-parser when PromotionItems/ItemCode are isArray.
    const codes = collectPromoItemCodes({
      PromotionItems: [
        {
          Item: [
            { ItemCode: ["11073"], ItemType: 0 },
            { ItemCode: ["7290108078558"], ItemType: 1 },
          ],
        },
      ],
    });
    expect(codes).toEqual(["11073", "7290108078558"]);
  });

  // Feed timestamps are Asia/Jerusalem wall-clock with no offset. These must map
  // to the same UTC instant regardless of the runtime timezone (UTC on Cloud Run).
  it("parses price timestamps as Israel local time (winter UTC+2)", () => {
    const xml = pricesXml.replace(
      "<PriceUpdateDate>2026-07-16</PriceUpdateDate>",
      "<PriceUpdateDate>2024-01-15 08:00:00</PriceUpdateDate>",
    );
    const prices = parsePricesXml(xml, "7290027600007", "001");
    expect(prices[0]?.ts.toISOString()).toBe("2024-01-15T06:00:00.000Z");
  });

  it("parses price timestamps as Israel local time (summer DST UTC+3)", () => {
    const xml = pricesXml.replace(
      "<PriceUpdateDate>2026-07-16</PriceUpdateDate>",
      "<PriceUpdateDate>2024-07-15 08:00:00</PriceUpdateDate>",
    );
    const prices = parsePricesXml(xml, "7290027600007", "001");
    expect(prices[0]?.ts.toISOString()).toBe("2024-07-15T05:00:00.000Z");
  });

  it("parses promo start/end hour as Israel local time", () => {
    const xml = promosXml.replace(
      "<PromotionStartDate>2026-07-01</PromotionStartDate>",
      "<PromotionStartDate>2024-07-01</PromotionStartDate><PromotionStartHour>08:00</PromotionStartHour>",
    );
    const promos = parsePromosXml(xml, "7290058140886", "001");
    expect(promos[0]?.startTs.toISOString()).toBe("2024-07-01T05:00:00.000Z");
  });
});
