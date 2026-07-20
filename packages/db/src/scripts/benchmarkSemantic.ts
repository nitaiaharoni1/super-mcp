/**
 * Labeled quality snapshot for semantic resolution.
 *
 *   pnpm db:benchmark-semantic
 *   SUPER_MCP_EMBED_BACKEND=hasher pnpm db:benchmark-semantic
 *
 * Basket resolve latency (warm resolveBasketLines):
 *   pnpm db:benchmark-semantic -- --basket
 *   pnpm db:benchmark-semantic -- --basket --city=… --near=lat,lng --fixture=path.json
 *
 * Loads packages/db/tests/fixtures/semantic-benchmark.json (or --fixture).
 * When DATABASE_URL / embeddings / catalog are unavailable, prints a structured
 * report with zeros/skipped and exits 0. Exit 1 only on hard script errors
 * (missing/invalid fixture).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import {
  DEFAULT_ONTOLOGY_VERSION,
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
  cityMatchKeys,
  embedInputHash,
  escapeIlike,
  extractConstraints,
  formatVectorLiteral,
  gateAgainstConstraints,
  normalizeEmbedInput,
  resolveEmbedBackend,
  resolveEmbedModel,
  type OntologySnapshot,
  type SemanticSearchConfig,
} from "@super-mcp/shared";
import { closePool, getPool } from "../client/index.js";
import {
  embedText,
  getCachedQueryEmbedding,
  loadOntologySnapshot,
  putCachedQueryEmbedding,
} from "../queries/semantic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../tests/fixtures/semantic-benchmark.json",
);
const BBQ_FIXTURE_PATH = path.resolve(
  __dirname,
  "../../tests/fixtures/herzliya-bbq-golden.json",
);

/** SPEC search p95 budget (ms). */
/** Full-catalog ANN on local Postgres; keep tight enough to catch regressions. */
const LATENCY_P95_BUDGET_MS = 1000;
const MIN_VECTOR_COVERAGE = 0.5;
const MIN_PROFILE_COVERAGE = 0.1;
const MAX_UNSAFE_RATE = 0.05;
const EXPECTED_BBQ_QUERIES = [
  "פרגיות",
  "קבבים",
  "אנטרקוט",
  "פיתות",
  "חומוס",
  "טחינה",
  "מלח גס",
  "עגבניות",
  "מלפפונים",
  "פלפלים",
  "בצלים",
  "חסה",
  "לימונים",
  "אבטיח",
  "קולה",
  "יין",
  "קפה טייסטרס צ׳ויס",
  "קרח",
] as const;

interface FixtureLocation {
  city?: string;
  near?: { lat: number; lng: number };
}

interface FixtureCase {
  query: string;
  location?: FixtureLocation;
  acceptableProductIds: string[];
  forbiddenProductIds: string[];
  acceptableNameSubstrings?: string[];
  forbiddenNameSubstrings?: string[];
  notes?: string;
}

interface FixtureFile {
  version?: number;
  description?: string;
  k?: number;
  cases: FixtureCase[];
}

interface Hit {
  id: string;
  name: string;
  brand: string | null;
  score: number;
  hasLocalPrice: boolean;
  vectorDistance?: number;
}

interface RankedHit extends Hit {
  lexicalRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
}

interface QueryTiming {
  totalMs: number;
  lexicalMs: number;
  vectorMs: number;
}

interface QueryEval {
  query: string;
  lexicalRecall: boolean | null;
  vectorRecall: boolean | null;
  fusedRecall: boolean | null;
  localTop1: boolean | null;
  unsafe: boolean | null;
  forbiddenHit: boolean | null;
  missing: boolean;
  cacheHit: boolean | null;
  timing: QueryTiming;
  skippedReason?: string;
}

function loadFixture(filePath: string): FixtureFile {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read fixture at ${filePath}: ${err}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in fixture ${filePath}: ${err}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as FixtureFile).cases)) {
    throw new Error(`Fixture ${filePath} must contain a "cases" array`);
  }
  return parsed as FixtureFile;
}

