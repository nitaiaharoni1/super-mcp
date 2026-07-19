import { query } from "@super-mcp/db";
import { displayCity } from "@super-mcp/shared";
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
    distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
  };
}

export interface ListStoresParams {
  chain?: string;
  city?: string;
  near?: GeoPoint;
  radiusKm?: number;
  storeIds?: string[];
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

  const location = storeLocationSql(
    { city: params.city, near: params.near, radiusKm: params.radiusKm },
    sqlParams,
  );
  conditions.push(...location.conditions);
  if (params.near) {
    distanceSelect = location.distanceSelect;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = params.near ? "distance_km ASC" : "st.city ASC, st.name ASC";

  const res = await query<StoreRow>(
    `SELECT st.id, st.chain_id, c.name_he AS chain_name, st.store_code, st.name,
            st.address, st.city, st.zip, st.lat, st.lng, st.geo_source, ${distanceSelect}
     FROM store st
     JOIN chain c ON c.id = st.chain_id
     ${whereClause}
     ORDER BY ${orderBy}
     LIMIT 500`,
    sqlParams,
  );
  return res.rows.map(mapStore);
}
