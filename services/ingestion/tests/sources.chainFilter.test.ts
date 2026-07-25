/**
 * --chains= lets a single lagging chain be caught up on its own.
 *
 * Cerberus processes chains in list order, so a large chain at the front can
 * occupy an entire run. Measured in production: six chains sat a week stale
 * while a full run spent hours on Rami Levy, the first entry, and would have hit
 * its timeout before reaching them. Without a filter the only remedy is to
 * re-ingest everything ahead of them.
 */
import { describe, expect, it } from "vitest";
import { CERBERUS_CHAINS } from "../src/sources/cerberus/adapter.js";
import { selectCerberusChains } from "../src/sources/index.js";

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
