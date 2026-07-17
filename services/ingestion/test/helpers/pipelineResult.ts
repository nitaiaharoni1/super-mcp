import type { PipelineResult } from "../../src/pipeline.js";

export function makePipelineResult(partial: Partial<PipelineResult> = {}): PipelineResult {
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

export function makeSuccessfulPipelineResult(): PipelineResult {
  return makePipelineResult({
    filesDiscovered: 1,
    filesProcessed: 1,
    rowsOk: 10,
  });
}
