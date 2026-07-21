import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool, query } from "@super-mcp/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
dotenv.config({ path: path.resolve(repoRoot, ".env") });

/**
 * Fixture-ingest catalogs (CI benchmark job) are small; full Israel dumps are large.
 * Thresholds are env-overridable for local tuning.
 */
const MIN_PRODUCTS = Number(process.env.SUPER_MCP_LIVE_MIN_PRODUCTS ?? 10);
const MIN_GEO_STORES = Number(process.env.SUPER_MCP_LIVE_MIN_GEO_STORES ?? 2);
const MIN_RECENT_PRICES = Number(process.env.SUPER_MCP_LIVE_MIN_RECENT_PRICES ?? 10);
/** BBQ / Neve Amal coverage needs a real multi-chain dump, not the tiny XML fixture. */
const FULL_MIN_PRODUCTS = Number(process.env.SUPER_MCP_LIVE_FULL_MIN_PRODUCTS ?? 5_000);

export type LiveCatalogStats = {
  products: number;
  geoStores: number;
  recentPrices: number;
  /** True when large enough for BBQ/Neve Amal golden coverage. */
  fullCatalog: boolean;
};

let cachedStats: LiveCatalogStats | null = null;
let probed = false;
let probeError: string | null = null;

/**
 * True when DATABASE_URL is set and SUPER_MCP_SKIP_LIVE is not "1".
 * Does not prove the catalog is populated — call {@link probeLiveCatalog}.
 */
export function liveDbConfigured(): boolean {
  if (process.env.SUPER_MCP_SKIP_LIVE === "1") return false;
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Probe the live catalog once per process. Returns null when unavailable or too empty.
 */
export async function probeLiveCatalog(): Promise<LiveCatalogStats | null> {
  if (probed) return cachedStats;
  probed = true;

  if (!liveDbConfigured()) {
    probeError = "DATABASE_URL unset or SUPER_MCP_SKIP_LIVE=1";
    return null;
  }

  const secret = process.env.BASKET_CONTINUATION_SECRET ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    probeError = "BASKET_CONTINUATION_SECRET missing or shorter than 32 bytes";
    return null;
  }

  try {
    const [products, geoStores, recentPrices] = await Promise.all([
      query<{ n: number }>("select count(*)::int as n from product"),
      query<{ n: number }>("select count(*)::int as n from store where lat is not null"),
      query<{ n: number }>(
        "select count(*)::int as n from store_price where source_ts > now() - interval '30 days'",
      ),
    ]);

    const stats: LiveCatalogStats = {
      products: products.rows[0]?.n ?? 0,
      geoStores: geoStores.rows[0]?.n ?? 0,
      recentPrices: recentPrices.rows[0]?.n ?? 0,
      fullCatalog: false,
    };
    stats.fullCatalog = stats.products >= FULL_MIN_PRODUCTS;

    if (
      stats.products < MIN_PRODUCTS ||
      stats.geoStores < MIN_GEO_STORES ||
      stats.recentPrices < MIN_RECENT_PRICES
    ) {
      probeError =
        `catalog too small for live flows ` +
        `(products=${stats.products}, geoStores=${stats.geoStores}, recentPrices=${stats.recentPrices}; ` +
        `need ≥${MIN_PRODUCTS}/${MIN_GEO_STORES}/${MIN_RECENT_PRICES})`;
      return null;
    }

    cachedStats = stats;
    return stats;
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function liveCatalogSkipReason(): string {
  return probeError ?? "live catalog unavailable";
}

export function isFullCatalog(stats: LiveCatalogStats | null | undefined): boolean {
  return Boolean(stats?.fullCatalog);
}

export async function closeLivePool(): Promise<void> {
  await closePool();
}
