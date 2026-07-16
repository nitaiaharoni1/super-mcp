import { XMLParser } from "fast-xml-parser";
import iconv from "iconv-lite";
import { gunzipSync } from "node:zlib";
import {
  normalizePromoMechanic,
  type RawPriceRecord,
  type RawPromoRecord,
  type RawRecord,
  type RawStoreRecord,
} from "@super-mcp/shared";
import { dateFromIlWallClock } from "./ilDate.js";

export function decodeFeedBytes(bytes: Buffer): string {
  let buf = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    buf = gunzipSync(bytes);
  }
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD") && /<\?xml|<[A-Za-z]/.test(utf8)) {
    return utf8.replace(/^\uFEFF/, "");
  }
  return iconv.decode(buf, "windows-1255");
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value == null) return "";
  let s: string;
  if (typeof value === "object" && value !== null && "#text" in value) {
    s = String((value as { "#text": unknown })["#text"] ?? "");
  } else {
    s = String(value);
  }
  // Postgres rejects NUL (0x00) in text/varchar.
  return s.replace(/\u0000/g, "").trim();
}

function num(value: unknown): number | undefined {
  const n = Number(text(value).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseIlDate(dateStr: string, hourStr?: string): Date {
  const d = dateStr.trim();
  // YYYY-MM-DD or YYYY/MM/DD or DD/MM/YYYY, optionally followed by a time.
  let ymd: [number, number, number] | null = null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(d)) {
    const [yyyy, mm, dd] = d.slice(0, 10).replace(/\//g, "-").split("-");
    ymd = [Number(yyyy), Number(mm), Number(dd)];
  } else if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
    const [dd, mm, yyyy] = d.slice(0, 10).split("/");
    ymd = [Number(yyyy), Number(mm), Number(dd)];
  }

  if (ymd) {
    // Prefer an explicit hour arg (promo start/end hour), else the time embedded
    // in the date string itself (price feeds use "YYYY-MM-DD HH:MM:SS"), else midnight.
    // Anchored to start/space/"T" (not a bare \b) so a "T"-separated ISO fallback
    // (new Date().toISOString()) doesn't have its hour:minute skipped in favor of
    // the following minute:second pair -- \b alone doesn't break between "T" and a digit.
    const embedded = d.match(/(?:^|[ T])(\d{2}):(\d{2})(?::(\d{2}))?/);
    const hSrc = hourStr?.trim() || (embedded ? `${embedded[1]}:${embedded[2]}:${embedded[3] ?? "00"}` : "00:00:00");
    const hms = hSrc.length === 5 ? hSrc + ":00" : hSrc.length === 2 ? hSrc + ":00:00" : hSrc;
    const [hh, min, sec] = hms.split(":");
    const parsed = dateFromIlWallClock(
      ymd[0],
      ymd[1],
      ymd[2],
      Number(hh) || 0,
      Number(min) || 0,
      Number(sec) || 0,
    );
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  isArray: (name) =>
    ["Item", "Promotion", "Store", "ItemCode", "PromotionItems", "PromotionItem"].includes(name),
});

export function parseStoresXml(xml: string, chainId: string): RawStoreRecord[] {
  const doc = parser.parse(xml);
  const root = doc.Root ?? doc.Stores ?? doc;
  const subChains = asArray(root.SubChains?.SubChain ?? root.SubChain);
  const stores: RawStoreRecord[] = [];

  const pushStore = (s: Record<string, unknown>) => {
    const storeId = text(s.StoreId ?? s.StoreID);
    if (!storeId) return;
    const lat = num(s.Latitude ?? s.Lat ?? s.StoreLatitude);
    const lng = num(s.Longitude ?? s.Lng ?? s.Lon ?? s.StoreLongitude);
    stores.push({
      kind: "store",
      chainId: text(s.ChainId ?? root.ChainId) || chainId,
      storeId,
      name: text(s.StoreName ?? s.Name) || `Store ${storeId}`,
      address: text(s.Address) || undefined,
      city: text(s.City) || undefined,
      zip: text(s.ZipCode) || undefined,
      geo: lat != null && lng != null ? { lat, lng } : undefined,
      raw: s,
    });
  };

  if (subChains.length) {
    for (const sc of subChains) {
      const scObj = sc as Record<string, unknown>;
      const storesNode = scObj.Stores as Record<string, unknown> | undefined;
      for (const s of asArray(storesNode?.Store ?? scObj.Store)) {
        pushStore(s as Record<string, unknown>);
      }
    }
  } else {
    for (const s of asArray(root.Store ?? root.Stores?.Store)) {
      pushStore(s as Record<string, unknown>);
    }
  }
  return stores;
}

export function parsePricesXml(
  xml: string,
  chainId: string,
  storeId: string,
): RawPriceRecord[] {
  const doc = parser.parse(xml);
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
      ts: parseIlDate(text(it.PriceUpdateDate) || new Date().toISOString()),
      raw: it,
    });
  }
  return out;
}

export function parsePromosXml(
  xml: string,
  chainId: string,
  storeId: string,
): RawPromoRecord[] {
  const doc = parser.parse(xml);
  const root = doc.Root ?? doc.Promotions ?? doc;
  const resolvedChain = text(root.ChainId) || chainId;
  const resolvedStore = text(root.StoreId) || storeId;
  const promos = asArray(root.Promotion ?? root.Promotions?.Promotion);
  const out: RawPromoRecord[] = [];

  for (const promo of promos) {
    const p = promo as Record<string, unknown>;
    const promoId = text(p.PromotionId ?? p.PromotionID);
    if (!promoId) continue;
    const description = text(p.PromotionDescription ?? p.Description);
    const itemCodes = [
      ...asArray(p.ItemCode).map(text),
      ...asArray((p.PromotionItems as Record<string, unknown> | undefined)?.Item ?? p.PromotionItem)
        .map((x) => text((x as Record<string, unknown>).ItemCode ?? x))
        .filter(Boolean),
    ].filter(Boolean);

    const mechanic = normalizePromoMechanic({
      description,
      minQty: num(p.MinQty),
      maxQty: num(p.MaxQty),
      discountRate: num(p.DiscountRate),
      discountType: text(p.DiscountType) || undefined,
      minPurchaseAmount: num(p.MinPurchaseAmnt ?? p.MinPurchaseAmount),
      rewardType: text(p.RewardType) || undefined,
      discountedPrice: num(p.DiscountedPrice ?? p.PromotionPrice),
      clubId: text(p.ClubId ?? p.Clubs) || null,
      raw: p,
    });

    out.push({
      kind: "promo",
      chainId: resolvedChain,
      storeId: resolvedStore,
      promoId,
      description: description || promoId,
      mechanic,
      itemCodes,
      startTs: parseIlDate(text(p.PromotionStartDate), text(p.PromotionStartHour) || undefined),
      endTs: parseIlDate(text(p.PromotionEndDate), text(p.PromotionEndHour) || undefined),
      clubOnly: Boolean(p.ClubId && text(p.ClubId) !== "0"),
      ts: new Date(),
      raw: p,
    });
  }
  return out;
}

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