function assertExactBbqFixture(fixture: FixtureFile): void {
  const actualQueries = fixture.cases.map((row) => row.query);
  if (
    actualQueries.length !== EXPECTED_BBQ_QUERIES.length ||
    actualQueries.some((query, index) => query !== EXPECTED_BBQ_QUERIES[index])
  ) {
    throw new Error(
      `BBQ acceptance fixture must contain exactly ${EXPECTED_BBQ_QUERIES.length} ordered Hebrew lines`,
    );
  }
  for (const row of fixture.cases) {
    if (
      !Array.isArray(row.forbiddenNameSubstrings) ||
      row.forbiddenNameSubstrings.length === 0
    ) {
      throw new Error(`BBQ acceptance line "${row.query}" must declare forbidden classes`);
    }
  }
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? null;
}

function nameMatches(name: string, substrings: string[] | undefined): boolean {
  if (!substrings || substrings.length === 0) return false;
  const lower = name.toLowerCase();
  return substrings.some((s) => s && lower.includes(s.toLowerCase()));
}

function isPlaceholderId(id: string): boolean {
  return /^00000000-0000-/i.test(id);
}

function isAcceptable(hit: Hit, row: FixtureCase): boolean {
  if (row.acceptableProductIds.includes(hit.id)) return true;
  const concreteIds = row.acceptableProductIds.filter((id) => !isPlaceholderId(id));
  // Name substrings when unlabeled, or when only placeholder UUIDs were supplied for wiring.
  if (concreteIds.length === 0) {
    return nameMatches(hit.name, row.acceptableNameSubstrings);
  }
  return false;
}

function isForbidden(hit: Hit, row: FixtureCase): boolean {
  if (row.forbiddenProductIds.includes(hit.id)) return true;
  return nameMatches(hit.name, row.forbiddenNameSubstrings);
}

function forbiddenTop1Hit(top1: Hit | null, row: FixtureCase): boolean | null {
  if (!row.forbiddenNameSubstrings?.length) return null;
  if (!top1) return false;
  return isForbidden(top1, row);
}

function toBenchmarkCase(row: FixtureCase): FixtureCase {
  return {
    query: row.query,
    location: row.location ?? { city: "Herzliya" },
    acceptableProductIds: row.acceptableProductIds ?? [],
    forbiddenProductIds: row.forbiddenProductIds ?? [],
    acceptableNameSubstrings: row.acceptableNameSubstrings,
    forbiddenNameSubstrings: row.forbiddenNameSubstrings,
    notes: row.notes,
  };
}

function recallAtK(hits: Hit[], row: FixtureCase, k: number): boolean | null {
  const hasLabels =
    row.acceptableProductIds.length > 0 || (row.acceptableNameSubstrings?.length ?? 0) > 0;
  if (!hasLabels) return null;
  const top = hits.slice(0, k);
  return top.some((h) => isAcceptable(h, row));
}

function fuseLists(
  lexical: Hit[],
  vector: Hit[],
  config: SemanticSearchConfig,
): RankedHit[] {
  const byId = new Map<string, RankedHit>();

  const ensure = (hit: Hit): RankedHit => {
    let c = byId.get(hit.id);
    if (!c) {
      c = {
        ...hit,
        lexicalRank: null,
        vectorRank: null,
        fusedScore: 0,
      };
      byId.set(hit.id, c);
    }
    return c;
  };

  for (let i = 0; i < lexical.length; i++) {
    const hit = lexical[i]!;
    const c = ensure(hit);
    c.lexicalRank = i + 1;
    c.name = hit.name;
    c.brand = hit.brand;
    c.hasLocalPrice = hit.hasLocalPrice;
    c.fusedScore += config.lexicalRrfWeight / (config.rrfK + (i + 1));
  }

  for (let i = 0; i < vector.length; i++) {
    const hit = vector[i]!;
    const c = ensure(hit);
    c.vectorRank = i + 1;
    c.vectorDistance = hit.vectorDistance ?? c.vectorDistance;
    if (c.lexicalRank == null) {
      c.name = hit.name;
      c.brand = hit.brand;
      c.hasLocalPrice = hit.hasLocalPrice;
    }
    c.fusedScore += config.vectorRrfWeight / (config.rrfK + (i + 1));
  }

  const fused = [...byId.values()];
  fused.sort((a, b) => {
    if (a.fusedScore !== b.fusedScore) return b.fusedScore - a.fusedScore;
    return a.name.localeCompare(b.name, "he");
  });
  for (const c of fused) c.score = c.fusedScore;
  return fused;
}

