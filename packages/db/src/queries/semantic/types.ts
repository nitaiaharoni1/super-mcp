export interface DrainSemanticIndexOptions {
  limit?: number;
  force?: boolean;
  /** Only process rows in semantic_index_dirty (default true for ingest). */
  dirtyOnly?: boolean;
  model?: string;
  ontologyVersion?: string;
  /** hasher | transformers (default transformers, hasher for tests/CI). */
  backend?: "hasher" | "transformers";
}

export interface DrainSemanticIndexResult {
  model: string;
  ontologyVersion: string;
  backend: "hasher" | "transformers";
  queued: number;
  processed: number;
  skipped: number;
  failed: number;
  remainingDirty: number;
  durationMs: number;
}

export type EmbedFn = (text: string) => Promise<number[]>;

export interface CandidateRow {
  id: string;
  name: string;
  brand: string | null;
  category_l1: string | null;
  category_l2: string | null;
  listing_names: string[] | null;
  embed_hash: string | null;
  profile_hash: string | null;
  dirty: boolean;
}
