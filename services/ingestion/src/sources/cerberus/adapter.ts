import { Client } from "basic-ftp";
import { Writable } from "node:stream";
import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml, parseStoresXml } from "../../xml/index.js";
import { classifyFeedFile, parseFeedFileMeta } from "../common/feedMeta.js";
import { allChainsEnabled, storeCountCap } from "../../ingestCaps.js";
import { fileConcurrency, mapPool } from "@super-mcp/shared";
import { selectRegionalFeedFiles } from "../../selectRegionalFiles.js";
import type { StoreLocationHint } from "../../regions.js";
import { FtpPool } from "../common/ftpPool.js";

export interface CerberusChainConfig {
  ftpUser: string;
  ftpPassword?: string;
  chainId: string;
  name: string;
  /** Some Cerberus accounts require FTP over TLS. */
  secure?: boolean;
}

/**
 * Cerberus / publishedprices.co.il — public FTP usernames (empty password).
 * Config only; per-chain quirks stay out of the adapter logic.
 */
export const CERBERUS_CHAINS: CerberusChainConfig[] = [
  { ftpUser: "RamiLevi", chainId: "7290058140886", name: "Rami Levy" },
  { ftpUser: "yohananof", chainId: "7290803800003", name: "Yohananof" },
  { ftpUser: "osherad", chainId: "7290103152017", name: "Osher Ad" },
  { ftpUser: "TivTaam", chainId: "7290873255550", name: "Tiv Taam" },
  { ftpUser: "HaziHinam", chainId: "7290700100008", name: "Hazi Hinam" },
  { ftpUser: "SalachD", chainId: "7290526500006", name: "Salach Dabach" },
  { ftpUser: "freshmarket", chainId: "7290876100000", name: "Fresh Market" },
  { ftpUser: "Stop_Market", chainId: "7290639000004", name: "Stop Market" },
  { ftpUser: "Keshet", chainId: "7290785400000", name: "Keshet Taamim" },
];

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

async function connectCerberus(
  client: Client,
  host: string,
  chain: CerberusChainConfig,
): Promise<void> {
  await client.access({
    host,
    user: chain.ftpUser,
    password: chain.ftpPassword ?? "",
    secure: chain.secure ?? false,
    // Many Cerberus FTPS hosts present self-signed / incomplete chains; without this
    // the daily ingest fails TLS handshake. Trade-off: MITM risk on the feed path.
    secureOptions: chain.secure ? { rejectUnauthorized: false } : undefined,
  });
}

export function createCerberusAdapter(
  chains: CerberusChainConfig[] = CERBERUS_CHAINS,
): SourceAdapter {
  const host = process.env.CERBERUS_FTP_HOST ?? "url.retail.publishedprices.co.il";
  const maxStores = storeCountCap(50);
  const useAllChains = allChainsEnabled();
  /** Reused FTP logins per chain — avoids connect/auth on every PriceFull file. */
  const pools = new Map<string, FtpPool>();

  function poolFor(chain: CerberusChainConfig): FtpPool {
    let pool = pools.get(chain.chainId);
    if (!pool) {
      const size = Math.min(fileConcurrency(), 8);
      pool = new FtpPool(size, (client) => connectCerberus(client, host, chain));
      pools.set(chain.chainId, pool);
    }
    return pool;
  }

  return {
    sourceId: "il-cerberus",
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const errors: string[] = [];
      const selected = useAllChains ? chains : chains.slice(0, 2);

      // Discover chains in parallel — each has its own FTP login.
      const perChain = await mapPool(selected, Math.min(selected.length, 4), async (chain) => {
        const client = new Client(45_000);
        client.ftp.verbose = false;
        try {
          await connectCerberus(client, host, chain);

          const list = await client.list();
          const files = list.filter((f) => f.isFile || f.type === 1);

          const byKind = new Map<string, typeof files>();
          for (const f of files) {
            const kind = classifyFeedFile(f.name);
            if (kind === "other") continue;
            const arr = byKind.get(kind) ?? [];
            arr.push(f);
            byKind.set(kind, arr);
          }

          const chainFiles: FeedFile[] = [];
          const storeFiles = (byKind.get("stores") ?? []).sort((a, b) =>
            b.name > a.name ? 1 : -1,
          );
          let locations: StoreLocationHint[] = [];

          if (storeFiles[0]) {
            const storesFeed: FeedFile = {
              sourceId: "il-cerberus",
              kind: "stores",
              remotePath: storeFiles[0].name,
              fileName: storeFiles[0].name,
              chainId: chain.chainId,
              sizeBytes: storeFiles[0].size,
            };
            chainFiles.push(storesFeed);
            try {
              const bytes = await downloadBuffer(client, storeFiles[0].name);
              const xml = decodeFeedBytes(bytes);
              locations = parseStoresXml(xml, chain.chainId).map((s) => ({
                storeId: s.storeId,
                city: s.city,
                lat: s.geo?.lat,
                lng: s.geo?.lng,
                name: s.name,
              }));
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`${chain.ftpUser} stores: ${msg}`);
            }
          }

          for (const kind of ["pricesfull", "promosfull"] as const) {
            const sorted = (byKind.get(kind) ?? []).sort((a, b) => (b.name > a.name ? 1 : -1));
            const seenStores = new Set<string>();
            for (const f of sorted) {
              const meta = parseFeedFileMeta(f.name);
              if (!meta.storeId) continue;
              if (seenStores.has(meta.storeId)) continue;
              seenStores.add(meta.storeId);
              chainFiles.push({
                sourceId: "il-cerberus",
                kind,
                remotePath: f.name,
                fileName: f.name,
                chainId: chain.chainId,
                storeId: meta.storeId,
                publishedAt: meta.publishedAt,
                sizeBytes: f.size,
              });
            }
          }

          return selectRegionalFeedFiles(chainFiles, locations, maxStores);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${chain.ftpUser}: ${msg}`);
          return [] as FeedFile[];
        } finally {
          client.close();
        }
      });

      const discovered = perChain.flat();

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
      const bytes = await poolFor(chain).withClient((client) =>
        downloadBuffer(client, file.remotePath),
      );
      return {
        sourceId: "il-cerberus",
        file,
        bytes,
        fetchedAt: new Date(),
      };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      const records = parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId, blob.file.publishedAt);
      for (const r of records) yield r;
    },
  };
}
