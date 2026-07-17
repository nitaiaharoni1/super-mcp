/** Run async work over items with a fixed concurrency limit. Results preserve input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** SUPER_MCP_CONCURRENCY — used by ingestion file fetch and DB pool sizing. */
export function fileConcurrency(defaultVal = 12, max = 48): number {
  const raw = process.env.SUPER_MCP_CONCURRENCY;
  if (raw == null || raw === "") return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(Math.floor(n), max);
}