async function lexicalSearch(
  pool: Pool,
  queryText: string,
  city: string | undefined,
  limit: number,
): Promise<Hit[]> {
  const q = queryText.trim();
  if (!q) return [];
  const qLike = escapeIlike(q);
  const params: unknown[] = [q, qLike, limit];
  let localExists = "FALSE";
  if (city) {
    params.push(cityMatchKeys(city));
    localExists = `EXISTS (
      SELECT 1 FROM listing l
      JOIN store_price sp ON sp.listing_id = l.id
      JOIN store st ON st.id = sp.store_id
      WHERE l.product_id = p.id AND sp.price > 0
        AND st.city = ANY($4::text[])
    )`;
  }

  const sql = `
    SELECT p.id::text AS id, p.name, p.brand,
           GREATEST(
             CASE
               WHEN p.name ILIKE $2 || '%' ESCAPE '\\' THEN 0.95
               WHEN p.name ILIKE '%' || $2 || '%' ESCAPE '\\' THEN 0.78
               ELSE 0
             END,
             COALESCE(similarity(p.name, $1), 0)
           ) AS score,
           ${localExists} AS has_local_price
    FROM product p
    WHERE p.name ILIKE '%' || $2 || '%' ESCAPE '\\'
       OR p.name % $1
       OR ($1 <> '' AND p.search_vector @@ websearch_to_tsquery('simple', $1))
    ORDER BY score DESC, p.name ASC
    LIMIT $3`;

  const res = await pool.query<{
    id: string;
    name: string;
    brand: string | null;
    score: string | number;
    has_local_price: boolean;
  }>(sql, params);

  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    brand: r.brand,
    score: Number(r.score),
    hasLocalPrice: Boolean(r.has_local_price),
  }));
}

async function vectorSearch(
  pool: Pool,
  vector: number[],
  model: string,
  city: string | undefined,
  limit: number,
  maxDistance: number,
): Promise<Hit[]> {
  const literal = formatVectorLiteral(vector);
  const params: unknown[] = [literal, model, maxDistance, limit];
  let localExists = "FALSE";
  if (city) {
    params.push(cityMatchKeys(city));
    localExists = `EXISTS (
      SELECT 1 FROM listing l
      JOIN store_price sp ON sp.listing_id = l.id
      JOIN store st ON st.id = sp.store_id
      WHERE l.product_id = p.id AND sp.price > 0
        AND st.city = ANY($5::text[])
    )`;
  }

  const sql = `
    SELECT p.id::text AS id, p.name, p.brand,
           (pe.embedding <=> $1::vector) AS vector_distance,
           ${localExists} AS has_local_price
    FROM product_embedding pe
    JOIN product p ON p.id = pe.product_id
    WHERE pe.model = $2
      AND pe.embedding <=> $1::vector <= $3
    ORDER BY pe.embedding <=> $1::vector
    LIMIT $4`;

  const res = await pool.query<{
    id: string;
    name: string;
    brand: string | null;
    vector_distance: string | number;
    has_local_price: boolean;
  }>(sql, params);

  return res.rows.map((r) => {
    const distance = Number(r.vector_distance);
    return {
      id: r.id,
      name: r.name,
      brand: r.brand,
      score: Math.max(0, Math.min(1, 1 - distance)),
      hasLocalPrice: Boolean(r.has_local_price),
      vectorDistance: distance,
    };
  });
}

async function embedQueryCached(
  queryText: string,
  model: string,
  backend: "hasher" | "transformers",
): Promise<{ vector: number[]; cacheHit: boolean } | null> {
  const normalizedQuery = normalizeEmbedInput(queryText);
  const queryHash = embedInputHash(normalizedQuery);
  try {
    const cached = await getCachedQueryEmbedding(queryHash, model);
    if (cached) return { vector: cached, cacheHit: true };
    const vector = await embedText(normalizedQuery, model, backend);
    await putCachedQueryEmbedding({ queryHash, normalizedQuery, model, vector });
    return { vector, cacheHit: false };
  } catch {
    return null;
  }
}

