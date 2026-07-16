import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml, parseStoresXml } from "../xml.js";
import { classifyFeedFile, parseFeedFileMeta } from "./feedMeta.js";
import { selectRegionalFeedFiles } from "../selectRegionalFiles.js";
import type { StoreLocationHint } from "../regions.js";

const SHUFERSAL_CHAIN_ID = "7290027600007";
const BASE = "https://prices.shufersal.co.il";
// A hung portal socket must not stall the whole Cloud Run Job; mirror the
// Cerberus FTP timeouts (45s to list/discover, 120s to download a file).
const DISCOVER_TIMEOUT_MS = 45_000;
const FETCH_TIMEOUT_MS = 120_000;

/** Extract candidate feed-file links (xml / xml.gz) from portal HTML. */
export function extractFeedHrefs(html: string): Set<string> {
  const hrefs = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+\.xml(?:\.gz)?)["']/gi)) {
    hrefs.add(m[1]!);
  }
  for (const m of html.matchAll(/(https?:\/\/[^"'\s]+(?:PriceFull|PromoFull|Stores)[^"'\s]*\.xml(?:\.gz)?)/gi)) {
    hrefs.add(m[1]!);
  }
  for (const m of html.matchAll(/["'](\/?[A-Za-z0-9_./-]*(?:PriceFull|PromoFull|Stores)[^"']*\.xml(?:\.gz)?)["']/gi)) {
    hrefs.add(m[1]!);
  }
  return hrefs;
}

/**
 * Shufersal publishes via HTTPS portal.
 * Best-effort: try known FileList-style endpoints, then scrape download links.
 * Price/promo files are capped to stores in the ingest coverage region.
 */
export function createShufersalAdapter(): SourceAdapter {
  const full = process.env.SUPER_MCP_FULL === "1";
  const maxStores = full ? 20 : 2;

  return {
    sourceId: "il-shufersal",
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const candidates = [
        `${BASE}/FileList/PriceFull`,
        `${BASE}/FileList/PromoFull`,
        `${BASE}/FileList/Stores`,
        `${BASE}/`,
      ];

      const hrefs = new Set<string>();
      let lastError: string | undefined;

      for (const url of candidates) {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
            redirect: "follow",
            signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
          });
          if (!res.ok) {
            lastError = `${url} -> ${res.status}`;
            continue;
          }
          const html = await res.text();
          for (const href of extractFeedHrefs(html)) {
            hrefs.add(href);
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      if (hrefs.size === 0) {
        throw new Error(
          `Shufersal discovery found no files (${lastError ?? "unknown"}). Use --fixture for offline.`,
        );
      }

      const allFiles: FeedFile[] = [];
      const sorted = [...hrefs].sort().reverse();
      for (const href of sorted) {
        const fileName = href.split("/").pop() ?? href;
        const kind = classifyFeedFile(fileName);
        if (kind === "other") continue;
        const abs = href.startsWith("http")
          ? href
          : new URL(href, BASE).toString();

        if (kind === "stores") {
          if (allFiles.some((f) => f.kind === "stores")) continue;
          allFiles.push({
            sourceId: "il-shufersal",
            kind,
            remotePath: abs,
            fileName,
            chainId: SHUFERSAL_CHAIN_ID,
          });
          continue;
        }

        if (kind === "pricesfull" || kind === "promosfull") {
          const meta = parseFeedFileMeta(fileName);
          allFiles.push({
            sourceId: "il-shufersal",
            kind,
            remotePath: abs,
            fileName,
            chainId: SHUFERSAL_CHAIN_ID,
            storeId: meta.storeId,
            publishedAt: meta.publishedAt,
          });
        }
      }

      let locations: StoreLocationHint[] = [];
      const storesFile = allFiles.find((f) => f.kind === "stores");
      if (storesFile) {
        try {
          const storesRes = await fetch(storesFile.remotePath, {
            headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (storesRes.ok) {
            const xml = decodeFeedBytes(Buffer.from(await storesRes.arrayBuffer()));
            locations = parseStoresXml(xml, SHUFERSAL_CHAIN_ID).map((s) => ({
              storeId: s.storeId,
              city: s.city,
              lat: s.geo?.lat,
              lng: s.geo?.lng,
              name: s.name,
            }));
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      const files = selectRegionalFeedFiles(allFiles, locations, maxStores);
      if (files.length === 0) {
        throw new Error(
          `Shufersal: no feed files in coverage region (${lastError ?? "ok"}). Use --fixture.`,
        );
      }
      return files;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const res = await fetch(file.remotePath, {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`Shufersal fetch ${file.remotePath} -> ${res.status}`);
      }
      const ab = await res.arrayBuffer();
      return {
        sourceId: "il-shufersal",
        file,
        bytes: Buffer.from(ab),
        fetchedAt: new Date(),
      };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      yield* parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId);
    },
  };
}
