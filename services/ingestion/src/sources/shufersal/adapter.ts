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
import {
  BROWSER_UA,
  CAT_PRICES_FULL,
  CAT_PROMOS_FULL,
  CAT_STORES,
  DISCOVER_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  SHUFERSAL_ALLOWED_HOSTS,
  SHUFERSAL_BASE,
  SHUFERSAL_CHAIN_ID,
} from "./constants.js";
import { fetchText } from "./fetch.js";
import { extractFeedHrefs, maxPageFromHtml, parseStoreDropdown } from "./parseHtml.js";

/**
 * Shufersal publishes via HTTPS portal → Azure Blob SAS URLs.
 * List endpoint: GET /FileObject/UpdateCategory?catID=&storeId=&page=
 */
/**
 * Mint a fresh signed URL for one file.
 *
 * The portal's UpdateCategory listing can be scoped to a single store, so this
 * costs one request rather than re-crawling all 22 pages. The filename is
 * stable; only the SAS query string changes, so an exact filename match is the
 * right target, with the newest file for that store as a fallback in case the
 * feed also republished while we waited.
 */
async function refreshSignedUrl(file: FeedFile): Promise<string | null> {
  if (!file.storeId) return null;
  const catId = file.kind === "promosfull" ? CAT_PROMOS_FULL : CAT_PRICES_FULL;
  try {
    const html = await fetchText(
      `${SHUFERSAL_BASE}/FileObject/UpdateCategory?catID=${catId}&storeId=${encodeURIComponent(file.storeId)}&page=1`,
      DISCOVER_TIMEOUT_MS,
    );
    const hrefs = [...extractFeedHrefs(html)];
    const named = (h: string): string => ((h.split("?")[0] ?? h).split("/").pop() ?? "");
    const exact = hrefs.find((h) => named(h) === file.fileName);
    const sameKind = hrefs
      .filter((h) => classifyFeedFile(named(h)) === file.kind)
      .sort((a, b) => (named(b) > named(a) ? 1 : -1));
    const pick = exact ?? sameKind[0];
    if (!pick) return null;
    return pick.startsWith("http") ? pick : new URL(pick, SHUFERSAL_BASE).toString();
  } catch {
    // A refresh failure must surface as the original 403, not as a new error.
    return null;
  }
}

export function createShufersalAdapter(): SourceAdapter {
  const maxStores = storeCountCap(20);

  return {
    sourceId: "il-shufersal",
    market: "IL",

    async discover(): Promise<FeedFile[]> {
      const hrefs = new Set<string>();
      let lastError: string | undefined;
      let locations: StoreLocationHint[] = [];

      try {
        const home = await fetchText(`${SHUFERSAL_BASE}/`, DISCOVER_TIMEOUT_MS);
        locations = parseStoreDropdown(home);
        for (const href of extractFeedHrefs(home)) hrefs.add(href);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      for (const catID of [CAT_STORES, CAT_PRICES_FULL, CAT_PROMOS_FULL]) {
        try {
          const firstUrl = `${SHUFERSAL_BASE}/FileObject/UpdateCategory?catID=${catID}&storeId=0&page=1`;
          const firstHtml = await fetchText(firstUrl, DISCOVER_TIMEOUT_MS);
          for (const href of extractFeedHrefs(firstHtml)) hrefs.add(href);

          const maxPage = maxPageFromHtml(firstHtml);
          for (let page = 2; page <= maxPage; page++) {
            const html = await fetchText(
              `${SHUFERSAL_BASE}/FileObject/UpdateCategory?catID=${catID}&storeId=0&page=${page}`,
              DISCOVER_TIMEOUT_MS,
            );
            for (const href of extractFeedHrefs(html)) hrefs.add(href);
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
        const clean = href.split("?")[0] ?? href;
        const fileName = clean.split("/").pop() ?? clean;
        const kind = classifyFeedFile(fileName);
        if (kind === "other" || kind === "prices" || kind === "promos") continue;
        const abs = href.startsWith("http") ? href : new URL(href, SHUFERSAL_BASE).toString();

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

      const storesFile = allFiles.find((f) => f.kind === "stores");
      if (storesFile) {
        try {
          const storesRes = await fetchAllowedFeed(storesFile.remotePath, SHUFERSAL_ALLOWED_HOSTS, {
            headers: { "User-Agent": BROWSER_UA },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (storesRes.ok) {
            const xml = decodeFeedBytes(Buffer.from(await storesRes.arrayBuffer()));
            const fromXml = parseStoresXml(xml, SHUFERSAL_CHAIN_ID).map((s) => ({
              storeId: s.storeId,
              city: s.city,
              lat: s.geo?.lat,
              lng: s.geo?.lng,
              name: s.name,
            }));
            if (fromXml.length) locations = fromXml;
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
      const get = (url: string): Promise<Response> =>
        fetchAllowedFeed(url, SHUFERSAL_ALLOWED_HOSTS, {
          headers: { "User-Agent": BROWSER_UA },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

      let used = file;
      let res = await get(file.remotePath);

      // Shufersal hands out pre-signed Azure Blob URLs that expire about 30
      // minutes after they are minted, and discovery mints all of them at run
      // start. A full ingest takes hours, so everything queued past the first
      // half hour comes back 403. Measured on one nightly run: 459 of 542 files
      // failed this way, which is why the chain refreshed 76 of its 271
      // in-coverage stores and looked like a coverage problem rather than an
      // expiry one.
      if (res.status === 403) {
        const fresh = await refreshSignedUrl(file);
        if (fresh) {
          res = await get(fresh);
          if (res.ok) {
            used = { ...file, remotePath: fresh };
            console.log(
              JSON.stringify({
                event: "ingestion_url_resigned",
                sourceId: "il-shufersal",
                storeId: file.storeId ?? null,
                file: file.fileName,
              }),
            );
          }
        }
      }

      if (!res.ok) {
        throw new Error(`Shufersal fetch ${used.remotePath} -> ${res.status}`);
      }
      const ab = await res.arrayBuffer();
      return {
        sourceId: "il-shufersal",
        file: used,
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
