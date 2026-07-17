import { getPool } from "../client/index.js";

export type MissKind =
  | "promo_other"
  | "unit_unparseable"
  | "region_unmatched"
  | "ontology_no_hit";

export interface MatchMiss {
  kind: MissKind;
  term: string;
  count?: number;
  context?: Record<string, unknown>;
}

/** Upsert miss counters. Telemetry only: callers must treat failure as non-fatal. */
export async function recordMisses(misses: MatchMiss[]): Promise<void> {
  if (misses.length === 0) return;
  const pool = getPool();
  for (const m of misses) {
    const term = m.term.trim().slice(0, 200);
    if (!term) continue;
    await pool.query(
      // hit_count accumulates and last_seen tracks recency; context stays as the
      // first-seen provenance (a single chainId can't represent all later hits).
      `INSERT INTO match_miss (kind, term, context, hit_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, term) DO UPDATE SET
         hit_count = match_miss.hit_count + EXCLUDED.hit_count,
         last_seen = now()`,
      [m.kind, term, JSON.stringify(m.context ?? {}), m.count ?? 1],
    );
  }
}

export interface TopMissRow {
  kind: string;
  term: string;
  hit_count: string;
  last_seen: Date;
  context: Record<string, unknown>;
}

export async function topMisses(kind: MissKind, limit = 50): Promise<TopMissRow[]> {
  const res = await getPool().query<TopMissRow>(
    `SELECT kind, term, hit_count, last_seen, context
     FROM match_miss WHERE kind = $1
     ORDER BY hit_count DESC, last_seen DESC LIMIT $2`,
    [kind, limit],
  );
  return res.rows;
}
