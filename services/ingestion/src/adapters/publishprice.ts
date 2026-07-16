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

export interface PublishPricePortal {
  /** Adapter source id, e.g. il-carrefour */
  sourceId: string;
  /** Portal home page that embeds `const path` + `const files` */
  baseUrl: string;
  chainId: string;
  name: string;
}

/**
 * HTTP portals that embed today's file list in the HTML (PublishPrice-style).
 * Built from the public portal contract — not from third-party scraper code.
 *
 * Example download: https://prices.carrefour.co.il/20260717/Stores....xml
 */
export const PUBLISHPRICE_PORTALS: PublishPricePortal[] = [
  {
    sourceId: "il-carrefour",
    baseUrl: "https://prices.carrefour.co.il",
    chainId: "7290055700007",
    name: "Carrefour",
  },
];

const DISCOVER_TIMEOUT_MS = 45_000;
const FETCH_TIMEOUT_MS = 120_000;

export interface ParsedPublishPricePage {
  path: string;
  files: Array<{ name: string; size?: number }>;
  /** Optional branch id → Hebrew label from portal HTML (city often in the label). */
  branches?: Record<string, string>;
}

/** Parse the inline JS file list from a PublishPrice HTML page. */
export function parsePublishPriceHtml(html: string): ParsedPublishPricePage {
  const pathMatch = html.match(/const\s+path\s*=\s*['"]([^'"]+)['"]/);
  if (!pathMatch) {
    throw new Error("PublishPrice HTML: missing const path");
  }
  const filesMatch = html.match(/const\s+files\s*=\s*(\[[\s\S]*?\]);/);
  if (!filesMatch) {
    throw new Error("PublishPrice HTML: missing const files");
  }
  let files: Array<{ name: string; size?: number }>;
  try {
    files = JSON.parse(filesMatch[1]!) as Array<{ name: string; size?: number }>;
  } catch {
    throw new Error("PublishPrice HTML: const files is not valid JSON");
  }

  let branches: Record<string, string> | undefined;
  const branchesMatch = html.match(/const\s+branches\s*=\s*(\{[\s\S]*?\});/);
  if (branchesMatch) {
    try {
      branches = JSON.parse(branchesMatch[1]!) as Record<string, string>;
    } catch {
      branches = undefined;
    }
  }

  return { path: pathMatch[1]!, files, branches };
}

function fileUrl(baseUrl: string, dayPath: string, fileName: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const segments = dayPath.split("/").map(encodeURIComponent).join("/");
  return `${base}/${segments}/${encodeURIComponent(fileName)}`;
}

export function createPublishPriceAdapter(portal: PublishPricePortal): SourceAdapter {
  const full = process.env.SUPER_MCP_FULL === "1";
  const maxStores = full ? 20 : 2;

  return {
    sourceId: portal.sourceId,
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const res = await fetch(portal.baseUrl + "/", {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
        redirect: "follow",
        signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(
          `${portal.name} discover ${portal.baseUrl} -> ${res.status}. Use --fixture for offline.`,
        );
      }
      const html = await res.text();
      const { path: dayPath, files, branches } = parsePublishPriceHtml(html);

      const candidates: FeedFile[] = [];
      const sorted = [...files].sort((a, b) => (b.name > a.name ? 1 : -1));
      for (const f of sorted) {
        const kind = classifyFeedFile(f.name);
        if (kind === "other") continue;
        const abs = fileUrl(portal.baseUrl, dayPath, f.name);
        if (kind === "stores") {
          if (candidates.some((x) => x.kind === "stores")) continue;
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
          const storesRes = await fetch(storesFile.remotePath, {
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
      const res = await fetch(file.remotePath, {
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
      yield* parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId);
    },
  };
}

export function createCarrefourAdapter(): SourceAdapter {
  return createPublishPriceAdapter(PUBLISHPRICE_PORTALS[0]!);
}
