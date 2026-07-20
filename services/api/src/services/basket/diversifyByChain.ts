export interface ChainDiverseRow {
  product_id: string;
  /** Chain that carries a priced listing — used to diversify the capped peer set. */
  chain_id?: string | null;
  /** Cheapest in-scope store price for this product — used to retain store minima. */
  min_price?: number | string | null;
}

function rowMinPrice(row: ChainDiverseRow): number {
  const n = Number(row.min_price);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Round-robin across chains, then fill remaining slots. Soft-cap: the cheapest
 * compatible peer is always kept even when the diversity fill would drop it.
 */
export function diversifyByChain<T extends ChainDiverseRow>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const cheapest = [...rows].sort(
    (a, b) => rowMinPrice(a) - rowMinPrice(b) || a.product_id.localeCompare(b.product_id),
  )[0]!;

  const byChain = new Map<string, T[]>();
  const noChain: T[] = [];
  for (const row of rows) {
    const key = row.chain_id?.trim();
    if (!key) {
      noChain.push(row);
      continue;
    }
    const list = byChain.get(key) ?? [];
    list.push(row);
    byChain.set(key, list);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const push = (row: T) => {
    if (seen.has(row.product_id) || out.length >= max) return;
    seen.add(row.product_id);
    out.push(row);
  };
  // Seed with the absolute cheapest so the soft cap cannot hide a store minimum.
  push(cheapest);

  const queues = [...byChain.values()];
  let progressed = true;
  while (out.length < max && progressed) {
    progressed = false;
    for (const q of queues) {
      if (out.length >= max) break;
      const next = q.shift();
      if (next && !seen.has(next.product_id)) {
        push(next);
        progressed = true;
      }
    }
  }
  for (const row of noChain) {
    if (out.length >= max) break;
    push(row);
  }
  // If diversity filled every slot without the cheapest (shouldn't happen after
  // seed), force-replace the last slot.
  if (!seen.has(cheapest.product_id)) {
    out[out.length - 1] = cheapest;
  }
  return out;
}
