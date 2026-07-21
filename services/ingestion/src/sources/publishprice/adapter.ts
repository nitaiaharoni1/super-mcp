import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml, parseStoresXml } from "../../xml/index.js";
import { classifyFeedFile, parseFeedFileMeta } from "../common/feedMeta.js";
import { storeCountCap } from "../../ingestCaps.js";
import { selectRegionalFeedFiles } from "../../selectRegionalFiles.js";
import type { StoreLocationHint } from "../../regions.js";
import { fetchAllowedFeed } from "../common/allowedFetch.js";
import { fetchPublishPriceDay } from "./fetchDay.js";
import { fileUrl, jerusalemDateKeys, mergePublishPriceDayFiles } from "./parseHtml.js";
import {
  DISCOVER_DAY_LOOKBACK,
  FETCH_TIMEOUT_MS,
  type DayFileEntry,
  type PublishPricePortal,
} from "./types.js";

function portalAllowedHosts(portal: PublishPricePortal): string[] {
  return [new URL(portal.baseUrl).hostname];
}

export function createPublishPriceAdapter(portal: PublishPricePortal): SourceAdapter {
  const maxStores = storeCountCap(20);
  const allowedHosts = portalAllowedHosts(portal);

  return {
    sourceId: portal.sourceId,
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const dateKeys = jerusalemDateKeys(DISCOVER_DAY_LOOKBACK);
      const pages = [];
      for (const key of dateKeys) {
        const page = await fetchPublishPriceDay(portal, key);
        if (page) pages.push(page);
      }
      if (pages.length === 0) {
        throw new Error(
          `${portal.name} discover ${portal.baseUrl} failed for dates ${dateKeys.join(",")}. Use --fixture for offline.`,
        );
      }

      const dayEntries: DayFileEntry[] = [];
      let branches: Record<string, string> | undefined;
      for (const page of pages) {
        if (!branches && page.branches) branches = page.branches;
        for (const f of page.files) {
          dayEntries.push({ dayPath: page.path, name: f.name, size: f.size });
        }
      }
      const merged = mergePublishPriceDayFiles(dayEntries);

      const candidates: FeedFile[] = [];
      for (const f of merged) {
        const kind = classifyFeedFile(f.name);
        if (kind === "other") continue;
        const abs = fileUrl(portal.baseUrl, f.dayPath, f.name);
        if (kind === "stores") {
          candidates.push({
            sourceId: portal.sourceId,
            kind,
            remotePath: abs,
            fileName: f.name,
            chainId: portal.chainId,
            sizeBytes: f.size,
          });
          continue;
        }
        if (kind === "pricesfull" || kind === "promosfull") {
          const meta = parseFeedFileMeta(f.name);
          candidates.push({
            sourceId: portal.sourceId,
            kind,
            remotePath: abs,
            fileName: f.name,
            chainId: portal.chainId,
            storeId: meta.storeId,
            publishedAt: meta.publishedAt,
            sizeBytes: f.size,
          });
        }
      }

      let locations: StoreLocationHint[] = [];
      const storesFile = candidates.find((f) => f.kind === "stores");
      if (storesFile) {
        try {
          const storesRes = await fetchAllowedFeed(storesFile.remotePath, allowedHosts, {
            headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (storesRes.ok) {
            const xml = decodeFeedBytes(Buffer.from(await storesRes.arrayBuffer()));
            locations = parseStoresXml(xml, portal.chainId).map((s) => ({
              storeId: s.storeId,
              city: s.city,
              lat: s.geo?.lat,
              lng: s.geo?.lng,
              name: s.name,
            }));
          }
        } catch {
          // fall through to HTML branch labels
        }
      }
      if (locations.length === 0 && branches) {
        locations = Object.entries(branches).map(([storeId, name]) => ({
          storeId,
          name,
        }));
      }

      const out = selectRegionalFeedFiles(candidates, locations, maxStores);
      if (out.length === 0) {
        throw new Error(
          `${portal.name}: no feed files in coverage region. Use --fixture or SUPER_MCP_REGION_FILTER=0.`,
        );
      }
      return out;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const res = await fetchAllowedFeed(file.remotePath, allowedHosts, {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`${portal.name} fetch ${file.remotePath} -> ${res.status}`);
      }
      const ab = await res.arrayBuffer();
      return {
        sourceId: portal.sourceId,
        file,
        bytes: Buffer.from(ab),
        fetchedAt: new Date(),
      };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      yield* parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId, blob.file.publishedAt);
    },
  };
}
