import type { FeedFile, RawRecord, SourceAdapter } from "@super-mcp/shared";
import { archiveBlob } from "../archive.js";

export interface ParsedFeed {
  records: AsyncIterable<RawRecord>;
  archivePath: string;
}

/**
 * Fetch a feed file, archive raw bytes, and parse into records.
 *
 * NOTE: parse() is not streaming today — peak memory is bytes + DOM + record array.
 */
export async function parseFeedFile(
  adapter: SourceAdapter,
  file: FeedFile,
  archiveRoot: string,
): Promise<ParsedFeed> {
  const blob = await adapter.fetch(file);
  const archivePath = await archiveBlob(blob, archiveRoot);
  blob.archivePath = archivePath;
  return {
    records: adapter.parse(blob),
    archivePath,
  };
}
