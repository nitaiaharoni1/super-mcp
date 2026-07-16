import { describe, expect, it } from "vitest";
import { classifyStatus, isAlertable, type PipelineResult } from "./pipeline.js";

function result(partial: Partial<PipelineResult>): PipelineResult {
  return {
    sourceId: "test",
    status: "success",
    filesDiscovered: 0,
    filesProcessed: 0,
    priceFilesDiscovered: 1,
    rowsOk: 0,
    rowsError: 0,
    ...partial,
  };
}

describe("classifyStatus", () => {
  it("fails when no files were processed", () => {
    expect(classifyStatus(result({ filesDiscovered: 5, filesProcessed: 0, rowsError: 5 }))).toBe(
      "failed",
    );
  });

  it("fails when all processed rows errored", () => {
    expect(
      classifyStatus(result({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 0, rowsError: 10 })),
    ).toBe("failed");
  });

  it("marks empty when files processed but no rows", () => {
    expect(
      classifyStatus(result({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 0, rowsError: 0 })),
    ).toBe("empty");
  });

  it("degrades when most discovered files fail even if row ratio looks green", () => {
    // 3 of 5 files fail (fileFailureRatio=0.4); the two successes contribute thousands of ok rows
    // and only +1 rowsError each for the failed files → row ratio would look like success.
    expect(
      classifyStatus(
        result({
          filesDiscovered: 5,
          filesProcessed: 2,
          rowsOk: 5000,
          rowsError: 3,
        }),
      ),
    ).toBe("degraded");
  });

  it("degrades a metadata-only run (rows ingested but zero price/promo files selected)", () => {
    // e.g. Stores XML parse failed => region filter selected no PriceFull/PromoFull files,
    // so only store metadata was ingested. That must not report green.
    expect(
      classifyStatus(
        result({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 200, priceFilesDiscovered: 0 }),
      ),
    ).toBe("degraded");
  });

  it("degrades when row errors exceed the threshold", () => {
    expect(
      classifyStatus(
        result({
          filesDiscovered: 1,
          filesProcessed: 1,
          rowsOk: 40,
          rowsError: 60,
        }),
      ),
    ).toBe("degraded");
  });

  it("succeeds when files and rows are mostly healthy", () => {
    expect(
      classifyStatus(
        result({
          filesDiscovered: 5,
          filesProcessed: 5,
          rowsOk: 1000,
          rowsError: 2,
        }),
      ),
    ).toBe("success");
  });
});

describe("isAlertable", () => {
  it("alerts on failed/empty/degraded only", () => {
    expect(isAlertable("success")).toBe(false);
    expect(isAlertable("failed")).toBe(true);
    expect(isAlertable("empty")).toBe(true);
    expect(isAlertable("degraded")).toBe(true);
  });
});
