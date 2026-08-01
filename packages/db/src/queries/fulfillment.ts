import type { CoverageRule, DeliveryTariffBand, ServiceFeeRule, TermsConfidence } from "@super-mcp/shared";
import { getPool } from "../client/index.js";
import { query } from "./query.js";

export interface FulfillmentServiceRow {
  id: string;
  slug: string;
  brand: string;
  serviceType: "delivery" | "pickup" | "marketplace";
  marketplace: string | null;
  storefrontUrl: string | null;
  chainId: string;
  chainName: string;
  /** The feed's online store row whose prices this service delivers. */
  storeId: string | null;
  storeName: string | null;
  minimumOrder: number | null;
  minimumOrderKnown: boolean;
  serviceFee: ServiceFeeRule | null;
  currency: string;
  termsConfidence: TermsConfidence;
  termsVerifiedAt: Date | null;
  termsSourceUrl: string | null;
  termsSource: "curated" | "scraped";
  notes: string | null;
  tariffs: DeliveryTariffBand[];
  coverage: CoverageRule[];
}

interface ServiceSqlRow {
  id: string;
  slug: string;
  brand: string;
  service_type: string;
  marketplace: string | null;
  storefront_url: string | null;
  chain_id: string;
  chain_name: string;
  store_id: string | null;
  store_name: string | null;
  minimum_order: string | null;
  minimum_order_known: boolean;
  service_fee_percent: string | null;
  service_fee_min: string | null;
  service_fee_max: string | null;
  currency: string;
  terms_confidence: TermsConfidence;
  terms_verified_at: Date | null;
  terms_source_url: string | null;
  terms_source: "curated" | "scraped";
  notes: string | null;
  tariffs: unknown;
  coverage: unknown;
}

/** Postgres numerics arrive as strings; a silent Number(null) would become 0. */
function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapService(row: ServiceSqlRow): FulfillmentServiceRow {
  const percent = num(row.service_fee_percent);
  const feeMin = num(row.service_fee_min);
  const feeMax = num(row.service_fee_max);
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    serviceType: row.service_type as FulfillmentServiceRow["serviceType"],
    marketplace: row.marketplace,
    storefrontUrl: row.storefront_url,
    chainId: row.chain_id,
    chainName: row.chain_name,
    storeId: row.store_id,
    storeName: row.store_name,
    minimumOrder: num(row.minimum_order),
    minimumOrderKnown: row.minimum_order_known,
    serviceFee:
      percent != null && feeMin != null && feeMax != null
        ? { percent, min: feeMin, max: feeMax }
        : null,
    currency: row.currency,
    termsConfidence: row.terms_confidence,
    termsVerifiedAt: row.terms_verified_at,
    termsSourceUrl: row.terms_source_url,
    termsSource: row.terms_source,
    notes: row.notes,
    tariffs: Array.isArray(row.tariffs) ? (row.tariffs as DeliveryTariffBand[]) : [],
    coverage: Array.isArray(row.coverage) ? (row.coverage as CoverageRule[]) : [],
  };
}

/**
 * Every active fulfilment service, with its tariff bands and service area.
 *
 * Aggregated in one query rather than N+1: the whole set is a dozen or so rows
 * with a handful of bands each, and the optimiser needs all of them to compare
 * storefronts. The json_agg FILTER clauses keep a service with no tariffs (terms
 * not yet established) as an empty array rather than [null] — that distinction is
 * load-bearing downstream, where it is the difference between "free" and
 * "unknown".
 */
