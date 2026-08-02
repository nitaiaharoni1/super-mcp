export { query } from "./query.js";
export { knownStoreLocationsForChain } from "./stores.js";
export { upsertChain, upsertStore, type UpsertChainInput, type UpsertStoreInput } from "./chains.js";
export {
  resolveProduct,
  healSizeUnitFamily,
  refreshProductStoreCounts,
  type ResolveProductInput,
  type SizeUnitHealResult,
  type StoreCountRefreshResult,
} from "./products.js";
export {
  upsertListing,
  reapReclassifiedListing,
  type UpsertListingInput,
} from "./listings.js";
export { upsertStorePrice, type UpsertPriceInput } from "./prices.js";
export {
  reconcileStorePrices,
  MAX_RECONCILE_DELETE_RATIO,
  MIN_RECONCILE_SEEN_ROWS,
  type ReconcileStorePricesInput,
  type ReconcileStorePricesResult,
  type ReconcileSkipReason,
} from "./reconcile.js";
export {
  bulkResolveProducts,
  bulkUpsertListings,
  bulkUpsertStorePrices,
  type BatchProductInput,
  type BatchListingInput,
  type BatchPriceInput,
} from "./batchWrite.js";
export {
  purgeExpiredPromotions,
  upsertPromotion,
  type ExpiredPromoPurgeResult,
  type UpsertPromoInput,
} from "./promotions.js";
export { checkCatalogIntegrity, type CatalogIntegrityReport } from "./integrity.js";
export {
  backfillCentroids,
  upgradeStoreAddresses,
  distanceKm,
  type GeocodeCentroidResult,
  type GeocodeAddressResult,
  type GeocodeOptions,
  type GeocodeAddressOptions,
} from "./geocode.js";
export {
  resolveGeocodeQuery,
  type ResolveGeocodeQueryInput,
  type GeocodeResolveResult,
  type GeocodeResolveStatus,
  type GeocodeStrategy,
} from "./resolveGeocodeQuery.js";
export {
  geocodeCacheKey,
  normalizeGeocodeQuery,
  type GeocodeCacheRow,
} from "./geocodeCache.js";
export {
  osmAttribution,
  precisionFromNominatim,
  type GeocodePrecision,
  type NominatimSearchOutcome,
} from "./nominatim.js";
export {
  recordMisses,
  topMisses,
  type MatchMiss,
  type MissKind,
  type TopMissRow,
} from "./misses.js";
export {
  deactivateFulfillmentServicesExcept,
  findStoreIdByCode,
  listFulfillmentServices,
  listScrapedOnlineStores,
  upsertFulfillmentService,
  type FulfillmentServiceRow,
  type UpsertFulfillmentServiceInput,
} from "./fulfillment.js";
