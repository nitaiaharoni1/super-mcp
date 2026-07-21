import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveBlob } from "../src/archive.js";

describe("archiveBlob", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes using basename only (no path traversal)", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "super-mcp-archive-"));
    const dest = await archiveBlob(
      {
        sourceId: "il-test",
        file: {
          sourceId: "il-test",
          kind: "pricesfull",
          remotePath: "https://example.test/x",
          fileName: "../../evil.xml",
          chainId: "1",
        },
        bytes: Buffer.from("<xml/>"),
        fetchedAt: new Date("2026-07-21T00:00:00Z"),
      },
      tmp,
    );
    expect(path.basename(dest)).toBe("evil.xml");
    expect(dest.startsWith(tmp)).toBe(true);
    expect(dest.includes("..")).toBe(false);
    await expect(fs.readFile(dest, "utf8")).resolves.toBe("<xml/>");
  });
});
