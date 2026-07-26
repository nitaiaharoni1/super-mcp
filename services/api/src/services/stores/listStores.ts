import { query } from "@super-mcp/db";
import { displayCity, type StoreKind } from "@super-mcp/shared";
import type { GeoPoint } from "../../lib/geo.js";
import { storeLocationSql } from "../../lib/storeLocationSql.js";

export interface ChainSummary {
  id: string;
  sourceId: string;
  market: string;
  nameHe: string;
  nameEn: string | null;
  currency: string;
}

interface ChainRow {
  id: string;
  source_id: string;
  market: string;
  name_he: string;
  name_en: string | null;
  currency: string;
}

function mapChain(row: ChainRow): ChainSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    market: row.market,
    nameHe: row.name_he,
    nameEn: row.name_en,
    currency: row.currency,
  };
}

export async function listChains(): Promise<ChainSummary[]> {
  const res = await query<ChainRow>(
    `SELECT id, source_id, market, name_he, name_en, currency FROM chain ORDER BY name_he ASC`,
  );
  return res.rows.map(mapChain);
}

export interface StoreSummary {
  id: string;
  chainId: string;
  chainName: string;
  storeCode: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  /** Provenance of lat/lng: address | feed | city_centroid | null. */
  geoSource: string | null;
  /**
   * Fulfilment kind (migration 023). Only `branch` is somewhere a shopper can
   * walk into — the online/warehouse rows hold the three deepest price catalogs
   * in the feed and would otherwise be recommended as "your store".
   */
  storeKind: StoreKind | null;
  distanceKm: number | null;
}

interface StoreRow {
  id: string;
  chain_id: string;
  chain_name: string;
  store_code: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  geo_source: string | null;
  store_kind: string | null;
  distance_km: number | null;
}

function mapStore(row: StoreRow): StoreSummary {
  return {
    id: row.id,
    chainId: row.chain_id,
    chainName: row.chain_name,
    storeCode: row.store_code,
    name: row.name,
    address: row.address,
    city: displayCity(row.city),
    zip: row.zip,
    lat: row.lat,
    lng: row.lng,
    geoSource: row.geo_source,
    storeKind: (row.store_kind as StoreKind | null) ?? null,
    distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
  };
}

export interface ListStoresParams {
  chain?: string;
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
  /**
   * Restrict to physical branches. Basket optimization sets this so online and
   * warehouse rows never enter pricing or the `storesCompared` count; the public
   * store directory leaves it off and labels each row with `storeKind` instead.
   */
  shoppableOnly?: boolean;
}

export async function listStores(params: ListStoresParams): Promise<StoreSummary[]> {
  const sqlParams: unknown[] = [];
  const conditions: string[] = [];
  let distanceSelect = "NULL::double precision AS distance_km";

  if (params.chain) {
    sqlParams.push(params.chain);
    conditions.push(`st.chain_id = $${sqlParams.length}`);
  }
  if (params.storeIds) {
    sqlParams.push(params.storeIds);
    conditions.push(`st.id = ANY($${sqlParams.length}::uuid[])`);
  }
  if (params.shoppableOnly) {
    // NULL store_kind is treated as a branch so an unclassified backlog never
    // silently empties the candidate set.
    conditions.push(`(st.store_kind IS NULL OR st.store_kind = 'branch')`);
    // Exclude branches the ingest never refreshes. They exist only because the
    // 2026-07-18 backfill ran nationally with the region filter off; measured
    // 2026-07-26, 277 of 888 branches sit outside the covered metros with prices
    // frozen at 07-18 and no prospect of an update. Quoting a month-old price as
    // if it were current is worse than saying nothing.
    //
    // NULL means not yet evaluated and stays visible, so the column appearing
    // before the marking script runs can never blank out the store list. The
    // public directory (shoppableOnly off) still shows everything, labelled.
    conditions.push(`st.in_coverage IS NOT FALSE`);
  }

  const location = storeLocationSql(
    { city: params.city, near: params.near, radiusKm: params.radiusKm },
    sqlParams,
  );
  conditions.push(...location.conditions);
  if (params.near) {
    distanceSelect = location.distanceSelect;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // Unique tiebreaker: two branches at an identical distance (or same city+name)
  // would otherwise come back in an arbitrary order, and the basket now SLICES this
  // list — RESOLUTION_SIGNAL_STORE_SAMPLE takes the nearest N — so an unstable
  // order would make the same request resolve differently between calls, including
  // between an initial call and its resume.
  const orderBy = params.near
    ? "distance_km ASC, st.id ASC"
    : "st.city ASC, st.name ASC, st.id ASC";

  const res = await query<StoreRow>(
    `SELECT st.id, st.chain_id, c.name_he AS chain_name, st.store_code, st.name,
            st.address, st.city, st.zip, st.lat, st.lng, st.geo_source, st.store_kind,
            ${distanceSelect}
     FROM store st
     JOIN chain c ON c.id = st.chain_id
     ${whereClause}
     ORDER BY ${orderBy}
     LIMIT 500`,
    sqlParams,
  );
  return res.rows.map(mapStore);
}
