import type { ResolvedItem } from "./types.js";

/**
 * In-process snapshot of an initial call's resolved lines, so a resume can skip
 * re-resolving the lines that weren't questioned. Keyed by an opaque nonce that
 * is frozen into the signed continuation. This is a pure performance cache: a
 * miss (process restart, eviction, TTL, or a different instance) simply falls
 * back to a full re-resolve — never a correctness change.
 *
 * TTL matches the continuation token lifetime; a bounded LRU-ish cap keeps memory
 * flat under load (oldest entries evicted first).
 */
const RESOLUTION_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;

interface CacheEntry {
  items: ResolvedItem[];
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export function putResolution(key: string, items: ResolvedItem[], now = Date.now()): void {
  if (store.size >= MAX_ENTRIES) {
    sweep(now);
    // Still full after sweeping live entries → drop the oldest (insertion order).
    while (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  // Snapshot so later mutation of the returned items (coverage enrichment stamps
  // intentMode/equivalents onto resolved lines) cannot corrupt the cached copy.
  store.set(key, { items: structuredClone(items), expiresAt: now + RESOLUTION_TTL_MS });
}

/** Returns a fresh clone of the cached lines, or null on miss/expiry. */
export function getResolution(key: string, now = Date.now()): ResolvedItem[] | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return structuredClone(entry.items);
}

/** Test-only: clear the cache between cases. */
export function clearResolutionCache(): void {
  store.clear();
}
