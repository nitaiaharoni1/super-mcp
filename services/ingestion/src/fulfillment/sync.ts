/**
 * Load the curated delivery-terms catalogue into the database.
 *
 * The file is the source of truth; the tables are a projection of it. Running
 * this is therefore always safe and always idempotent, and reviewing a change to
 * the terms is reviewing a diff rather than an UPDATE somebody ran once.
 *
 *   pnpm ingest:fulfillment
 *   pnpm ingest:fulfillment -- --dry-run
 */
import {
  deactivateFulfillmentServicesExcept,
  findStoreIdByCode,
  upsertFulfillmentService,
} from "@super-mcp/db";
import type { CoverageRule, DeliveryTariffBand } from "@super-mcp/shared";
import { FULFILLMENT_CATALOG, type CatalogService } from "./catalog.js";

export interface SyncFulfillmentResult {
  written: number;
  /** Catalogue entries whose online store row is not in the database yet. */
  skippedMissingStore: string[];
  deactivated: number;
}

function toBands(service: CatalogService): DeliveryTariffBand[] {
  return service.tariffs.map((band) => ({
    slotType: band.slotType ?? "standard",
    minSubtotal: band.minSubtotal ?? null,
    maxSubtotal: band.maxSubtotal ?? null,
    fee: band.fee,
    membership: band.membership ?? null,
    feeIsFloor: band.feeIsFloor === true,
  }));
}

function toCoverage(service: CatalogService): CoverageRule[] {
  return service.coverage.map((rule) => ({
    scope: rule.scope,
    cityKey: rule.cityKey ?? null,
    centerLat: rule.centerLat ?? null,
    centerLng: rule.centerLng ?? null,
    radiusKm: rule.radiusKm ?? null,
    confidence: rule.confidence,
  }));
}

export async function syncFulfillmentCatalog(
  options: { dryRun?: boolean } = {},
): Promise<SyncFulfillmentResult> {
  const skippedMissingStore: string[] = [];
  const writtenSlugs: string[] = [];

  for (const service of FULFILLMENT_CATALOG) {
    const storeId = await findStoreIdByCode(service.chainId, service.storeCode);
    if (!storeId) {
      // Not an error: a chain's online row appears only after its Stores feed has
      // been ingested at least once. Reported so a permanently missing storefront
      // is visible rather than silently absent from every answer.
      skippedMissingStore.push(`${service.slug} (chain ${service.chainId} store ${service.storeCode})`);
      continue;
    }
    writtenSlugs.push(service.slug);
    if (options.dryRun) continue;

    await upsertFulfillmentService({
      slug: service.slug,
      chainId: service.chainId,
      storeId,
      brand: service.brand,
      serviceType: service.serviceType,
      marketplace: service.marketplace ?? null,
      storefrontUrl: service.storefrontUrl ?? null,
      minimumOrder: service.minimumOrder ?? null,
      minimumOrderKnown: service.minimumOrderKnown ?? true,
      serviceFee: service.serviceFee ?? null,
      termsConfidence: service.termsConfidence,
      termsVerifiedAt: service.verifiedAt ?? null,
      termsSourceUrl: service.sourceUrl ?? null,
      notes: service.notes ?? null,
      active: service.active ?? true,
      tariffs: toBands(service),
      coverage: toCoverage(service),
    });
  }

  // Every slug the catalogue DEFINES, not the ones this run wrote. A storefront
  // skipped because its store row was momentarily unresolvable is still defined,
  // and deactivating it would drop a live option from every answer until the next
  // successful run.
  const definedSlugs = FULFILLMENT_CATALOG.map((entry) => entry.slug);
  const deactivated = options.dryRun
    ? 0
    : await deactivateFulfillmentServicesExcept(definedSlugs);

  return { written: writtenSlugs.length, skippedMissingStore, deactivated };
}
