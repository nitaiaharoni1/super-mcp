/**
 * Precompute-on-change semantic indexer.
 * Embeds product text with a local multilingual model (or hasher fallback)
 * and writes product_embedding + product_semantic_profile.
 */
import {
  DEFAULT_EMBED_DIMS,
  buildProductEmbedText,
  embedInputHash,
  formatVectorLiteral,
  profileFromText,
} from "@super-mcp/shared";
import { getPool } from "../../client/index.js";
import { resolveBackend, resolveModel, resolveOntology } from "./config.js";
import { getEmbedder } from "./embedder.js";
import { loadOntologySnapshot } from "./ontology.js";
import type { CandidateRow, DrainSemanticIndexOptions, DrainSemanticIndexResult } from "./types.js";

export async function drainSemanticIndex(
  opts: DrainSemanticIndexOptions = {},
): Promise<DrainSemanticIndexResult> {
  const started = Date.now();
  const pool = getPool();
  const model = resolveModel(opts.model);
  const ontologyVersion = resolveOntology(opts.ontologyVersion);
  const backend = resolveBackend(opts.backend);
  const limit = Math.max(1, opts.limit ?? 50_000);
  const force = Boolean(opts.force);
  const dirtyOnly = opts.dirtyOnly !== false;

  const ontology = await loadOntologySnapshot(pool, ontologyVersion);
  const embed = await getEmbedder(backend, model);

  // Selection modes:
  // - force: all products (subject to limit)
  // - dirtyOnly: only semantic_index_dirty rows
  // - default (!dirtyOnly): dirty OR missing embedding/profile for this generation
  const candidates = await pool.query<CandidateRow>(
    `SELECT p.id, p.name, p.brand, p.category_l1, p.category_l2,
            ARRAY(
              SELECT l.name FROM listing l
              WHERE l.product_id = p.id AND l.name IS NOT NULL AND btrim(l.name) <> ''
              ORDER BY l.name
              LIMIT 12
            ) AS listing_names,
            pe.input_hash AS embed_hash,
            psp.input_hash AS profile_hash,
            (d.product_id IS NOT NULL) AS dirty
     FROM product p
     LEFT JOIN product_embedding pe ON pe.product_id = p.id AND pe.model = $1
     LEFT JOIN product_semantic_profile psp
       ON psp.product_id = p.id AND psp.ontology_version = $2
     LEFT JOIN semantic_index_dirty d ON d.product_id = p.id
     WHERE (
       $3::boolean
       OR ($4::boolean AND d.product_id IS NOT NULL)
       OR (
         NOT $4::boolean
         AND (
           d.product_id IS NOT NULL
           OR pe.product_id IS NULL
           OR psp.product_id IS NULL
           OR pe.input_hash IS DISTINCT FROM psp.input_hash
         )
       )
     )
     ORDER BY (d.product_id IS NOT NULL) DESC, p.updated_at DESC NULLS LAST, p.id
     LIMIT $5`,
    [model, ontology.version, force, dirtyOnly, limit],
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  console.log(
    JSON.stringify({
      event: "semantic_index_start",
      model,
      ontologyVersion: ontology.version,
      backend,
      candidates: candidates.rows.length,
      force,
      dirtyOnly,
    }),
  );

  for (const row of candidates.rows) {
    try {
      const text = buildProductEmbedText({
        name: row.name,
        brand: row.brand,
        categoryL1: row.category_l1,
        categoryL2: row.category_l2,
        listingNames: row.listing_names ?? [],
      });
      const hash = embedInputHash(text);
      // Dirty rows are often ontology/policy refreshes: product text (and thus
      // embedInputHash) is unchanged, but profiles must still be rebuilt.
      // Never treat a dirty row as "profile current" on text-hash alone.
      const isDirty = Boolean(row.dirty);
      const profileCurrent = !force && !isDirty && row.profile_hash === hash;
      const embedCurrent = !force && row.embed_hash === hash;

      if (profileCurrent && embedCurrent) {
        await pool.query(`DELETE FROM semantic_index_dirty WHERE product_id = $1`, [row.id]);
        skipped++;
        continue;
      }

      const profile = profileFromText(text, ontology);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (!embedCurrent) {
          const vec = await embed(text);
          const literal = formatVectorLiteral(vec);
          await client.query(
            `INSERT INTO product_embedding (product_id, embedding, model, input_hash, dims, embedded_at)
             VALUES ($1, $2::vector, $3, $4, $5, now())
             ON CONFLICT (product_id, model) DO UPDATE SET
               embedding = EXCLUDED.embedding,
               input_hash = EXCLUDED.input_hash,
               dims = EXCLUDED.dims,
               embedded_at = now()`,
            [row.id, literal, model, hash, DEFAULT_EMBED_DIMS],
          );
        }
        if (!profileCurrent) {
          await client.query(
            `INSERT INTO product_semantic_profile
               (product_id, ontology_version, attributes, concepts, penalties, concept_terms, input_hash, profiled_at)
             VALUES ($1, $2, $3::jsonb, $4::text[], $5::text[], $6::text[], $7, now())
             ON CONFLICT (product_id, ontology_version) DO UPDATE SET
               attributes = EXCLUDED.attributes,
               concepts = EXCLUDED.concepts,
               penalties = EXCLUDED.penalties,
               concept_terms = EXCLUDED.concept_terms,
               input_hash = EXCLUDED.input_hash,
               profiled_at = now()`,
            [
              row.id,
              ontology.version,
              JSON.stringify(profile.attributes),
              profile.concepts,
              profile.penalties,
              profile.conceptTerms,
              hash,
            ],
          );
        }
        await client.query(`DELETE FROM semantic_index_dirty WHERE product_id = $1`, [row.id]);
        await client.query("COMMIT");
        processed++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      if ((processed + skipped) % 100 === 0) {
        console.log(
          JSON.stringify({
            event: "semantic_index_progress",
            processed,
            skipped,
            failed,
          }),
        );
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await pool.query(
        `INSERT INTO semantic_index_dirty (product_id, reason, attempts, last_error, enqueued_at)
         VALUES ($1, 'index_failed', 1, $2, now())
         ON CONFLICT (product_id) DO UPDATE SET
           attempts = semantic_index_dirty.attempts + 1,
           last_error = EXCLUDED.last_error,
           enqueued_at = semantic_index_dirty.enqueued_at`,
        [row.id, message.slice(0, 2000)],
      );
      console.error(
        JSON.stringify({
          event: "semantic_index_item_failed",
          productId: row.id,
          error: message,
        }),
      );
    }
  }

  const remaining = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM semantic_index_dirty`,
  );

  const result: DrainSemanticIndexResult = {
    model,
    ontologyVersion: ontology.version,
    backend,
    queued: candidates.rows.length,
    processed,
    skipped,
    failed,
    remainingDirty: Number(remaining.rows[0]?.n ?? 0),
    durationMs: Date.now() - started,
  };

  console.log(JSON.stringify({ event: "semantic_index_done", ...result }));
  return result;
}

/** Mark products dirty (idempotent). */
export async function markProductsDirty(productIds: string[], reason: string): Promise<number> {
  if (productIds.length === 0) return 0;
  const res = await getPool().query(
    `INSERT INTO semantic_index_dirty (product_id, reason)
     SELECT unnest($1::uuid[]), $2
     ON CONFLICT (product_id) DO UPDATE SET reason = EXCLUDED.reason, enqueued_at = now()`,
    [productIds, reason],
  );
  return res.rowCount ?? 0;
}
