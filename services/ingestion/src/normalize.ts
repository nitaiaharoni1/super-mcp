import {
  canonicalItemCode,
  canonicalizeCity,
  computeUnitPrice,
  isGtinItem,
  lookupChainNames,
  normalizeGtin,
  scrubJson,
  scrubNullChars,
  scrubOptionalText,
  type RawRecord,
} from "@super-mcp/shared";
import {
  reapReclassifiedListing,
  resolveProduct,
  upsertChain,
  upsertListing,
  upsertPromotion,
  upsertStore,
  upsertStorePrice,
} from "@super-mcp/db";
import { isStoreInIngestRegion, regionFilterEnabled } from "./regions.js";
import { normalizeStoreCode } from "./storeCode.js";
import { isTransientIngestionError } from "./transient.js";

export { normalizeStoreCode } from "./storeCode.js";

export interface NormalizeStats {
  rowsOk: number;
  rowsError: number;
  errors: string[];
}

export class Normalizer {
  private storeIds = new Map<string, string>(); // chainId:storeCode -> uuid
  private chainsUpserted = new Set<string>();
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
        const msg = err instanceof Error ? err.message : String(err);
        // Abort the file so the pipeline can retry it from the beginning.
        // Upserts are idempotent, so rows committed before the disconnect are safe to replay.
        if (isTransientIngestionError(msg)) throw err;
        stats.rowsError++;
        if (stats.errors.length < 20) stats.errors.push(scrubNullChars(msg));
      }
    }
    return stats;
  }

  private async applyOne(record: RawRecord): Promise<void> {
    const names = lookupChainNames(record.chainId);

    const cleanChainId = scrubNullChars(record.chainId);
    if (!this.chainsUpserted.has(cleanChainId)) {
      await upsertChain({
        id: cleanChainId,
        sourceId: this.sourceId,
        market: "IL",
        nameHe: names.he,
        nameEn: names.en,
      });
      this.chainsUpserted.add(cleanChainId);
    }

    switch (record.kind) {
      case "store": {
        const storeCode = normalizeStoreCode(record.storeId);
        const name = scrubOptionalText(record.name) ?? `Store ${storeCode}`;
        const city = canonicalizeCity(scrubOptionalText(record.city));
        if (
          regionFilterEnabled() &&
          !isStoreInIngestRegion({
            storeId: storeCode,
            city,
            lat: record.geo?.lat,
            lng: record.geo?.lng,
            name,
          })
        ) {
          return; // Stores XML is nationwide; only keep coverage cities
        }
        const id = await upsertStore({
          chainId: scrubNullChars(record.chainId),
          storeCode,
          name,
          address: scrubOptionalText(record.address),
          city,
          zip: scrubOptionalText(record.zip),
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
          // Price files are already region-capped at discover time; stub is OK
          // when Stores XML lacked this branch (e.g. PublishPrice HTML portals).
          storeUuid = await upsertStore({
            chainId: scrubNullChars(record.chainId),
            storeCode,
            name: `Store ${storeCode}`,
          });
          this.storeIds.set(storeKey, storeUuid);
        }

        const name = scrubOptionalText(record.name) ?? scrubNullChars(record.itemCode);
        const brand = scrubOptionalText(record.brand);
        const unitLabel = scrubOptionalText(record.unit);
        const itemCode = scrubNullChars(record.itemCode);
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
          // Chain-scoped identity for non-GTIN items so they aren't dropped entirely;
          // never merged across chains (SPEC non-goal: no cross-chain match for non-GTIN).
          sourceKey: gtin ? undefined : `${record.chainId}:${itemCode}`,
          name,
          brand,
          sizeQty: unit.measure.unparseable ? undefined : unit.measure.quantity,
          sizeUnit: unit.measure.unparseable ? undefined : unit.measure.unit,
        });

        const chainId = scrubNullChars(record.chainId);
        const listingItemCode = canonicalItemCode(record.itemType, itemCode);
        // Clean up the row this item would have used under the other GTIN
        // classification, in case a borderline itemType/digit-length item
        // flipped classification since it was last ingested.
        await reapReclassifiedListing(chainId, listingItemCode, gtin ? itemCode : normalizeGtin(itemCode));

        const listingId = await upsertListing({
          productId,
          chainId,
          itemCode: listingItemCode,
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
          // Prefer our canonical unit math; fall back to the feed's UnitOfMeasurePrice
          // when Hebrew unit labels don't parse (common for "יחידות" / missing qty).
          unitPrice: unit.pricePerCanonical ?? record.unitPrice ?? null,
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
            chainId: scrubNullChars(record.chainId),
            storeCode,
            name: `Store ${storeCode}`,
          });
          this.storeIds.set(storeKey, storeUuid);
        }
        await upsertPromotion({
          chainId: scrubNullChars(record.chainId),
          storeId: storeUuid,
          storeCode,
          promoCode: scrubNullChars(record.promoId),
          description: scrubOptionalText(record.description) ?? scrubNullChars(record.promoId),
          mechanicType: record.mechanic.type,
          mechanicParams: scrubJson(record.mechanic.params) as Record<string, unknown>,
          rawText: scrubOptionalText(record.mechanic.rawText),
          clubOnly: Boolean(record.clubOnly),
          startTs: record.startTs,
          endTs: record.endTs,
          sourceTs: record.ts,
          itemCodes: record.itemCodes.map((c) =>
            // Promo feeds don't carry ItemType; assume barcode-capable (type 1) so a
            // padded GTIN maps to the same key the listing row is stored under.
            canonicalItemCode(1, scrubNullChars(c)),
          ),
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
