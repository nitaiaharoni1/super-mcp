import {
  computeUnitPrice,
  isGtinItem,
  normalizeGtin,
  type RawRecord,
} from "@super-mcp/shared";
import {
  resolveProduct,
  upsertChain,
  upsertListing,
  upsertPromotion,
  upsertStore,
  upsertStorePrice,
} from "@super-mcp/db";

const CHAIN_NAMES: Record<string, { he: string; en: string }> = {
  "7290027600007": { he: "שופרסל", en: "Shufersal" },
  "7290058140886": { he: "רמי לוי", en: "Rami Levy" },
  "7290803800003": { he: "יוחננוף", en: "Yohananof" },
  "7290103152017": { he: "אושר עד", en: "Osher Ad" },
  "7290873255550": { he: "טיב טעם", en: "Tiv Taam" },
  "7290700100008": { he: "חצי חינם", en: "Hazi Hinam" },
  "7290696200003": { he: "ויקטורי", en: "Victory" },
  "7290661400001": { he: "מחסני השוק", en: "Machsanei Hashuk" },
};

export interface NormalizeStats {
  rowsOk: number;
  rowsError: number;
  errors: string[];
}

/** Normalize chain-local store codes so "1" and "001" map to the same row. */
export function normalizeStoreCode(code: string): string {
  const trimmed = code.replace(/\u0000/g, "").trim();
  if (!trimmed || trimmed === "unknown") return trimmed;
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10)).padStart(3, "0");
  }
  return trimmed;
}

function scrub(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.replace(/\u0000/g, "").trim();
  return cleaned.length ? cleaned : undefined;
}

function scrubJson(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\u0000/g, "");
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.replace(/\u0000/g, "")] = scrubJson(v);
    }
    return out;
  }
  return value;
}

export class Normalizer {
  private storeIds = new Map<string, string>(); // chainId:storeCode -> uuid
  private sourceId: string;

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  async apply(records: AsyncIterable<RawRecord> | Iterable<RawRecord>): Promise<NormalizeStats> {
    const stats: NormalizeStats = { rowsOk: 0, rowsError: 0, errors: [] };
    for await (const record of records as AsyncIterable<RawRecord>) {
      try {
        await this.applyOne(record);
        stats.rowsOk++;
      } catch (err) {
        stats.rowsError++;
        const msg = err instanceof Error ? err.message : String(err);
        if (stats.errors.length < 20) stats.errors.push(msg.replace(/\u0000/g, ""));
      }
    }
    return stats;
  }

  private async applyOne(record: RawRecord): Promise<void> {
    const names = CHAIN_NAMES[record.chainId] ?? {
      he: record.chainId,
      en: record.chainId,
    };

    await upsertChain({
      id: record.chainId.replace(/\u0000/g, ""),
      sourceId: this.sourceId,
      market: "IL",
      nameHe: names.he,
      nameEn: names.en,
    });

    switch (record.kind) {
      case "store": {
        const storeCode = normalizeStoreCode(record.storeId);
        const id = await upsertStore({
          chainId: record.chainId.replace(/\u0000/g, ""),
          storeCode,
          name: scrub(record.name) ?? `Store ${storeCode}`,
          address: scrub(record.address),
          city: scrub(record.city),
          zip: scrub(record.zip),
          lat: record.geo?.lat,
          lng: record.geo?.lng,
        });
        this.storeIds.set(`${record.chainId}:${storeCode}`, id);
        return;
      }
      case "price": {
        const storeCode = normalizeStoreCode(record.storeId);
        if (!storeCode || storeCode === "unknown") {
          throw new Error(`Skipping price with invalid storeId=${record.storeId}`);
        }
        const storeKey = `${record.chainId}:${storeCode}`;
        let storeUuid = this.storeIds.get(storeKey);
        if (!storeUuid) {
          storeUuid = await upsertStore({
            chainId: record.chainId.replace(/\u0000/g, ""),
            storeCode,
            name: `Store ${storeCode}`,
          });
          this.storeIds.set(storeKey, storeUuid);
        }

        const name = scrub(record.name) ?? record.itemCode.replace(/\u0000/g, "");
        const brand = scrub(record.brand);
        const unitLabel = scrub(record.unit);
        const itemCode = record.itemCode.replace(/\u0000/g, "");
        const gtinCapable = isGtinItem(record.itemType, itemCode);
        const gtin = gtinCapable ? normalizeGtin(itemCode) : null;
        const unit = computeUnitPrice(
          record.price,
          record.qty,
          unitLabel,
          record.isWeighted,
        );

        const productId = await resolveProduct({
          gtin,
          name,
          brand,
          sizeQty: unit.measure.unparseable ? undefined : unit.measure.quantity,
          sizeUnit: unit.measure.unparseable ? undefined : unit.measure.unit,
        });

        const listingId = await upsertListing({
          productId,
          chainId: record.chainId.replace(/\u0000/g, ""),
          itemCode: gtin ?? itemCode,
          itemType: record.itemType,
          isGtin: gtinCapable,
          name,
          brand,
          qty: record.qty,
          unit: unitLabel,
          canonicalQty: unit.measure.quantity,
          canonicalUnit: unit.measure.unit,
          measureUnparseable: unit.measure.unparseable,
        });

        await upsertStorePrice({
          listingId,
          storeId: storeUuid,
          price: record.price,
          unitPrice: unit.pricePerCanonical,
          currency: record.currency ?? "ILS",
          allowDiscount: record.allowDiscount,
          sourceTs: record.ts,
        });
        return;
      }
      case "promo": {
        const storeCode = normalizeStoreCode(record.storeId);
        const storeKey = `${record.chainId}:${storeCode}`;
        let storeUuid = this.storeIds.get(storeKey) ?? null;
        if (!storeUuid && storeCode && storeCode !== "unknown") {
          storeUuid = await upsertStore({
            chainId: record.chainId.replace(/\u0000/g, ""),
            storeCode,
            name: `Store ${storeCode}`,
          });
          this.storeIds.set(storeKey, storeUuid);
        }
        await upsertPromotion({
          chainId: record.chainId.replace(/\u0000/g, ""),
          storeId: storeUuid,
          storeCode,
          promoCode: record.promoId.replace(/\u0000/g, ""),
          description: scrub(record.description) ?? record.promoId.replace(/\u0000/g, ""),
          mechanicType: record.mechanic.type,
          mechanicParams: scrubJson(record.mechanic.params) as Record<string, unknown>,
          rawText: scrub(record.mechanic.rawText),
          clubOnly: Boolean(record.clubOnly),
          startTs: record.startTs,
          endTs: record.endTs,
          sourceTs: record.ts,
          itemCodes: record.itemCodes.map((c) => c.replace(/\u0000/g, "")),
        });
        return;
      }
      default: {
        const _exhaustive: never = record;
        throw new Error(`Unknown record kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