export async function listFulfillmentServices(options: {
  chainId?: string;
  slug?: string;
  includeUnpriced?: boolean;
} = {}): Promise<FulfillmentServiceRow[]> {
  const where: string[] = ["fs.active"];
  const params: unknown[] = [];
  if (options.chainId) {
    params.push(options.chainId);
    where.push(`fs.chain_id = $${params.length}`);
  }
  if (options.slug) {
    params.push(options.slug);
    where.push(`fs.slug = $${params.length}`);
  }
  // A service with no store row has no priced catalogue behind it, so it can be
  // described but never used to total a basket. Excluded by default so the
  // optimiser cannot quote a figure it has no prices for.
  if (!options.includeUnpriced) where.push("fs.store_id IS NOT NULL");

  const res = await query<ServiceSqlRow>(
    `SELECT fs.id, fs.slug, fs.brand, fs.service_type, fs.marketplace, fs.storefront_url,
            fs.chain_id, c.name_he AS chain_name,
            fs.store_id, s.name AS store_name,
            fs.minimum_order, fs.minimum_order_known,
            fs.service_fee_percent, fs.service_fee_min, fs.service_fee_max,
            fs.currency, fs.terms_confidence, fs.terms_verified_at, fs.terms_source_url, fs.terms_source, fs.notes,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'slotType', dt.slot_type,
                       'minSubtotal', dt.min_subtotal,
                       'maxSubtotal', dt.max_subtotal,
                       'fee', dt.fee,
                       'membership', dt.membership,
                       'feeIsFloor', dt.fee_is_floor
                     ) ORDER BY dt.slot_type, dt.min_subtotal NULLS FIRST)
              FROM delivery_tariff dt WHERE dt.service_id = fs.id
            ), '[]'::json) AS tariffs,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'scope', dc.scope,
                       'cityKey', dc.city_key,
                       'centerLat', dc.center_lat,
                       'centerLng', dc.center_lng,
                       'radiusKm', dc.radius_km,
                       'geojson', dc.geojson,
                       'confidence', dc.confidence
                     ))
              FROM delivery_coverage dc WHERE dc.service_id = fs.id
            ), '[]'::json) AS coverage
     FROM fulfillment_service fs
     JOIN chain c ON c.id = fs.chain_id
     LEFT JOIN store s ON s.id = fs.store_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.name_he, fs.brand`,
    params,
  );
  // json_build_object emits numerics as JSON numbers already; only the top-level
  // columns come back as strings, and mapService handles those.
  return res.rows.map(mapService);
}

export interface UpsertFulfillmentServiceInput {
  slug: string;
  chainId: string;
  storeId: string | null;
  brand: string;
  serviceType: string;
  marketplace?: string | null;
  storefrontUrl?: string | null;
  minimumOrder?: number | null;
  minimumOrderKnown: boolean;
  serviceFee?: ServiceFeeRule | null;
  termsConfidence: TermsConfidence;
  termsVerifiedAt?: string | null;
  termsSourceUrl?: string | null;
  /** curated = hand-read and TTL'd; scraped = re-derived every ingest. */
  termsSource?: "curated" | "scraped";
  notes?: string | null;
  active: boolean;
  tariffs: DeliveryTariffBand[];
  coverage: CoverageRule[];
}

/**
 * Write one curated service and replace its bands and coverage wholesale.
 *
 * Replace rather than merge: the catalogue file is the source of truth, and a
 * merge would leave a band that was deleted upstream silently in force — exactly
 * the stale-terms failure this whole subsystem exists to avoid. One transaction,
 * so a service never exists with half its tariff.
 */
