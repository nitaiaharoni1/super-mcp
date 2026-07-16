import fs from "node:fs/promises";
import path from "node:path";
import type { RawBlob } from "@super-mcp/shared";

export async function archiveBlob(blob: RawBlob, rootDir: string): Promise<string> {
  const day = blob.fetchedAt.toISOString().slice(0, 10);
  const dir = path.join(rootDir, blob.sourceId, day);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, blob.file.fileName);
  await fs.writeFile(dest, blob.bytes);
  return dest;
}