async function probeDb(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function loadCoverage(
  pool: Pool,
  model: string,
  ontologyVersion: string,
): Promise<{
  products: number;
  embeds: number;
  profiles: number;
  dirty: number;
  vectorCoverage: number;
  profileCoverage: number;
}> {
  const coverage = await pool.query<{
    embeds: string;
    profiles: string;
    products: string;
    dirty: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM product_embedding WHERE model = $1) AS embeds,
       (SELECT COUNT(*)::text FROM product_semantic_profile WHERE ontology_version = $2) AS profiles,
       (SELECT COUNT(*)::text FROM product) AS products,
       (SELECT COUNT(*)::text FROM semantic_index_dirty) AS dirty`,
    [model, ontologyVersion],
  );
  const c = coverage.rows[0]!;
  const products = Number(c.products);
  const embeds = Number(c.embeds);
  const profiles = Number(c.profiles);
  return {
    products,
    embeds,
    profiles,
    dirty: Number(c.dirty),
    vectorCoverage: products ? embeds / products : 0,
    profileCoverage: products ? profiles / products : 0,
  };
}

function rate(trues: number, denom: number): number | null {
  if (denom <= 0) return null;
  return trues / denom;
}

function emptyReport(opts: {
  model: string;
  ontologyVersion: string;
  fixturePath: string;
  caseCount: number;
  k: number;
  skippedReason: string;
}): Record<string, unknown> {
  return {
    event: "semantic_benchmark",
    skipped: true,
    skippedReason: opts.skippedReason,
    fixturePath: opts.fixturePath,
    caseCount: opts.caseCount,
    k: opts.k,
    model: opts.model,
    ontologyVersion: opts.ontologyVersion,
    coverage: {
      products: 0,
      embeds: 0,
      profiles: 0,
      dirty: 0,
      vectorCoverage: 0,
      profileCoverage: 0,
      notes: "skipped — coverage unavailable",
    },
    metrics: {
      lexicalRecallAtK: 0,
      vectorRecallAtK: 0,
      fusedRecallAtK: 0,
      localTop1Rate: 0,
      unsafeSubstitutionRate: 0,
      forbiddenHitRate: 0,
      bbqForbiddenHitRate: 0,
      missingLineRate: 0,
      queryCacheHitRate: 0,
      latencyMs: { p50: null, p95: null, samples: 0 },
      labeledLexical: 0,
      labeledVector: 0,
      labeledFused: 0,
    },
    activationGate: {
      coverageOk: false,
      unsafeOk: false,
      fusedBeatsLexical: false,
      latencyOk: false,
      pass: false,
      thresholds: {
        minVectorCoverage: MIN_VECTOR_COVERAGE,
        minProfileCoverage: MIN_PROFILE_COVERAGE,
        maxUnsafeRate: MAX_UNSAFE_RATE,
        latencyP95BudgetMs: LATENCY_P95_BUDGET_MS,
      },
      summary: `SKIPPED: ${opts.skippedReason}`,
    },
  };
}

async function evaluateCase(
  pool: Pool,
  row: FixtureCase,
  opts: {
    k: number;
    model: string;
    backend: "hasher" | "transformers";
    config: SemanticSearchConfig;
    ontology: OntologySnapshot | null;
    vectorAvailable: boolean;
  },
): Promise<QueryEval> {
  const city = row.location?.city;
  const t0 = performance.now();
  let lexical: Hit[] = [];
  let lexicalMs = 0;
  try {
    const tl0 = performance.now();
    lexical = await lexicalSearch(pool, row.query, city, opts.config.lexicalLimit);
    lexicalMs = performance.now() - tl0;
  } catch (err) {
    return {
      query: row.query,
      lexicalRecall: null,
      vectorRecall: null,
      fusedRecall: null,
      localTop1: null,
      unsafe: null,
      forbiddenHit: null,
      missing: true,
      cacheHit: null,
      timing: { totalMs: performance.now() - t0, lexicalMs: 0, vectorMs: 0 },
      skippedReason: err instanceof Error ? err.message : String(err),
    };
  }

  let vector: Hit[] = [];
  let vectorMs = 0;
  let cacheHit: boolean | null = null;
  if (opts.vectorAvailable) {
    const tv0 = performance.now();
    const emb = await embedQueryCached(row.query, opts.model, opts.backend);
    if (emb) {
      cacheHit = emb.cacheHit;
      try {
        vector = await vectorSearch(
          pool,
          emb.vector,
          opts.model,
          city,
          opts.config.vectorLimit,
          opts.config.vectorDistanceMax,
        );
      } catch {
        vector = [];
      }
    }
    vectorMs = performance.now() - tv0;
  }

  const fused =
    vector.length > 0 ? fuseLists(lexical, vector, opts.config) : lexical.map((h, i) => ({
      ...h,
      lexicalRank: i + 1,
      vectorRank: null,
      fusedScore: h.score,
    }));

  // Prefer local stock when city is set (mirrors production ordering).
  const orderedFused = city
    ? [...fused].sort((a, b) => {
        if (a.hasLocalPrice !== b.hasLocalPrice) return a.hasLocalPrice ? -1 : 1;
        if (a.fusedScore !== b.fusedScore) return b.fusedScore - a.fusedScore;
        return a.name.localeCompare(b.name, "he");
      })
    : fused;

  const top1 = orderedFused[0] ?? null;
  const missing = orderedFused.length === 0;

  let unsafe: boolean | null = null;
  let forbiddenHit: boolean | null = null;
  if (top1) {
    forbiddenHit = forbiddenTop1Hit(top1, row);
    unsafe = forbiddenHit === true;
    if (!unsafe && opts.ontology) {
      const constraints = extractConstraints(row.query, opts.ontology);
      if (constraints.length > 0) {
        const gate = gateAgainstConstraints(top1.name, constraints, opts.ontology, {
          queryText: row.query,
        });
        if (!gate.allowed) unsafe = true;
      }
    }
  } else {
    unsafe = false;
    forbiddenHit = row.forbiddenNameSubstrings?.length ? false : null;
  }

  let localTop1: boolean | null = null;
  if (city) {
    localTop1 = top1 ? top1.hasLocalPrice : false;
  }

  return {
    query: row.query,
    lexicalRecall: recallAtK(lexical, row, opts.k),
    vectorRecall: opts.vectorAvailable ? recallAtK(vector, row, opts.k) : null,
    fusedRecall: recallAtK(orderedFused, row, opts.k),
    localTop1,
    unsafe,
    forbiddenHit,
    missing,
    cacheHit,
    timing: {
      totalMs: performance.now() - t0,
      lexicalMs,
      vectorMs,
    },
  };
}

async function runBenchmark(): Promise<Record<string, unknown>> {
  const fixture = loadFixture(FIXTURE_PATH);
  const bbqFixture = loadFixture(BBQ_FIXTURE_PATH);
  assertExactBbqFixture(bbqFixture);
  const k = fixture.k && fixture.k > 0 ? fixture.k : 10;
  const model = resolveEmbedModel();
  const backend = resolveEmbedBackend();
  const caseCount = fixture.cases.length;

  if (!process.env.DATABASE_URL) {
    return emptyReport({
      model,
      ontologyVersion: DEFAULT_ONTOLOGY_VERSION,
      fixturePath: FIXTURE_PATH,
      caseCount,
      k,
      skippedReason: "DATABASE_URL unset",
    });
  }

  let pool: Pool;
  try {
    pool = getPool();
  } catch (err) {
    return emptyReport({
      model,
      ontologyVersion: DEFAULT_ONTOLOGY_VERSION,
      fixturePath: FIXTURE_PATH,
      caseCount,
      k,
      skippedReason: err instanceof Error ? err.message : String(err),
    });
  }

  const reachable = await probeDb(pool);
  if (!reachable) {
    return emptyReport({
      model,
      ontologyVersion: DEFAULT_ONTOLOGY_VERSION,
      fixturePath: FIXTURE_PATH,
      caseCount,
      k,
      skippedReason: "database unreachable",
    });
  }

  let ontology: OntologySnapshot | null = null;
  let ontologyVersion = DEFAULT_ONTOLOGY_VERSION;
  let config: SemanticSearchConfig = { ...DEFAULT_SEMANTIC_SEARCH_CONFIG };
  try {
    ontology = await loadOntologySnapshot(pool, DEFAULT_ONTOLOGY_VERSION);
    ontologyVersion = ontology.version;
    config = ontology.searchConfig ?? config;
  } catch {
    ontology = null;
  }

  let coverageNotes = "ok";
  let coverage = {
    products: 0,
    embeds: 0,
    profiles: 0,
    dirty: 0,
    vectorCoverage: 0,
    profileCoverage: 0,
  };
  try {
    coverage = await loadCoverage(pool, model, ontologyVersion);
    if (coverage.products === 0) coverageNotes = "empty catalog — recall metrics will be zero";
    else if (coverage.embeds === 0) coverageNotes = "no embeddings — vector/fused recall skipped or lexical-only";
  } catch (err) {
    coverageNotes = `coverage query failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Probe whether vector path works (embedding tables + embedder).
  let vectorAvailable = coverage.embeds > 0;
  if (vectorAvailable) {
    const probe = await embedQueryCached("probe", model, backend);
    if (!probe) {
      vectorAvailable = false;
      coverageNotes += "; embedder unavailable — vector metrics skipped";
    }
  }

  const evalOpts = {
    k,
    model,
    backend,
    config,
    ontology,
    vectorAvailable,
  };

  const evals: QueryEval[] = [];
  for (const row of fixture.cases) {
    evals.push(await evaluateCase(pool, row, evalOpts));
  }

  const bbqEvals: QueryEval[] = [];
  const bbqCaseCount = bbqFixture.cases.length;
  for (const row of bbqFixture.cases) {
    bbqEvals.push(await evaluateCase(pool, toBenchmarkCase(row), evalOpts));
  }

  const latencies = evals.map((e) => e.timing.totalMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  const labeledLexical = evals.filter((e) => e.lexicalRecall != null);
  const labeledVector = evals.filter((e) => e.vectorRecall != null);
  const labeledFused = evals.filter((e) => e.fusedRecall != null);
  const localCases = evals.filter((e) => e.localTop1 != null);
  const unsafeCases = evals.filter((e) => e.unsafe != null);
  const forbiddenCases = evals.filter((e) => e.forbiddenHit != null);
  const bbqForbiddenCases = bbqEvals.filter((e) => e.forbiddenHit != null);
  const cacheCases = evals.filter((e) => e.cacheHit != null);

  const lexicalRecallAtK =
    rate(labeledLexical.filter((e) => e.lexicalRecall).length, labeledLexical.length) ?? 0;
  const vectorRecallAtK =
    rate(labeledVector.filter((e) => e.vectorRecall).length, labeledVector.length) ?? 0;
  const fusedRecallAtK =
    rate(labeledFused.filter((e) => e.fusedRecall).length, labeledFused.length) ?? 0;
  const localTop1Rate = rate(localCases.filter((e) => e.localTop1).length, localCases.length) ?? 0;
  const unsafeSubstitutionRate =
    rate(unsafeCases.filter((e) => e.unsafe).length, unsafeCases.length) ?? 0;
  const forbiddenHitRate =
    rate(forbiddenCases.filter((e) => e.forbiddenHit).length, forbiddenCases.length) ?? 0;
  const bbqForbiddenHitRate =
    rate(bbqForbiddenCases.filter((e) => e.forbiddenHit).length, bbqForbiddenCases.length) ?? 0;
  const missingLineRate = rate(evals.filter((e) => e.missing).length, evals.length) ?? 0;
  const queryCacheHitRate =
    rate(cacheCases.filter((e) => e.cacheHit).length, cacheCases.length) ?? 0;

  const coverageOk =
    coverage.vectorCoverage >= MIN_VECTOR_COVERAGE &&
    coverage.profileCoverage >= MIN_PROFILE_COVERAGE;
  const unsafeOk = unsafeSubstitutionRate <= MAX_UNSAFE_RATE;
  const bbqForbiddenOk = bbqForbiddenCases.length === 0 || bbqForbiddenHitRate === 0;
  const fusedBeatsLexical =
    labeledFused.length > 0 && labeledLexical.length > 0
      ? fusedRecallAtK >= lexicalRecallAtK
      : false;
  const latencyOk = p95 != null && p95 <= LATENCY_P95_BUDGET_MS;
  // Hasher is CI/local quality smoke; latency is advisory there (host load flakes).
  // Transformers / production path still requires the p95 budget.
  const latencyRequired = backend !== "hasher";
  const pass =
    coverageOk && unsafeOk && bbqForbiddenOk && fusedBeatsLexical && (!latencyRequired || latencyOk);

  const gateSummary = [
    `coverage=${coverageOk ? "PASS" : "FAIL"} (vector=${coverage.vectorCoverage.toFixed(3)} profiles=${coverage.profileCoverage.toFixed(3)})`,
    `unsafe=${unsafeOk ? "PASS" : "FAIL"} (rate=${unsafeSubstitutionRate.toFixed(3)} max=${MAX_UNSAFE_RATE})`,
    `forbidden=${forbiddenHitRate === 0 ? "PASS" : "FAIL"} (rate=${forbiddenHitRate.toFixed(3)} labeled=${forbiddenCases.length})`,
    `bbqForbidden=${bbqForbiddenOk ? "PASS" : "FAIL"} (rate=${bbqForbiddenHitRate.toFixed(3)} cases=${bbqForbiddenCases.length})`,
    `fusedVsLexical=${fusedBeatsLexical ? "PASS" : "FAIL"} (fused=${fusedRecallAtK.toFixed(3)} lexical=${lexicalRecallAtK.toFixed(3)})`,
    `latency=${latencyOk ? "PASS" : latencyRequired ? "FAIL" : "WARN"} (p95=${p95?.toFixed(1) ?? "n/a"}ms budget=${LATENCY_P95_BUDGET_MS}ms backend=${backend})`,
    `overall=${pass ? "PASS" : "FAIL"}`,
  ].join("; ");

  return {
    event: "semantic_benchmark",
    skipped: false,
    fixturePath: FIXTURE_PATH,
    bbqFixturePath: BBQ_FIXTURE_PATH,
    caseCount,
    bbqCaseCount,
    k,
    model,
    backend,
    ontologyVersion,
    coverage: {
      ...coverage,
      notes: coverageNotes,
    },
    metrics: {
      lexicalRecallAtK,
      vectorRecallAtK: vectorAvailable ? vectorRecallAtK : null,
      fusedRecallAtK: vectorAvailable ? fusedRecallAtK : lexicalRecallAtK,
      localTop1Rate,
      unsafeSubstitutionRate,
      forbiddenHitRate,
      bbqForbiddenHitRate,
      missingLineRate,
      queryCacheHitRate: cacheCases.length > 0 ? queryCacheHitRate : null,
      latencyMs: {
        p50: p50 != null ? Math.round(p50 * 10) / 10 : null,
        p95: p95 != null ? Math.round(p95 * 10) / 10 : null,
        samples: latencies.length,
      },
      labeledLexical: labeledLexical.length,
      labeledVector: labeledVector.length,
      labeledFused: labeledFused.length,
      labeledForbidden: forbiddenCases.length,
      labeledBbqForbidden: bbqForbiddenCases.length,
    },
    activationGate: {
      coverageOk,
      unsafeOk,
      bbqForbiddenOk,
      fusedBeatsLexical,
      latencyOk,
      pass,
      thresholds: {
        minVectorCoverage: MIN_VECTOR_COVERAGE,
        minProfileCoverage: MIN_PROFILE_COVERAGE,
        maxUnsafeRate: MAX_UNSAFE_RATE,
        latencyP95BudgetMs: LATENCY_P95_BUDGET_MS,
      },
      summary: gateSummary,
    },
    perQuery: evals.map((e) => ({
      query: e.query,
      lexicalRecall: e.lexicalRecall,
      vectorRecall: e.vectorRecall,
      fusedRecall: e.fusedRecall,
      localTop1: e.localTop1,
      unsafe: e.unsafe,
      forbiddenHit: e.forbiddenHit,
      missing: e.missing,
      cacheHit: e.cacheHit,
      totalMs: Math.round(e.timing.totalMs * 10) / 10,
      skippedReason: e.skippedReason,
    })),
  };
}

function parseCliArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasCliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseNear(raw: string | undefined): { lat: number; lng: number } | undefined {
  if (!raw) return undefined;
  const [latRaw, lngRaw] = raw.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid --near=${raw}; expected lat,lng`);
  }
  return { lat, lng };
}

interface BasketFixtureCase {
  query: string;
  packQty?: number;
  amount?: number;
  unit?: string;
}

interface BasketFixtureFile {
  cases: BasketFixtureCase[];
}

function loadBasketFixture(filePath: string): BasketFixtureFile {
  const fixture = loadFixture(filePath);
  return { cases: fixture.cases as BasketFixtureCase[] };
}

async function runBasketBenchmark(): Promise<Record<string, unknown>> {
  const fixturePath = path.resolve(parseCliArg("fixture") ?? BBQ_FIXTURE_PATH);
  const city = parseCliArg("city");
  const near = parseNear(parseCliArg("near"));
  // CLI defaults are for fixture runs only — never used in production resolve paths.
  const locationCity = city ?? (near ? undefined : "Herzliya");
  const warmRuns = 3;

  if (!process.env.DATABASE_URL) {
    return {
      event: "basket_benchmark",
      skipped: true,
      skippedReason: "DATABASE_URL unset",
      fixturePath,
    };
  }

  let pool: Pool;
  try {
    pool = getPool();
  } catch (err) {
    return {
      event: "basket_benchmark",
      skipped: true,
      skippedReason: err instanceof Error ? err.message : String(err),
      fixturePath,
    };
  }

  const reachable = await probeDb(pool);
  if (!reachable) {
    return {
      event: "basket_benchmark",
      skipped: true,
      skippedReason: "database unreachable",
      fixturePath,
    };
  }

  let dirty = 0;
  try {
    const dirtyRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM semantic_index_dirty`,
    );
    dirty = Number(dirtyRes.rows[0]?.count ?? 0);
  } catch {
    dirty = -1;
  }
  if (dirty > 0) {
    console.warn(
      JSON.stringify({
        event: "basket_benchmark_warning",
        message: "semantic_index_dirty is non-empty; latency results may be invalid",
        dirty,
      }),
    );
  }

  const fixture = loadBasketFixture(fixturePath);
  const items = fixture.cases.map((row) => {
    if (row.amount != null) {
      return {
        query: row.query,
        amount: row.amount,
        unit: row.unit ?? "unit",
      };
    }
    return {
      query: row.query,
      packQty: row.packQty ?? 1,
    };
  });

  const optimizeUrl = new URL(
    "../../../../services/api/src/services/basket/optimize.ts",
    import.meta.url,
  );
  const { resolveBasketLines } = (await import(optimizeUrl.href)) as {
    resolveBasketLines: (input: {
      items: Array<{ query: string; packQty?: number; amount?: number; unit?: string }>;
      city?: string;
      near?: { lat: number; lng: number };
    }) => Promise<{
      itemStatuses: Array<{ resolutionStatus: string }>;
      candidateStores: unknown[];
    }>;
  };

  const locationInput = {
    items,
    ...(locationCity ? { city: locationCity } : {}),
    ...(near ? { near } : {}),
  };

  // One uncounted warmup, then warmRuns measured iterations.
  await resolveBasketLines(locationInput);

  const durationsMs: number[] = [];
  let lastResolution: Record<string, unknown> | null = null;
  for (let i = 0; i < warmRuns; i++) {
    const t0 = performance.now();
    const result = await resolveBasketLines(locationInput);
    durationsMs.push(performance.now() - t0);
    lastResolution = {
      requestedLines: result.itemStatuses.length,
      resolvedLines: result.itemStatuses.filter((s) => s.resolutionStatus === "resolved").length,
      needsConfirmationLines: result.itemStatuses.filter(
        (s) => s.resolutionStatus === "needs_confirmation",
      ).length,
      unresolvedLines: result.itemStatuses.filter((s) => s.resolutionStatus === "unresolved").length,
      candidateStores: result.candidateStores.length,
    };
  }

  const sorted = [...durationsMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);

  return {
    event: "basket_benchmark",
    skipped: false,
    fixturePath,
    itemCount: items.length,
    location: {
      city: locationCity ?? null,
      near: near ?? null,
    },
    dirty,
    dirtyWarning: dirty > 0,
    warmRuns,
    latencyMs: {
      samples: durationsMs.map((ms) => Math.round(ms * 10) / 10),
      p50: p50 != null ? Math.round(p50 * 10) / 10 : null,
      p95: p95 != null ? Math.round(p95 * 10) / 10 : null,
    },
    resolution: lastResolution,
  };
}

async function main(): Promise<void> {
  const report = hasCliFlag("basket") ? await runBasketBenchmark() : await runBenchmark();
  console.log(JSON.stringify(report, null, 2));

  const reportPath = process.env.SUPER_MCP_BENCH_REPORT;
  if (reportPath) {
    const fs = await import("node:fs");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  if (process.env.SUPER_MCP_BENCH_GATE === "1") {
    const r = report as {
      skipped?: boolean;
      skippedReason?: string;
      activationGate?: { pass?: boolean; summary?: string };
    };
    if (r.skipped) {
      console.error(`benchmark gate: FAIL (skipped: ${r.skippedReason ?? "unknown"})`);
      process.exitCode = 1;
      return;
    }
    if (r.activationGate && !r.activationGate.pass) {
      console.error(`benchmark gate: FAIL; ${r.activationGate?.summary ?? "no gate computed"}`);
      process.exitCode = 1;
    }
  }
}

main()
  .then(async () => {
    await closePool().catch(() => undefined);
  })
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
