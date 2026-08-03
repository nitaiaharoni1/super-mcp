export interface ChainDiverseRow {
  product_id: string;
  /** Chain that carries a priced listing — used to diversify the capped peer set. */
  chain_id?: string | null;
  /** Cheapest in-scope store price for this product — used to retain store minima. */
  min_price?: number | string | null;
  /** In-scope stores that price this product — used to guarantee per-storefront coverage. */
  store_ids?: readonly string[] | null;
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
      // Draining a queue IS progress, even when the row was already taken by the
      // cheapest-seed above. Treating only a push as progress ended the whole
      // round-robin on the first pass whenever the seed happened to head a queue —
      // and for a single-chain peer set that is always, so a line with 40
      // interchangeable SKUs went to pricing with exactly ONE.
      if (!next) continue;
      progressed = true;
      if (!seen.has(next.product_id)) push(next);
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

/**
 * Cap a peer set so that EVERY in-scope storefront keeps something it can price.
 *
 * The peer set has one job: let each storefront fill the line with the SKU it
 * actually stocks. A flat cap diversified by chain does not deliver that. Chains
 * are not storefronts (Carrefour ONLINE, יינות ביתן and Quik are one chain id but
 * three assortments and three price books), and a storefront whose only
 * compatible SKUs are expensive gets crowded out by a cheaper rival's shelf. The
 * line is then reported `not_carried_by_chain` — while that storefront prices
 * dozens of the same commodity. Shufersal ONLINE prices 93 hand soaps and still
 * answered `no_price_data` for "סבון ידיים" this way.
 *
 * Greedy set cover on price: hardest-to-serve storefront first, cheapest peer
 * that serves it, then fill by price. Coverage picks are never truncated — at
 * most one per storefront — because a cap that drops them recreates the bug.
 */
export function selectCoveringPeers<T extends ChainDiverseRow>(
  rows: T[],
  storeIds: readonly string[],
  max: number,
): T[] {
  if (rows.length <= max) return rows;
  const hasStoreInfo = rows.some((r) => (r.store_ids?.length ?? 0) > 0);
  if (storeIds.length === 0 || !hasStoreInfo) return diversifyByChain(rows, max);

  const byPrice = [...rows].sort(
    (a, b) => rowMinPrice(a) - rowMinPrice(b) || a.product_id.localeCompare(b.product_id),
  );
  const inScope = new Set(storeIds);
  const serving = new Map<string, T[]>();
  for (const row of byPrice) {
    for (const storeId of row.store_ids ?? []) {
      if (!inScope.has(storeId)) continue;
      const list = serving.get(storeId) ?? [];
      list.push(row);
      serving.set(storeId, list);
    }
  }

  const out: T[] = [];
  const taken = new Set<string>();
  const covered = new Set<string>();
  const push = (row: T): void => {
    if (taken.has(row.product_id)) return;
    taken.add(row.product_id);
    out.push(row);
    for (const storeId of row.store_ids ?? []) covered.add(storeId);
  };

  // Fewest options first: a storefront served by one SKU must claim it before a
  // well-stocked rival spends the budget.
  const storesByScarcity = [...serving.entries()].sort(
    (a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]),
  );
  for (const [storeId, candidates] of storesByScarcity) {
    if (covered.has(storeId)) continue;
    const pick = candidates[0];
    if (pick) push(pick);
  }

  for (const row of byPrice) {
    if (out.length >= max) break;
    push(row);
  }
  return out;
}
