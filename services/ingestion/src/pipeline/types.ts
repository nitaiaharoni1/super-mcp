export interface PipelineResult {
  sourceId: string;
  status: "success" | "failed" | "empty" | "degraded";
  filesDiscovered: number;
  filesProcessed: number;
  /** PriceFull/PromoFull files selected at discover time; 0 means metadata-only. */
  priceFilesDiscovered: number;
  rowsOk: number;
  rowsError: number;
  promoOtherRows: number;
  unitUnparseableRows: number;
  regionFilteredStores: number;
  /** Stores whose city was recovered from the branch name (feed <City> empty). */
  storeCityFromName: number;
  /** store_price rows deleted because a full snapshot no longer listed them. */
  pricesReconciled: number;
  /**
   * Configured chains that produced no files at all this run. A chain we tried
   * and got nothing from is lost coverage, never a success.
   */
  chainsWithNoFiles: string[];
  /** Chains that yielded files but zero usable rows. */
  chainsWithNoRows: string[];
  errorSummary?: string;
}

/** A run whose rows are mostly errors parsed but produced garbage: surface it as degraded. */
export const DEGRADED_ERROR_RATIO = 0.5;

export const MAX_TRANSIENT_FILE_ATTEMPTS = 3;
