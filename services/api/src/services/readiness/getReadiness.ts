import { query, withTransaction } from "@super-mcp/db";
import { ISRAEL_STORE_COORDINATE_BOUNDS } from "@super-mcp/shared";

const CURRENT_PRICE_FRESHNESS_HOURS = 48;

/**
 * How long a report is reused before the aggregate is run again.
 *
 * The price half of this query cannot be served from an index: COUNT(DISTINCT
 * store_id) needs a column `store_price_source_ts_idx` does not carry, so the
 * planner reads heap tuples, and roughly 4M of the 7.3M rows fall inside the
 * 48-hour window regardless of how the predicate is written. Measured at 15s
 * against production on a warm instance, and it was one of the requests that hit
 * the 30s pool-wide statement_timeout while the nightly ingest held the disk.
 *
 * Narrowing the WHERE clause does not fix that, because the rows really are
 * recent. Not running it on every request does. `/ready` is public and
 * unauthenticated by default, so before this cache any caller could ask a
 * single-instance service to seq-scan 7.3M rows, as often as they liked, and
 * each concurrent caller started its own scan.
 *
 * A minute is far inside the useful resolution of the answer: the underlying
 * numbers move once a night when the ingest lands, not per request.
 */
const REPORT_TTL_MS = 60_000;

let cachedReport: { report: ReadinessReport; expiresAt: number } | null = null;
/**
 * The last report that actually succeeded, kept past its cache expiry.
 *
 * Separate from `cachedReport` on purpose: that one answers "is a fresh answer
 * still valid", this one answers "have we ever had an answer at all", and only
 * the second can rescue a scan that is failing right now.
 */
let lastGood: ReadinessReport | null = null;
/** Collapses concurrent callers onto one scan instead of one scan each. */
let inflight: Promise<ReadinessReport> | null = null;

/** Test-only: drop the cached readiness report and any in-flight scan. */
export function _resetReadinessCacheForTests(): void {
  cachedReport = null;
  lastGood = null;
  inflight = null;
}

/**
 * Budget for the one part of this report that cannot be served from an index.
 *
 * Short on purpose. A readiness probe that waits 30s to fail is not a probe, and
 * the two figures behind this budget are informational: the signals that actually
 * answer "did tonight's ingest land" are the store counts and newestSourceTs,
 * both of which are cheap and are fetched separately so they can never be held
 * hostage by this one.
 */
const PRICE_DETAIL_TIMEOUT_MS = 5_000;

interface CoreRow {
  total_stores: string;
  stores_with_valid_coordinates: string;
  newest_price_source_ts: string | null;
}

interface PriceDetailRow {
  current_price_rows: string;
  stores_with_current_prices: string;
}

export interface ReadinessReport {
  status: "ready" | "degraded";
  checkedAt: string;
  storeCoordinates: {
    total: number;
    valid: number;
    coverage: number;
  };
  localPrices: {
    /** Null when the count could not be produced inside its budget. */
    currentRows: number | null;
    /** Null when the count could not be produced inside its budget. */
    storesWithCurrentPrices: number | null;
    newestSourceTs: string | null;
    freshnessHours: number;
  };
}

export async function getReadiness(): Promise<ReadinessReport> {
  const now = Date.now();
  if (cachedReport && cachedReport.expiresAt > now) return cachedReport.report;
  if (inflight) return inflight;

  // `checkedAt` deliberately keeps the time the aggregate actually ran rather
  // than the time of the request, so a cached answer says how old it is instead
  // of claiming to be fresh.
  inflight = runReadinessQuery()
    .then((report) => {
      cachedReport = { report, expiresAt: Date.now() + REPORT_TTL_MS };
      lastGood = report;
      return report;
    })
    .catch((err: unknown) => {
      // A failed scan is not evidence the service is unready, and saying it is
      // was worse than saying nothing. During the nightly ingest this aggregate
      // exceeds the 30s statement_timeout, so /ready answered 500 for the whole
      // six-hour window while /mcp served baskets normally throughout. Anything
      // watching readiness would have paged every night over a healthy service.
      //
      // So the last successful report is served instead, carrying its own
      // checkedAt, which is what makes it honest: a reader sees the numbers are
      // hours old rather than being told they are current. Only a service that
      // has never once succeeded reports failure.
      if (lastGood) {
        console.error(
          JSON.stringify({
            severity: "WARNING",
            msg: "readiness scan failed; serving last good report",
            staleSinceMs: Date.now() - Date.parse(lastGood.checkedAt),
            err: err instanceof Error ? err.message : String(err),
          }),
        );
        // Briefly cached so a stampede during a long ingest does not queue a new
        // doomed scan per request.
        cachedReport = { report: lastGood, expiresAt: Date.now() + REPORT_TTL_MS };
        return lastGood;
      }
      throw err;
    })
    .finally(() => {
      // Cleared on failure too: a failed scan must not wedge every later caller
      // on a rejected promise.
      inflight = null;
    });
  return inflight;
}

