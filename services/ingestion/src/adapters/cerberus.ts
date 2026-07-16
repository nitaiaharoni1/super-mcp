import { Client } from "basic-ftp";
import { Writable } from "node:stream";
import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml } from "../xml.js";

export interface CerberusChainConfig {
  ftpUser: string;
  ftpPassword?: string;
  chainId: string;
  name: string;
}

/** Cerberus / publishedprices.co.il — multiple chains via FTP user config. */
export const CERBERUS_CHAINS: CerberusChainConfig[] = [
  { ftpUser: "RamiLevi", chainId: "7290058140886", name: "Rami Levy" },
  { ftpUser: "yohananof", chainId: "7290803800003", name: "Yohananof" },
  { ftpUser: "osherad", chainId: "7290103152017", name: "Osher Ad" },
  { ftpUser: "TivTaam", chainId: "7290873255550", name: "Tiv Taam" },
  { ftpUser: "HaziHinam", chainId: "7290700100008", name: "Hazi Hinam" },
];

function classifyFile(name: string): FeedFile["kind"] {
  const n = name.toLowerCase();
  if (n.includes("pricefull")) return "pricesfull";
  if (n.includes("promofull")) return "promosfull";
  if (n.startsWith("promo") || n.includes("promo")) return "promos";
  if (n.startsWith("price") || n.includes("price")) return "prices";
  if (n.includes("store")) return "stores";
  return "other";
}

function parseFileMeta(fileName: string): Pick<FeedFile, "storeId" | "publishedAt"> {
  // PriceFull7290058140886-001-202403280000.xml.gz
  const m = fileName.match(/(\d{13})-(\d+)-(\d{10,14})/i);
  if (!m) return {};
  const ts = m[3]!;
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const hh = ts.slice(8, 10) || "00";
  const mm = ts.slice(10, 12) || "00";
  const storeRaw = m[2]!;
  const storeId = /^\d+$/.test(storeRaw)
    ? String(parseInt(storeRaw, 10)).padStart(3, "0")
    : storeRaw;
  return {
    storeId,
    publishedAt: new Date(`${y}-${mo}-${d}T${hh}:${mm}:00`),
  };
}

async function downloadBuffer(client: Client, remotePath: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  await client.downloadTo(writable, remotePath);
  return Buffer.concat(chunks);
}

export function createCerberusAdapter(
  chains: CerberusChainConfig[] = CERBERUS_CHAINS,
): SourceAdapter {
  const host = process.env.CERBERUS_FTP_HOST ?? "url.retail.publishedprices.co.il";
  const full = process.env.SUPER_MCP_FULL === "1";
  const maxStores = full ? 50 : 2;

  return {
    sourceId: "il-cerberus",
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const discovered: FeedFile[] = [];
      const errors: string[] = [];
      // Local default: first 2 configured chains unless SUPER_MCP_FULL=1
      const selected = full ? chains : chains.slice(0, 2);

      for (const chain of selected) {
        const client = new Client(45_000);
        client.ftp.verbose = false;
        try {
          await client.access({
            host,
            user: chain.ftpUser,
            password: chain.ftpPassword ?? "",
            secure: false,
          });

          const list = await client.list();
          const files = list.filter((f) => f.isFile || f.type === 1);

          const byKind = new Map<string, typeof files>();
          for (const f of files) {
            const kind = classifyFile(f.name);
            if (kind === "other") continue;
            const arr = byKind.get(kind) ?? [];
            arr.push(f);
            byKind.set(kind, arr);
          }

          const storeFiles = (byKind.get("stores") ?? []).sort((a, b) =>
            b.name > a.name ? 1 : -1,
          );
          if (storeFiles[0]) {
            discovered.push({
              sourceId: "il-cerberus",
              kind: "stores",
              remotePath: storeFiles[0].name,
              fileName: storeFiles[0].name,
              chainId: chain.chainId,
              sizeBytes: storeFiles[0].size,
            });
          }

          for (const kind of ["pricesfull", "promosfull"] as const) {
            const sorted = (byKind.get(kind) ?? []).sort((a, b) => (b.name > a.name ? 1 : -1));
            const seenStores = new Set<string>();
            for (const f of sorted) {
              const meta = parseFileMeta(f.name);
              if (!meta.storeId) continue;
              const storeId = meta.storeId;
              if (seenStores.has(storeId)) continue;
              seenStores.add(storeId);
              discovered.push({
                sourceId: "il-cerberus",
                kind,
                remotePath: f.name,
                fileName: f.name,
                chainId: chain.chainId,
                storeId,
                publishedAt: meta.publishedAt,
                sizeBytes: f.size,
              });
              if (seenStores.size >= maxStores) break;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${chain.ftpUser}: ${msg}`);
        } finally {
          client.close();
        }
      }

      if (discovered.length === 0) {
        throw new Error(
          `Cerberus FTP discovered 0 files (${errors.join("; ") || "no errors"}). Use --fixture for offline.`,
        );
      }
      if (errors.length) {
        console.warn(`Cerberus partial discover errors: ${errors.join("; ")}`);
      }
      return discovered;
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const chain = chains.find((c) => c.chainId === file.chainId);
      if (!chain) throw new Error(`Unknown cerberus chain ${file.chainId}`);
      const client = new Client(120_000);
      try {
        await client.access({
          host,
          user: chain.ftpUser,
          password: chain.ftpPassword ?? "",
          secure: false,
        });
        const bytes = await downloadBuffer(client, file.remotePath);
        return {
          sourceId: "il-cerberus",
          file,
          bytes,
          fetchedAt: new Date(),
        };
      } finally {
        client.close();
      }
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      const records = parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId);
      for (const r of records) yield r;
    },
  };
}
