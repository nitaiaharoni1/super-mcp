export * from "./client/index.js";
export * from "./queries/index.js";
export { sqlNormalizeGtin } from "./schema/gtinSql.js";
export {
  runMigrations,
  type RunMigrationsOptions,
  type RunMigrationsResult,
} from "./schema/migrate.js";
export {
  drainSemanticIndex,
  embedText,
  getCachedQueryEmbedding,
  getEmbedder,
  loadOntologySnapshot,
  markProductsDirty,
  putCachedQueryEmbedding,
  type DrainSemanticIndexOptions,
  type DrainSemanticIndexResult,
} from "./queries/semantic/index.js";
