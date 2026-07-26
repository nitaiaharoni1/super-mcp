/**
 * Files rotate away between discovery and download.
 *
 * The adapter lists every chain's files once at run start, but processing a full
 * national ingest takes hours. Retailers republish under a new timestamp and
 * delete the old name, so files queued behind a large chain are frequently gone
 * by the time their turn comes. Measured on one production run: 117
 * "550 File not found" failures, falling entirely on the chains processed last,
 * which is why those chains repeatedly finished with no data at all.
 */
import { describe, expect, it, vi } from "vitest";
import type { FeedFile } from "@super-mcp/shared";

const listMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("basic-ftp", () => ({
  Client: class {
    ftp = { verbose: false };
    access = vi.fn();
    close = vi.fn();
    list = (...a: unknown[]) => listMock(...a);
    downloadTo = (_w: unknown, path: string) => downloadMock(path);
  },
}));

const RAMI_LEVY = "7290058140886";

function priceFile(name: string): FeedFile {
  return {
    sourceId: "il-cerberus",
    kind: "pricesfull",
    remotePath: name,
    fileName: name,
    chainId: RAMI_LEVY,
    storeId: "001",
  } as FeedFile;
}

/** basic-ftp surfaces a missing file as an Error whose message carries the code. */
function ftp550(): Error {
  return new Error("550 File not found");
}

describe("a file that rotated away between discovery and download", () => {
  it("re-lists and downloads the replacement for the same store", async () => {
    const stale = "PriceFull7290058140886-001-001-20260725-001000.gz";
    const current = "PriceFull7290058140886-001-001-20260725-180000.gz";

    downloadMock.mockReset().mockImplementation(async (path: string) => {
      if (path === stale) throw ftp550();
      return undefined;
    });
    listMock.mockReset().mockResolvedValue([
      { name: current, isFile: true, type: 1, size: 10 },
      // A different store's file must not be picked up by mistake.
      { name: "PriceFull7290058140886-001-002-20260725-180000.gz", isFile: true, type: 1, size: 10 },
    ]);

    const { createCerberusAdapter } = await import("../src/sources/cerberus/adapter.js");
    const blob = await createCerberusAdapter().fetch(priceFile(stale));

    expect(downloadMock).toHaveBeenCalledWith(current);
    // The blob must carry the name actually fetched, so downstream parsing and
    // archiving do not record a file that no longer exists.
    expect(blob.file.fileName).toBe(current);
  });

  it("rethrows when the store has no replacement at all", async () => {
    const stale = "PriceFull7290058140886-001-009-20260725-001000.gz";
    downloadMock.mockReset().mockRejectedValue(ftp550());
    listMock.mockReset().mockResolvedValue([
      { name: "PriceFull7290058140886-001-001-20260725-180000.gz", isFile: true, type: 1, size: 10 },
    ]);

    const { createCerberusAdapter } = await import("../src/sources/cerberus/adapter.js");
    await expect(createCerberusAdapter().fetch(priceFile(stale))).rejects.toThrow(/550/);
  });

  it("does not swallow errors that are not a missing file", async () => {
    // A dropped connection or auth failure must still surface, or a broken chain
    // would look like a rotation and quietly retry forever.
    const name = "PriceFull7290058140886-001-001-20260725-001000.gz";
    downloadMock.mockReset().mockRejectedValue(new Error("Client is closed because Server sent FIN packet"));
    listMock.mockReset().mockResolvedValue([]);

    const { createCerberusAdapter } = await import("../src/sources/cerberus/adapter.js");
    await expect(createCerberusAdapter().fetch(priceFile(name))).rejects.toThrow(/FIN packet/);
    expect(listMock).not.toHaveBeenCalled();
  });
});
