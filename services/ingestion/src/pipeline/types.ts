export interface PipelineResult {
  sourceId: string;
  status: "success" | "failed" | "empty" | "degraded";
  filesDiscovered: number;
  filesProcessed: number;
  /** PriceFull/PromoFull files selected at discover time; 0 means metadata-only. */
  priceFilesDiscovered: number;
  rowsOk: number;
  rowsError: number;
  errorSummary?: string;
}

/** A run whose rows are mostly errors parsed but produced garbage: surface it as degraded. */
export const DEGRADED_ERROR_RATIO = 0.5;

/** Whole-file fetch/parse failures only bump rowsError by 1 each. */
export const DEGRADED_FILE_FAILURE_RATIO = 0.3;

export const MAX_TRANSIENT_FILE_ATTEMPTS = 3;