/**
 * The counts that need a heap scan, or null if they will not come cheaply.
 *
 * COUNT(DISTINCT store_id) needs a column store_price_source_ts_idx does not
 * carry, so the planner reads ~4M heap tuples, and during the nightly ingest it
 * does not finish at all. Best-effort with its own short budget, so a slow disk
 * costs two fields rather than the whole endpoint.
 */
async function fetchPriceDetail(): Promise<PriceDetailRow | null> {
  try {
    return await withTransaction(async (client) => {
      await client.query(`SET LOCAL statement_timeout = ${PRICE_DETAIL_TIMEOUT_MS}`);
      const res = await client.query<PriceDetailRow>(
        `SELECT
           COUNT(*) FILTER (WHERE source_ts >= now() - ($1 * interval '1 hour'))::text
             AS current_price_rows,
           COUNT(DISTINCT store_id) FILTER (WHERE source_ts >= now() - ($1 * interval '1 hour'))::text
             AS stores_with_current_prices
         FROM store_price`,
        [CURRENT_PRICE_FRESHNESS_HOURS],
      );
      return res.rows[0] ?? null;
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "WARNING",
        msg: "readiness price detail skipped",
        err: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

async function runReadinessQuery(): Promise<ReadinessReport> {
  const bounds = ISRAEL_STORE_COORDINATE_BOUNDS;
  // Cheap half: the storefront rows, plus MAX(source_ts) which the source_ts
  // index answers with a backward scan. This is what has to keep working.
  //
  // Scoped to storefronts because those are the only stores this deployment
  // prices. Counting branches made the coverage figure describe a population we
  // no longer ingest, so a healthy service would have reported a falling
  // percentage every time a chain filed a new branch.
  const result = await query<CoreRow>(
    `SELECT
       stores.total_stores,
       stores.stores_with_valid_coordinates,
       (SELECT MAX(source_ts)::text FROM store_price) AS newest_price_source_ts
     FROM (
       SELECT
         COUNT(*)::text AS total_stores,
         COUNT(*) FILTER (
           WHERE lat BETWEEN $1 AND $2
             AND lng BETWEEN $3 AND $4
             AND lat <> 0 AND lng <> 0
         )::text AS stores_with_valid_coordinates
       FROM store
       WHERE store_kind IN ('online', 'pickup')
     ) stores`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng],
  );
  const detail = await fetchPriceDetail();

  const row = result.rows[0];
  const total = Number(row?.total_stores ?? 0);
  const valid = Number(row?.stores_with_valid_coordinates ?? 0);
  const currentRows = detail ? Number(detail.current_price_rows) : null;
  const newestSourceTs = row?.newest_price_source_ts ?? null;

  return {
    // Readiness turns on what we can always establish: stores exist and the
    // catalogue has priced rows. It must NOT depend on the best-effort counts,
    // or a slow disk would report an unready service that is serving fine.
    status: total > 0 && newestSourceTs != null ? "ready" : "degraded",
    checkedAt: new Date().toISOString(),
    storeCoordinates: {
      total,
      valid,
      coverage: total > 0 ? valid / total : 0,
    },
    localPrices: {
      currentRows,
      storesWithCurrentPrices: detail ? Number(detail.stores_with_current_prices) : null,
      newestSourceTs,
      freshnessHours: CURRENT_PRICE_FRESHNESS_HOURS,
    },
  };
}
