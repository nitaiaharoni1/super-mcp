import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { knownStoreLocationsForChain } from "@super-mcp/db";
import { decodeFeedBytes, parseFeedXml, parseStoresXml } from "../../xml/index.js";
import { classifyFeedFile, parseFeedFileMeta } from "../common/feedMeta.js";
import { fetchAllowedFeed } from "../common/allowedFetch.js";
import { storeCountCap } from "../../ingestCaps.js";
import { selectRegionalFeedFiles } from "../../selectRegionalFiles.js";
import type { StoreLocationHint } from "../../regions.js";
import { fetchSearchTokens, laibFileUrl, laibSearchDates, searchDay } from "./search.js";
import {
  DISCOVER_DAY_LOOKBACK,
  FETCH_TIMEOUT_MS,
  LAIB_BASE_URL,
  LAIB_CHAINS,
  LAIB_SOURCE_ID,
  STALE_FILING_WARN_DAYS,
  type LaibChainConfig,
} from "./types.js";

const ALLOWED_HOSTS = [new URL(LAIB_BASE_URL).hostname];

function baseName(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

function toFeedFile(chainId: string, relativePath: string): FeedFile {
  const fileName = baseName(relativePath);
  const kind = classifyFeedFile(fileName);
  const meta = parseFeedFileMeta(fileName);
  return {
    sourceId: LAIB_SOURCE_ID,
    kind,
    remotePath: laibFileUrl(relativePath),
    fileName,
    chainId,
    ...(kind === "stores" ? {} : { storeId: meta.storeId }),
    publishedAt: meta.publishedAt,
  };
}

/**
 * The newest filing available for one chain, as portal paths.
 *
 * Stores and prices are resolved independently rather than from a single day.
 * The two move apart in practice: on 2026-08-01 H. Cohen had filed a Stores
 * file every morning for a fortnight and no prices at all, while Victory's
 * newest of both sat eight days back. Insisting on one day per chain would
 * have dropped H. Cohen's stores entirely and, with them, any chance of
 * ingesting its prices when they resume.
 */
async function discoverChainPaths(
  chain: LaibChainConfig,
  dates: string[],
  tokens: Awaited<ReturnType<typeof fetchSearchTokens>>,
): Promise<{ stores: string[]; priced: string[]; pricedDate?: string }> {
  let stores: string[] = [];
  let priced: string[] = [];
  let pricedDate: string | undefined;

  for (const date of dates) {
    if (stores.length > 0 && priced.length > 0) break;
    const paths = await searchDay(chain.chainId, date, tokens, ALLOWED_HOSTS);
    if (paths.length === 0) continue;

    if (stores.length === 0) {
      stores = paths.filter((p) => classifyFeedFile(baseName(p)) === "stores");
    }
    if (priced.length === 0) {
      const full = paths.filter((p) => {
        const kind = classifyFeedFile(baseName(p));
        return kind === "pricesfull" || kind === "promosfull";
      });
      if (full.length > 0) {
        priced = full;
        pricedDate = date;
      }
    }
  }
  return { stores, priced, pricedDate };
}

async function locationsForChain(
  chain: LaibChainConfig,
  storesFile: FeedFile | undefined,
): Promise<StoreLocationHint[]> {
  if (storesFile) {
    try {
      const res = await fetchAllowedFeed(storesFile.remotePath, ALLOWED_HOSTS, {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const xml = decodeFeedBytes(Buffer.from(await res.arrayBuffer()));
        const parsed = parseStoresXml(xml, chain.chainId).map((s) => ({
          storeId: s.storeId,
          city: s.city,
          lat: s.geo?.lat,
          lng: s.geo?.lng,
          name: s.name,
        }));
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // fall through to what the database already knows
    }
  }

  // Same fallback the Cerberus adapter uses: a chain whose Stores file is
  // missing or unreadable still has store rows from previous runs, and without
  // them the region filter matches nothing and silently drops every price file.
  const reason = storesFile ? "stores_file_unusable" : "no_stores_file_published";
  try {
    const known = await knownStoreLocationsForChain(chain.chainId);
    console.log(
      JSON.stringify({
        event: "laibcatalog_store_location_fallback",
        chainId: chain.chainId,
        chain: chain.name,
        reason,
        locations: known.length,
      }),
    );
    return known.map((s) => ({
      storeId: s.storeId,
      city: s.city ?? undefined,
      lat: s.lat ?? undefined,
      lng: s.lng ?? undefined,
    }));
  } catch (err) {
    console.warn(
      `laibcatalog ${chain.name} store-location fallback failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/**
 * Report how far behind a chain's newest price filing is.
 *
 * The portal stalls without any error: the search simply returns nothing for
 * recent days while still serving older files perfectly. Ingesting the stale
 * copy is the right call — a week-old regulated price beats no price, and the
 * per-row `publishedAt` keeps the staleness visible downstream — but it has to
 * be said out loud, or a chain that quietly stopped filing looks identical to
 * one that is up to date.
 */
function reportFilingLag(chain: LaibChainConfig, pricedDate: string | undefined, now: Date): void {
  if (!pricedDate) {
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        event: "laibcatalog_no_prices_in_window",
        chainId: chain.chainId,
        chain: chain.name,
        lookbackDays: DISCOVER_DAY_LOOKBACK,
      }),
    );
    return;
  }
  const [day, month, year] = pricedDate.split("/").map(Number);
  const filed = Date.UTC(year!, month! - 1, day!);
  const lagDays = Math.floor((now.getTime() - filed) / 86_400_000);
  if (lagDays <= STALE_FILING_WARN_DAYS) return;
  console.warn(
    JSON.stringify({
      severity: "WARNING",
      event: "laibcatalog_stale_filing",
      chainId: chain.chainId,
      chain: chain.name,
      newestPriceFiling: pricedDate,
      lagDays,
    }),
  );
}

export function createLaibcatalogAdapter(chains: LaibChainConfig[] = LAIB_CHAINS): SourceAdapter {
  const maxStores = storeCountCap(20);

  return {
    sourceId: LAIB_SOURCE_ID,
    market: "IL",
    expectedChainIds: chains.map((c) => c.chainId),

    async discover(): Promise<FeedFile[]> {
      const tokens = await fetchSearchTokens(ALLOWED_HOSTS);
      const dates = laibSearchDates(DISCOVER_DAY_LOOKBACK);
      const now = new Date();
      const errors: string[] = [];
      const discovered: FeedFile[] = [];

      // Sequential across chains: this is one shared ASP.NET endpoint, and a
      // day with filings returns a couple of thousand links, so three parallel
      // walks would hammer it for no useful wall-clock gain.
      for (const chain of chains) {
        try {
          const { stores, priced, pricedDate } = await discoverChainPaths(chain, dates, tokens);
          reportFilingLag(chain, pricedDate, now);

          const chainFiles = [...stores, ...priced].map((p) => toFeedFile(chain.chainId, p));
          const storesFile = chainFiles.find((f) => f.kind === "stores");
          const locations = await locationsForChain(chain, storesFile);
          discovered.push(...selectRegionalFeedFiles(chainFiles, locations, maxStores));
        } catch (err) {
          errors.push(`${chain.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (discovered.length === 0) {
        throw new Error(
          `laibcatalog discovered 0 files (${errors.join("; ") || "no errors"}). Use --fixture for offline.`,
        );
      }
      if (errors.length > 0) {
        console.warn(`laibcatalog partial discover errors: ${errors.join("; ")}`);
      }
      return discovered;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const res = await fetchAllowedFeed(file.remotePath, ALLOWED_HOSTS, {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`laibcatalog fetch ${file.remotePath} -> ${res.status}`);
      return {
        sourceId: LAIB_SOURCE_ID,
        file,
        bytes: Buffer.from(await res.arrayBuffer()),
        fetchedAt: new Date(),
      };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      yield* parseFeedXml(
        xml,
        blob.file.kind,
        blob.file.chainId,
        blob.file.storeId,
        blob.file.publishedAt,
      );
    },
  };
}
