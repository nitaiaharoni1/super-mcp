import type { StoreSummary } from "../stores/index.js";

/**
 * Which stores feed the resolution SIGNALS: product search scope, local
 * availability counts, and commodity-coverage peers. Pricing always uses every
 * eligible store; this only bounds the three store-scoped queries that made a
 * 126-store basket take 12.6s.
 *
 * It cannot be "the nearest N". Coverage peers are fetched with
 * `WHERE sp.store_id = ANY(...)` and partitioned by chain, so a chain with no
 * store in the sample contributes NO equivalents — and then every branch of that
 * chain reports `not_carried_by_chain` for commodity lines, gets its price
 * imputed, and can never win. Measured in Herzliya: of the 9 chains inside 10km,
 * a nearest-40 slice contained only 6, dropping קשת טעמים, אושר עד and
 * סטופ מרקט outright and leaving יוחננוף with a single store. Those are the
 * discount chains, i.e. exactly the ones a cheapest-basket answer depends on.
 *
 * So the sample is round-robin across chains, nearest first: every chain present
 * in scope is represented before any chain gets a second store. That keeps the
 * store count (and the latency) bounded while making the per-chain question the
 * coverage query actually asks answerable for every chain.
 */

/** Upper bound on stores fed to the signal queries. */
export const MAX_SIGNAL_STORES = 60;

/**
 * Round-robin the distance-ordered candidates by chain.
 *
 * `candidateStores` arrives ordered by distance (listStores ORDER BY), so taking
 * the head of each chain's queue in turn yields each chain's nearest branches
 * first. Deterministic for a deterministic input order, which matters because a
 * resume must reproduce the same sample.
 */
export function selectSignalStores(
  candidateStores: StoreSummary[],
  limit: number = MAX_SIGNAL_STORES,
): string[] {
  if (candidateStores.length <= limit) return candidateStores.map((store) => store.id);

  const byChain = new Map<string, StoreSummary[]>();
  for (const store of candidateStores) {
    const bucket = byChain.get(store.chainId);
    if (bucket) bucket.push(store);
    else byChain.set(store.chainId, [store]);
  }

  // Never let the cap drop a chain entirely — that is the exact failure this
  // module exists to prevent, and a hard cap below the chain count would
  // reintroduce it via chain count instead of distance. Israel has 10 chains today
  // so this does not bind, but the invariant should hold by construction rather
  // than by luck.
  const effectiveLimit = Math.max(limit, byChain.size);

  // Insertion order of the Map follows first appearance, i.e. each chain's
  // nearest store, so chains closer to the shopper get picked first on each pass.
  const queues = [...byChain.values()];
  const picked: string[] = [];
  let round = 0;
  while (picked.length < effectiveLimit) {
    let addedThisRound = false;
    for (const queue of queues) {
      if (picked.length >= effectiveLimit) break;
      const store = queue[round];
      if (store == null) continue;
      picked.push(store.id);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return picked;
}
