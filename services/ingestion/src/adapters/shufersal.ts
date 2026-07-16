import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml } from "../xml.js";

const SHUFERSAL_CHAIN_ID = "7290027600007";
const BASE = "https://prices.shufersal.co.il";

function classifyFile(name: string): FeedFile["kind"] {
  const n = name.toLowerCase();
  if (n.includes("pricefull")) return "pricesfull";
  if (n.includes("promofull")) return "promosfull";
  if (n.includes("promo")) return "promos";
  if (n.includes("price")) return "prices";
  if (n.includes("store")) return "stores";
  return "other";
}

function parseStoreId(fileName: string): string | undefined {
  const m = fileName.match(/(\d{13})-(\d+)-/);
  return m?.[2];
}

/**
 * Shufersal publishes via HTTPS portal.
 * Best-effort: try known FileList-style endpoints, then scrape download links.
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
          });
          if (!res.ok) {
            lastError = `${url} -> ${res.status}`;
            continue;
          }
          const html = await res.text();
          for (const m of html.matchAll(/href=["']([^"']+\.xml(?:\.gz)?)["']/gi)) {
            hrefs.add(m[1]!);
          }
          for (const m of html.matchAll(/(https?:\/\/[^"'\\s]+(?:PriceFull|PromoFull|Stores)[^"'\\s]*\.xml(?:\.gz)?)/gi)) {
            hrefs.add(m[1]!);
          }
          // Relative download paths
          for (const m of html.matchAll(/["'](\/?[A-Za-z0-9_./-]*(?:PriceFull|PromoFull|Stores)[^"']*\.xml(?:\.gz)?)["']/gi)) {
            hrefs.add(m[1]!);
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

      const files: FeedFile[] = [];
      const seenStores = new Set<string>();

      const sorted = [...hrefs].sort().reverse();
      for (const href of sorted) {
        const fileName = href.split("/").pop() ?? href;
        const kind = classifyFile(fileName);
        if (kind === "other") continue;
        const abs = href.startsWith("http")
          ? href
          : new URL(href, BASE).toString();

        if (kind === "stores") {
          if (files.some((f) => f.kind === "stores")) continue;
          files.push({
            sourceId: "il-shufersal",
            kind,
            remotePath: abs,
            fileName,
            chainId: SHUFERSAL_CHAIN_ID,
          });
          continue;
        }

        if (kind === "pricesfull" || kind === "promosfull") {
          const storeId = parseStoreId(fileName) ?? "unknown";
          const key = `${kind}:${storeId}`;
          if (seenStores.has(key)) continue;
          const storeCount = [...seenStores].filter((k) => k.startsWith(`${kind}:`)).length;
          if (storeCount >= maxStores) continue;
          seenStores.add(key);
          files.push({
            sourceId: "il-shufersal",
            kind,
            remotePath: abs,
            fileName,
            chainId: SHUFERSAL_CHAIN_ID,
            storeId,
          });
        }
      }

      if (files.length === 0) {
        throw new Error("Shufersal: classified zero usable feed files. Use --fixture.");
      }
      return files;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const res = await fetch(file.remotePath, {
        headers: { "User-Agent": "super-mcp/0.1 (+local-dev)" },
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
