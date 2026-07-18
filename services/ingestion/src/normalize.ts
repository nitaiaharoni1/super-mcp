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
  bulkResolveProducts,
  bulkUpsertListings,
  bulkUpsertStorePrices,
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

/** A fully-normalized price row awaiting a batched write. */
interface PriceBufferRow {
  identityKey: string; // gtin ?? sourceKey — product identity within the batch
  gtin: string | null;
  sourceKey: string | null;
  chainId: string;
  storeUuid: string;
  listingItemCode: string;
  itemType: number;
  isGtin: boolean;
  name: string;
  brand: string | null;
  rawQty: number | undefined;
  unitLabel: string | undefined;
  canonicalQty: number;
  canonicalUnit: string;
  measureUnparseable: boolean;
  sizeQty: number | null;
  sizeUnit: string | null;
  price: number;
  unitPrice: number | null;
  currency: string;
  allowDiscount: boolean | undefined;
  sourceTs: Date;
  // Reclassification reap key: delete the listing this item would occupy under
  // the other GTIN classification, in case its itemType/digit-length flipped.
  reapOtherItemCode: string;
}

const PRICE_BATCH_SIZE = 500;

export class Normalizer {
  private storeIds = new Map<string, string>(); // chainId:storeCode -> uuid
  private chainsUpserted = new Set<string>();
  private sourceId: string;
  private misses = new Map<string, MatchMiss>();
  private priceBuffer: PriceBufferRow[] = [];

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
        const wrote = await this.applyOne(record, stats);
        // Price rows are buffered and counted at flush time; store/promo rows
        // write immediately and are counted here.
        if (wrote) stats.rowsOk++;
        if (this.priceBuffer.length >= PRICE_BATCH_SIZE) await this.flushPrices(stats);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Abort the file so the pipeline can retry it from the beginning.
        // Upserts are idempotent, so rows committed before the disconnect are safe to replay.
        if (isTransientIngestionError(msg)) throw err;
        stats.rowsError++;
        if (stats.errors.length < 20) stats.errors.push(scrubNullChars(msg));
      }
    }
    // Flush any remaining buffered price rows (transient errors abort the file).
    await this.flushPrices(stats);
    try {
      await recordMisses([...this.misses.values()]);
      this.misses.clear();
    } catch {
      // Miss telemetry must never fail an ingest run.
    }
    return stats;
  }

  /**
   * Write buffered price rows as batched multi-row upserts (product → listing →
   * store_price). On a transient DB error the whole file is retried (rethrow);
   * on any other error we fall back to the per-row path so a single malformed
   * row is isolated and counted rather than dropping the whole batch.
   */
  private async flushPrices(stats: NormalizeStats): Promise<void> {
    const batch = this.priceBuffer;
    if (batch.length === 0) return;
    this.priceBuffer = [];

    try {
      // 1) Products: one row per identity key, longest name wins (matches the
      // ON CONFLICT election) so a key never appears twice in one statement.
      const productByKey = new Map<string, PriceBufferRow>();
      for (const r of batch) {
        const cur = productByKey.get(r.identityKey);
        if (!cur || r.name.length > cur.name.length) productByKey.set(r.identityKey, r);
      }
      const productIds = await bulkResolveProducts(
        [...productByKey.values()].map((r) => ({
          gtin: r.gtin,
          sourceKey: r.sourceKey,
          name: r.name,
          brand: r.brand,
          sizeQty: r.measureUnparseable ? null : r.sizeQty,
          sizeUnit: r.measureUnparseable ? null : r.sizeUnit,
        })),
      );

      // 2) Reap reclassified listings (rare; the helper self-guards to a no-op
      // for clean GTINs), then bulk-upsert listings — last row wins per key.
      for (const r of batch) {
        await reapReclassifiedListing(r.chainId, r.listingItemCode, r.reapOtherItemCode);
      }
      const listingByKey = new Map<string, PriceBufferRow>();
      for (const r of batch) listingByKey.set(`${r.chainId} ${r.listingItemCode}`, r);
      const listingIds = await bulkUpsertListings(
        [...listingByKey.values()].map((r) => ({
          productId: productIds.get(r.identityKey) ?? null,
          chainId: r.chainId,
          itemCode: r.listingItemCode,
          itemType: r.itemType,
          isGtin: r.isGtin,
          name: r.name,
          brand: r.brand,
          qty: r.rawQty ?? null,
          unit: r.unitLabel ?? null,
          canonicalQty: r.canonicalQty,
          canonicalUnit: r.canonicalUnit,
          measureUnparseable: r.measureUnparseable,
        })),
      );

      // 3) Store prices: last row wins per (listing, store).
      const priceByKey = new Map<string, { row: PriceBufferRow; listingId: string }>();
      for (const r of batch) {
        const listingId = listingIds.get(`${r.chainId} ${r.listingItemCode}`);
        if (!listingId) continue;
        priceByKey.set(`${listingId} ${r.storeUuid}`, { row: r, listingId });
      }
      await bulkUpsertStorePrices(
        [...priceByKey.values()].map(({ row, listingId }) => ({
          listingId,
          storeId: row.storeUuid,
          price: row.price,
          unitPrice: row.unitPrice,
          currency: row.currency,
          allowDiscount: row.allowDiscount ?? null,
          sourceTs: row.sourceTs,
        })),
      );

      stats.rowsOk += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTransientIngestionError(msg)) throw err;
      // Non-transient batch failure: replay row-by-row to isolate the bad row.
      await this.writePriceRowsIndividually(batch, stats);
    }
  }

  /** Per-row fallback preserving skip-bad-row-and-continue semantics. */
  private async writePriceRowsIndividually(
    batch: PriceBufferRow[],
    stats: NormalizeStats,
  ): Promise<void> {
    for (const r of batch) {
      try {
        const productId = await resolveProduct({
          gtin: r.gtin,
          sourceKey: r.gtin ? undefined : (r.sourceKey ?? undefined),
          name: r.name,
          brand: r.brand ?? undefined,
          sizeQty: r.measureUnparseable ? undefined : r.sizeQty ?? undefined,
          sizeUnit: r.measureUnparseable ? undefined : r.sizeUnit ?? undefined,
        });
        await reapReclassifiedListing(r.chainId, r.listingItemCode, r.reapOtherItemCode);
        const listingId = await upsertListing({
          productId,
          chainId: r.chainId,
          itemCode: r.listingItemCode,
          itemType: r.itemType,
          isGtin: r.isGtin,
          name: r.name,
          brand: r.brand ?? undefined,
          qty: r.rawQty,
          unit: r.unitLabel,
          canonicalQty: r.canonicalQty,
          canonicalUnit: r.canonicalUnit,
          measureUnparseable: r.measureUnparseable,
        });
        await upsertStorePrice({
          listingId,
          storeId: r.storeUuid,
          price: r.price,
          unitPrice: r.unitPrice ?? null,
          currency: r.currency,
          allowDiscount: r.allowDiscount,
          sourceTs: r.sourceTs,
        });
        stats.rowsOk++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isTransientIngestionError(msg)) throw err;
        stats.rowsError++;
        if (stats.errors.length < 20) stats.errors.push(scrubNullChars(msg));
      }
    }
  }

  /** Returns true when the record wrote immediately (store/promo), false when it
   *  was buffered for a batched flush (price). Callers count rowsOk accordingly. */
  private async applyOne(record: RawRecord, stats: NormalizeStats): Promise<boolean> {
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
          return true; // Stores XML is nationwide; only keep coverage cities
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
        return true;
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

        const chainId = scrubNullChars(record.chainId);
        // Chain-scoped identity for non-GTIN items so they aren't dropped entirely;
        // never merged across chains (SPEC non-goal: no cross-chain match for non-GTIN).
        const sourceKey = gtin ? null : `${chainId}:${itemCode}`;
        const listingItemCode = canonicalItemCode(record.itemType, itemCode);
        // Buffer for a batched write. unit_price carries ONLY our canonical
        // per-100g/100ml/unit math (the feed's UnitOfMeasurePrice mixes per-kg
        // and per-100g scales and corrupts unit-price sorts). The reap key is the
        // listing this item would occupy under the other GTIN classification.
        this.priceBuffer.push({
          identityKey: gtin ?? sourceKey!,
          gtin,
          sourceKey,
          chainId,
          storeUuid,
          listingItemCode,
          itemType: record.itemType,
          isGtin: gtinCapable,
          name,
          brand: brand ?? null,
          rawQty: record.qty,
          unitLabel,
          canonicalQty: unit.measure.quantity,
          canonicalUnit: unit.measure.unit,
          measureUnparseable: unit.measure.unparseable,
          sizeQty: unit.measure.quantity,
          sizeUnit: unit.measure.unit,
          price: record.price,
          unitPrice: unit.pricePerCanonical ?? null,
          currency: record.currency ?? "ILS",
          allowDiscount: record.allowDiscount,
          sourceTs: record.ts,
          reapOtherItemCode: gtin ? itemCode : normalizeGtin(itemCode),
        });
        return false; // counted at flush
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
        return true;
      }
      default: {
        const _exhaustive: never = record;
        throw new Error(`Unknown record kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
