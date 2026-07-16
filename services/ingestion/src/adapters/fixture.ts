import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FeedFile,
  type RawBlob,
  type RawRecord,
  type SourceAdapter,
} from "@super-mcp/shared";
import { decodeFeedBytes, parseFeedXml } from "../xml.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

interface FixtureEntry {
  kind: FeedFile["kind"];
  chainId: string;
  storeId?: string;
  relativePath: string;
}

const FIXTURES: FixtureEntry[] = [
  { kind: "stores", chainId: "7290027600007", relativePath: "shufersal/Stores.xml" },
  {
    kind: "pricesfull",
    chainId: "7290027600007",
    storeId: "001",
    relativePath: "shufersal/PriceFull-001.xml",
  },
  {
    kind: "promosfull",
    chainId: "7290027600007",
    storeId: "001",
    relativePath: "shufersal/PromoFull-001.xml",
  },
  { kind: "stores", chainId: "7290058140886", relativePath: "rami_levy/Stores.xml" },
  {
    kind: "pricesfull",
    chainId: "7290058140886",
    storeId: "001",
    relativePath: "rami_levy/PriceFull-001.xml",
  },
  {
    kind: "promosfull",
    chainId: "7290058140886",
    storeId: "001",
    relativePath: "rami_levy/PromoFull-001.xml",
  },
];

export function createFixtureAdapter(): SourceAdapter {
  const fixtureRoot = path.join(rootDir, "data/fixtures");

  return {
    sourceId: "il-fixture",
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      return FIXTURES.map((f) => ({
        sourceId: "il-fixture",
        kind: f.kind,
        remotePath: path.join(fixtureRoot, f.relativePath),
        fileName: path.basename(f.relativePath),
        chainId: f.chainId,
        storeId: f.storeId,
        publishedAt: new Date(),
      }));
    },

    async fetch(file: FeedFile): Promise<RawBlob> {
      const bytes = await fs.readFile(file.remotePath);
      return {
        sourceId: "il-fixture",
        file,
        bytes,
        fetchedAt: new Date(),
      };
    },

    async *parse(blob: RawBlob): AsyncIterable<RawRecord> {
      const xml = decodeFeedBytes(blob.bytes);
      yield* parseFeedXml(xml, blob.file.kind, blob.file.chainId, blob.file.storeId);
    },
  };
}
