import { query } from "@super-mcp/db";
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

interface ReadinessRow {
  total_stores: string;
  stores_with_valid_coordinates: string;
  current_price_rows: string;
  stores_with_current_prices: string;
  newest_price_source_ts: string | null;
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
    currentRows: number;
    storesWithCurrentPrices: number;
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

async function runReadinessQuery(): Promise<ReadinessReport> {
  const bounds = ISRAEL_STORE_COORDINATE_BOUNDS;
  const result = await query<ReadinessRow>(
    `SELECT
       stores.total_stores,
       stores.stores_with_valid_coordinates,
       prices.current_price_rows,
       prices.stores_with_current_prices,
       prices.newest_price_source_ts
     FROM (
       SELECT
         COUNT(*)::text AS total_stores,
         COUNT(*) FILTER (
           WHERE lat BETWEEN $1 AND $2
             AND lng BETWEEN $3 AND $4
             AND lat <> 0 AND lng <> 0
         )::text AS stores_with_valid_coordinates
       FROM store
     ) stores
     CROSS JOIN (
       SELECT
         COUNT(*) FILTER (WHERE source_ts >= now() - ($5 * interval '1 hour'))::text
           AS current_price_rows,
         COUNT(DISTINCT store_id) FILTER (WHERE source_ts >= now() - ($5 * interval '1 hour'))::text
           AS stores_with_current_prices,
         MAX(source_ts)::text AS newest_price_source_ts
       FROM store_price
     ) prices`,
    [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, CURRENT_PRICE_FRESHNESS_HOURS],
  );
  const row = result.rows[0];
  const total = Number(row?.total_stores ?? 0);
  const valid = Number(row?.stores_with_valid_coordinates ?? 0);
  const currentRows = Number(row?.current_price_rows ?? 0);

  return {
    status: total > 0 && currentRows > 0 ? "ready" : "degraded",
    checkedAt: new Date().toISOString(),
    storeCoordinates: {
      total,
      valid,
      coverage: total > 0 ? valid / total : 0,
    },
    localPrices: {
      currentRows,
      storesWithCurrentPrices: Number(row?.stores_with_current_prices ?? 0),
      newestSourceTs: row?.newest_price_source_ts ?? null,
      freshnessHours: CURRENT_PRICE_FRESHNESS_HOURS,
    },
  };
}
