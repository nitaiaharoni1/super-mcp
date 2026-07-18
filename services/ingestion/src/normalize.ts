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
  recordMisses,
  resolveProduct,
  upsertChain,
  upsertListing,
  upsertPromotion,
  upsertStore,
  upsertStorePrice,
  type MatchMiss,
} from "@super-mcp/db";
import { isStoreInIngestRegion, regionFilterEnabled } from "./regions.js";
import { normalizeStoreCode } from "./storeCode.js";
import { isTransientIngestionError } from "./transient.js";

export { normalizeStoreCode } from "./storeCode.js";

export interface NormalizeStats {
  rowsOk: number;
  rowsError: number;
  errors: string[];
  promoOther: number;
  unitUnparseable: number;
  regionFiltered: number;
}

export class Normalizer {
  private storeIds = new Map<string, string>(); // chainId:storeCode -> uuid
  private chainsUpserted = new Set<string>();
  private sourceId: string;
  private misses = new Map<string, MatchMiss>();

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  private noteMiss(kind: MatchMiss["kind"], term: string, context?: Record<string, unknown>): void {
    const key = `${kind} ${term}`;
    const existing = this.misses.get(key);
    if (existing) existing.count = (existing.count ?? 1) + 1;
    else this.misses.set(key, { kind, term, count: 1, context });
  }

  async apply(records: AsyncIterable<RawRecord> | Iterable<RawRecord>): Promise<NormalizeStats> {
    const stats: NormalizeStats = {
      rowsOk: 0,
      rowsError: 0,
      errors: [],
      promoOther: 0,
      unitUnparseable: 0,
      regionFiltered: 0,
    };
    for await (const record of records as AsyncIterable<RawRecord>) {
      try {
        await this.applyOne(record, stats);
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
    try {
      await recordMisses([...this.misses.values()]);
      this.misses.clear();
    } catch {
      // Miss telemetry must never fail an ingest run.
    }
    return stats;
  }

  private async applyOne(record: RawRecord, stats: NormalizeStats): Promise<void> {
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
          stats.regionFiltered++;
          // Key on the city alone: an unmatched city is the actionable alias
          // signal. A store with no city was dropped on geo/name grounds, not a
          // city-alias gap, so it counts but isn't proposed. Keying on the store
          // name would spam match_miss with a unique row per branch.
          const c = city?.trim();
          if (c) this.noteMiss("region_unmatched", c, { chainId: cleanChainId });
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
        if (unit.measure.unparseable) {
          stats.unitUnparseable++;
          // Record the unit label alone (not qty): the growth loop dedupes by the
          // unrecognized token to propose an alias. A missing label is a feed gap,
          // not an alias gap, so it counts but isn't proposed.
          const label = unitLabel?.trim();
          if (label) this.noteMiss("unit_unparseable", label, { chainId: cleanChainId });
        }

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
          // Only our canonical per-100g/100ml/unit math goes in unit_price.
          // The feed's UnitOfMeasurePrice is per-1kg/1L for some chains and
          // per-100g for others — mixing scales corrupted unit-price sorts
          // (₪51.6 "lemons"). Unparseable-unit rows keep price only; the miss
          // is already counted via unit_unparseable telemetry.
          unitPrice: unit.pricePerCanonical ?? null,
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
        if (record.mechanic.type === "other") {
          stats.promoOther++;
          this.noteMiss(
            "promo_other",
            (record.mechanic.rawText ?? record.description ?? "").slice(0, 120),
            { chainId: cleanChainId },
          );
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
