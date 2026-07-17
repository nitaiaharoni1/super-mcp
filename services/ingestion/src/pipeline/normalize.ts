import type { RawRecord } from "@super-mcp/shared";
import { Normalizer, type NormalizeStats } from "../normalize.js";

export async function normalizeRecords(
  sourceId: string,
  records: AsyncIterable<RawRecord> | Iterable<RawRecord>,
): Promise<NormalizeStats> {
  const normalizer = new Normalizer(sourceId);
  return normalizer.apply(records);
}
