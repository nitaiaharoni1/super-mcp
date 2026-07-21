import fs from "node:fs/promises";
import path from "node:path";
import type { RawBlob } from "@super-mcp/shared";

export async function archiveBlob(blob: RawBlob, rootDir: string): Promise<string> {
  const day = blob.fetchedAt.toISOString().slice(0, 10);
  const dir = path.join(rootDir, blob.sourceId, day);
  await fs.mkdir(dir, { recursive: true });
  // basename only — never honor path segments from a hostile remote fileName.
  const safeName = path.basename(blob.file.fileName);
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error(`Refusing to archive blob with unsafe fileName: ${blob.file.fileName}`);
  }
  const dest = path.join(dir, safeName);
  await fs.writeFile(dest, blob.bytes);
  return dest;
}
