/**
 * CLI wrapper around drainSemanticIndex.
 *
 *   pnpm --filter @super-mcp/db embed-products
 *   pnpm --filter @super-mcp/db embed-products -- --limit=5000 --force
 *   pnpm --filter @super-mcp/db embed-products -- --dirty-only --backend=hasher
 */
import { closePool } from "../client/index.js";
import { drainSemanticIndex } from "../queries/semantic/index.js";

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const force = argFlag("force");
  const dirtyOnly = argFlag("dirty-only");
  const limit = Math.max(1, Number(argValue("limit") ?? "50000") || 50_000);
  const backendRaw = argValue("backend")?.toLowerCase();
  const backend =
    backendRaw === "hasher" || backendRaw === "transformers" ? backendRaw : undefined;
  // Ontology refreshes can enqueue the full catalog; keep draining batches until empty
  // unless the caller set an explicit --limit (one-shot) or --force (already full scan).
  const drainUntilEmpty = dirtyOnly && !force && !argValue("limit");

  let pass = 0;
  for (;;) {
    pass += 1;
    const result = await drainSemanticIndex({
      limit,
      force,
      // CLI default: backfill missing + dirty. Use --dirty-only for queue drain only.
      dirtyOnly: dirtyOnly ? true : false,
      backend,
      model: argValue("model"),
      ontologyVersion: argValue("ontology"),
    });
    if (!drainUntilEmpty || result.remainingDirty === 0 || result.queued === 0) {
      break;
    }
    console.log(
      JSON.stringify({
        event: "semantic_index_continue",
        pass,
        remainingDirty: result.remainingDirty,
      }),
    );
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
