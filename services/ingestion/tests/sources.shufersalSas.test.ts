/**
 * Shufersal's download links expire mid-run.
 *
 * The portal hands out pre-signed Azure Blob URLs valid for roughly 30 minutes,
 * and discovery mints every one of them at run start. A full ingest takes hours,
 * so everything queued past the first half hour comes back 403. Measured on one
 * nightly run: 459 of 542 files failed, leaving the chain with 76 of its 271
 * in-coverage stores refreshed. It looked like a coverage problem for weeks; it
 * was an expiry problem.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FeedFile } from "@super-mcp/shared";

const fetchAllowed = vi.fn();
const fetchTextMock = vi.fn();

vi.mock("../src/sources/common/allowedFetch.js", () => ({
  fetchAllowedFeed: (...a: unknown[]) => fetchAllowed(...a),
}));
vi.mock("../src/sources/shufersal/fetch.js", () => ({
  fetchText: (...a: unknown[]) => fetchTextMock(...a),
}));

const FILE = "PriceFull7290027600007-001-007-20260726-030000.gz";
const STALE = `https://pricesprodpublic.blob.core.windows.net/pricefull/${FILE}?se=2026-07-26T01%3A33%3A51Z&sig=old`;
const FRESH = `https://pricesprodpublic.blob.core.windows.net/pricefull/${FILE}?se=2026-07-26T08%3A17%3A35Z&sig=new`;

function priceFile(): FeedFile {
  return {
    sourceId: "il-shufersal",
    kind: "pricesfull",
    remotePath: STALE,
    fileName: FILE,
    chainId: "7290027600007",
    storeId: "007",
  } as FeedFile;
}

const ok = () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const forbidden = () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });

beforeEach(() => {
  vi.resetModules();
  fetchAllowed.mockReset();
  fetchTextMock.mockReset().mockResolvedValue(`<a href="${FRESH}">x</a>`);
});

describe("expired Shufersal signed URL", () => {
  it("re-mints the link for that store and retries", async () => {
    fetchAllowed.mockImplementation(async (url: string) =>
      url === STALE ? forbidden() : ok(),
    );

    const { createShufersalAdapter } = await import("../src/sources/shufersal/adapter.js");
    const blob = await createShufersalAdapter().fetch(priceFile());

    // Scoped to the one store, not a re-crawl of all 22 listing pages.
    expect(fetchTextMock.mock.calls[0]?.[0]).toContain("storeId=007");
    expect(fetchAllowed).toHaveBeenLastCalledWith(FRESH, expect.anything(), expect.anything());
    expect(blob.file.remotePath).toBe(FRESH);
  });

  it("reports the original failure when no fresh link can be had", async () => {
    fetchAllowed.mockResolvedValue(forbidden());
    fetchTextMock.mockResolvedValue("<a href=\"/nothing/relevant.txt\">x</a>");

    const { createShufersalAdapter } = await import("../src/sources/shufersal/adapter.js");
    await expect(createShufersalAdapter().fetch(priceFile())).rejects.toThrow(/403/);
  });

  it("does not re-mint on failures that are not an expiry", async () => {
    // A 500 or a timeout means the server is unhappy, not that our link aged
    // out. Retrying with a new signature would just hammer it.
    fetchAllowed.mockResolvedValue({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });

    const { createShufersalAdapter } = await import("../src/sources/shufersal/adapter.js");
    await expect(createShufersalAdapter().fetch(priceFile())).rejects.toThrow(/500/);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it("leaves a working link alone", async () => {
    fetchAllowed.mockResolvedValue(ok());

    const { createShufersalAdapter } = await import("../src/sources/shufersal/adapter.js");
    const blob = await createShufersalAdapter().fetch(priceFile());

    expect(blob.file.remotePath).toBe(STALE);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });
});
