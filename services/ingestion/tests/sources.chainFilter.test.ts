/**
 * --chains= lets a single lagging chain be caught up on its own.
 *
 * Cerberus processes chains in list order, so a large chain at the front can
 * occupy an entire run. Measured in production: six chains sat a week stale
 * while a full run spent hours on Rami Levy, the first entry, and would have hit
 * its timeout before reaching them. Without a filter the only remedy is to
 * re-ingest everything ahead of them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CERBERUS_CHAINS } from "../src/sources/cerberus/adapter.js";
import { getAdapters, selectCerberusChains } from "../src/sources/index.js";

const prevNoCap = process.env.SUPER_MCP_NO_CAP;
afterEach(() => {
  if (prevNoCap === undefined) delete process.env.SUPER_MCP_NO_CAP;
  else process.env.SUPER_MCP_NO_CAP = prevNoCap;
});

const TIV_TAAM_ID = "7290873255550";

describe("selectCerberusChains", () => {
  it("returns every chain when no filter is given", () => {
    expect(selectCerberusChains([])).toEqual(CERBERUS_CHAINS);
  });

  it("selects by FTP username, case-insensitively", () => {
    const picked = selectCerberusChains(["tivtaam", "OSHERAD"]);
    expect(picked.map((c) => c.ftpUser)).toEqual(["osherad", "TivTaam"]);
  });

  it("selects by chain id too, since that is what the DB and logs show", () => {
    expect(selectCerberusChains([TIV_TAAM_ID]).map((c) => c.ftpUser)).toEqual(["TivTaam"]);
  });

  it("preserves the configured order rather than the order asked for", () => {
    // Callers should not be able to reorder processing by accident; ordering is
    // a property of the configuration, not of the command line.
    const picked = selectCerberusChains(["Keshet", "RamiLevi"]);
    expect(picked.map((c) => c.ftpUser)).toEqual(["RamiLevi", "Keshet"]);
  });

  it("selects the six chains that were starved in production", () => {
    const starved = ["osherad", "Keshet", "freshmarket", "TivTaam", "Stop_Market", "SalachD"];
    expect(selectCerberusChains(starved)).toHaveLength(6);
  });

  it("throws on an unknown name instead of silently ingesting nothing", () => {
    // A typo that quietly narrows the run to zero chains and still exits 0 is
    // exactly the class of silent-success failure this repo has already hit.
    expect(() => selectCerberusChains(["TivTam"])).toThrow(/Unknown Cerberus chain/);
    expect(() => selectCerberusChains(["TivTaam", "nope"])).toThrow(/nope/);
  });

  it("names the valid options in the error, so the fix is obvious", () => {
    expect(() => selectCerberusChains(["nope"])).toThrow(/RamiLevi/);
  });
});

describe("expectedChainIds tracks what the run actually attempts", () => {
  it("expects only the chains a --chains run selected", async () => {
    // Regression: a targeted run reported every chain it had deliberately
    // skipped as missing coverage, so it went degraded and raised an alert
    // naming chains nobody asked it to touch.
    process.env.SUPER_MCP_NO_CAP = "1";
    const { createCerberusAdapter } = await import("../src/sources/cerberus/adapter.js");
    const adapter = createCerberusAdapter(selectCerberusChains(["freshmarket", "Keshet"]));
    expect(adapter.expectedChainIds).toEqual(["7290876100000", "7290785400000"]);
  });

  it("never expects a knownInactive chain", async () => {
    process.env.SUPER_MCP_NO_CAP = "1";
    const { createCerberusAdapter } = await import("../src/sources/cerberus/adapter.js");
    const adapter = createCerberusAdapter();
    expect(adapter.expectedChainIds).not.toContain("7290700100008");
    expect(adapter.expectedChainIds).toContain("7290058140886");
  });
});

describe("a source this region cannot reach", () => {
  const ORIGINAL = process.env.SUPER_MCP_EXCLUDE_SOURCES;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SUPER_MCP_EXCLUDE_SOURCES;
    else process.env.SUPER_MCP_EXCLUDE_SOURCES = ORIGINAL;
  });

  it("leaves it out of an 'all' run instead of failing nightly", () => {
    // laibcatalog.co.il drops TCP connects from outside Israel, so the
    // europe-west1 job booked a guaranteed failure every night while me-west1
    // ingests the same source fine.
    process.env.SUPER_MCP_EXCLUDE_SOURCES = "il-laibcatalog";
    const ids = getAdapters("all").map((a) => a.sourceId);
    expect(ids).not.toContain("il-laibcatalog");
    expect(ids).toContain("il-shufersal");
    expect(ids.length).toBeGreaterThan(1);
  });

  it("keeps every source when nothing is excluded", () => {
    delete process.env.SUPER_MCP_EXCLUDE_SOURCES;
    expect(getAdapters("all").map((a) => a.sourceId)).toContain("il-laibcatalog");
  });

  it("refuses a config that excludes everything rather than ingesting nothing", () => {
    process.env.SUPER_MCP_EXCLUDE_SOURCES = [
      "il-shufersal",
      "il-cerberus",
      "il-laibcatalog",
      ...getAdapters("all").map((a) => a.sourceId),
    ].join(",");
    expect(() => getAdapters("all")).toThrow(/excluded every source/i);
  });
});
