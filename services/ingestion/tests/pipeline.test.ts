import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  isAlertable,
  isTransientIngestionError,
} from "../src/pipeline.js";
import { makePipelineResult } from "../test/helpers/pipelineResult.js";

describe("classifyStatus", () => {
  it("fails when no files were processed", () => {
    expect(classifyStatus(makePipelineResult({ filesDiscovered: 5, filesProcessed: 0, rowsError: 5 }))).toBe(
      "failed",
    );
  });

  it("fails when all processed rows errored", () => {
    expect(
      classifyStatus(makePipelineResult({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 0, rowsError: 10 })),
    ).toBe("failed");
  });

  it("marks empty when files processed but no rows", () => {
    expect(
      classifyStatus(makePipelineResult({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 0, rowsError: 0 })),
    ).toBe("empty");
  });

  it("degrades when most discovered files fail even if row ratio looks green", () => {
    expect(
      classifyStatus(
        makePipelineResult({
          filesDiscovered: 5,
          filesProcessed: 2,
          rowsOk: 5000,
          rowsError: 3,
        }),
      ),
    ).toBe("degraded");
  });

  it("degrades a metadata-only run (rows ingested but zero price/promo files selected)", () => {
    expect(
      classifyStatus(
        makePipelineResult({ filesDiscovered: 1, filesProcessed: 1, rowsOk: 200, priceFilesDiscovered: 0 }),
      ),
    ).toBe("degraded");
  });

  it("degrades when row errors exceed the threshold", () => {
    expect(
      classifyStatus(
        makePipelineResult({
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
        makePipelineResult({
          filesDiscovered: 5,
          filesProcessed: 5,
          rowsOk: 1000,
          rowsError: 2,
        }),
      ),
    ).toBe("success");
  });

  it("degrades when any discovered file goes unprocessed (10% loss is not success)", () => {
    expect(
      classifyStatus(
        makePipelineResult({
          filesDiscovered: 10,
          priceFilesDiscovered: 9,
          filesProcessed: 9,
          rowsOk: 1000,
          rowsError: 0,
        }),
      ),
    ).toBe("degraded");
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

describe("isTransientIngestionError", () => {
  it("retries dropped connections and common network resets", () => {
    expect(
      isTransientIngestionError(
        "Client is closed because Server sent FIN packet unexpectedly, closing connection.",
      ),
    ).toBe(true);
    expect(isTransientIngestionError("read ECONNRESET")).toBe(true);
    expect(isTransientIngestionError("connection terminated unexpectedly")).toBe(true);
  });

  it("does not retry deterministic parse errors", () => {
    expect(isTransientIngestionError("Invalid XML at line 42")).toBe(false);
  });
});