export async function upsertFulfillmentService(
  input: UpsertFulfillmentServiceInput,
): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ id: string }>(
      `INSERT INTO fulfillment_service (
         slug, chain_id, store_id, brand, service_type, marketplace, storefront_url,
         minimum_order, minimum_order_known,
         service_fee_percent, service_fee_min, service_fee_max,
         terms_confidence, terms_verified_at, terms_source_url, terms_source, notes, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (slug) DO UPDATE SET
         chain_id = EXCLUDED.chain_id,
         store_id = EXCLUDED.store_id,
         brand = EXCLUDED.brand,
         service_type = EXCLUDED.service_type,
         marketplace = EXCLUDED.marketplace,
         storefront_url = EXCLUDED.storefront_url,
         minimum_order = EXCLUDED.minimum_order,
         minimum_order_known = EXCLUDED.minimum_order_known,
         service_fee_percent = EXCLUDED.service_fee_percent,
         service_fee_min = EXCLUDED.service_fee_min,
         service_fee_max = EXCLUDED.service_fee_max,
         terms_confidence = EXCLUDED.terms_confidence,
         terms_verified_at = EXCLUDED.terms_verified_at,
         terms_source_url = EXCLUDED.terms_source_url,
         terms_source = EXCLUDED.terms_source,
         notes = EXCLUDED.notes,
         active = EXCLUDED.active,
         updated_at = now()
       RETURNING id`,
      [
        input.slug,
        input.chainId,
        input.storeId,
        input.brand,
        input.serviceType,
        input.marketplace ?? null,
        input.storefrontUrl ?? null,
        input.minimumOrder ?? null,
        input.minimumOrderKnown,
        input.serviceFee?.percent ?? null,
        input.serviceFee?.min ?? null,
        input.serviceFee?.max ?? null,
        input.termsConfidence,
        input.termsVerifiedAt ?? null,
        input.termsSourceUrl ?? null,
        input.termsSource ?? "curated",
        input.notes ?? null,
        input.active,
      ],
    );
    const id = res.rows[0]!.id;

    await client.query(`DELETE FROM delivery_tariff WHERE service_id = $1`, [id]);
    for (const band of input.tariffs) {
      await client.query(
        `INSERT INTO delivery_tariff (service_id, slot_type, min_subtotal, max_subtotal, fee, membership, fee_is_floor)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          band.slotType,
          band.minSubtotal,
          band.maxSubtotal,
          band.fee,
          band.membership,
          band.feeIsFloor === true,
        ],
      );
    }

    await client.query(`DELETE FROM delivery_coverage WHERE service_id = $1`, [id]);
    for (const rule of input.coverage) {
      await client.query(
        `INSERT INTO delivery_coverage (service_id, scope, city_key, center_lat, center_lng, radius_km, geojson, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          rule.scope,
          rule.cityKey ?? null,
          rule.centerLat ?? null,
          rule.centerLng ?? null,
          rule.radiusKm ?? null,
          rule.geojson == null ? null : JSON.stringify(rule.geojson),
          rule.confidence,
        ],
      );
    }

    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Resolve a chain's online store row by its feed store code, for catalogue sync. */
export async function findStoreIdByCode(
  chainId: string,
  storeCode: string,
): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM store WHERE chain_id = $1 AND store_code = $2`,
    [chainId, storeCode],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Mark services absent from the catalogue inactive rather than deleting history.
 *
 * `slugs` MUST be every slug the catalogue defines, not the subset this run
 * managed to write. Passing the successes turns a transient lookup miss into a
 * deactivation: a storefront whose `store` row is briefly unresolvable (renumbered
 * code, Stores XML not yet re-ingested) would vanish from every answer despite
 * still being defined.
 *
 * The empty-list case is refused outright rather than handled. In Postgres
 * `slug = ANY('{}')` is always false, so `NOT (...)` is always true and the WHERE
 * clause collapses to `active` — one call would deactivate every storefront in the
 * database and `/mcp/online` would confidently report that nobody delivers
 * anywhere. A catalogue with no entries is a bug in the caller, never an
 * instruction to switch the product off.
 */
export async function deactivateFulfillmentServicesExcept(
  slugs: string[],
): Promise<number> {
  if (slugs.length === 0) {
    throw new Error(
      "deactivateFulfillmentServicesExcept refuses an empty keep-list: that would " +
        "deactivate every fulfillment service. Pass every slug the catalogue defines.",
    );
  }
  const res = await query(
    `UPDATE fulfillment_service SET active = false, updated_at = now()
     WHERE active AND NOT (slug = ANY($1::text[]))`,
    [slugs],
  );
  return res.rowCount ?? 0;
}

/** Online stores created by a scrape, with the raw payload the adapter stored. */
export async function listScrapedOnlineStores(
  sourceIds: string[],
): Promise<Array<{ storeId: string; chainId: string; chainName: string; storeCode: string; name: string; city: string | null; lat: number | null; lng: number | null }>> {
  const res = await query<{
    id: string;
    chain_id: string;
    chain_name: string;
    store_code: string;
    name: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
  }>(
    `SELECT s.id, s.chain_id, c.name_he AS chain_name, s.store_code, s.name, s.city, s.lat, s.lng
       FROM store s JOIN chain c ON c.id = s.chain_id
      WHERE c.source_id = ANY($1::text[])
        AND s.store_kind IN ('online', 'pickup')`,
    [sourceIds],
  );
  return res.rows.map((r) => ({
    storeId: r.id,
    chainId: r.chain_id,
    chainName: r.chain_name,
    storeCode: r.store_code,
    name: r.name,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
  }));
}
