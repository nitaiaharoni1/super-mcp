import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  ALL_L2,
  ALL_L3,
  L3_NONE,
  TAXONOMY_L1,
  TAXONOMY_L2,
  TAXONOMY_L3,
  VARIANTS,
  VARIANT_DEFAULT,
  isValidClassPath,
  mapPool,
} from "@super-mcp/shared";
import { closePool, getPool } from "../client/index.js";

/**
 * One-time / incremental LLM classification of product names into the closed
 * 3-level taxonomy (packages/shared productClassTaxonomy). OFFLINE only — never
 * called from the request path. Writes product_class_map (migration 017).
 *
 * Dedupes by product name (same name = same class) and fans the result to every
 * product_id sharing it. Vertex AI (your GCP project); structured output with
 * enum-constrained fields; hierarchy validated in code with one re-ask.
 *
 *   --scope=herzliya|all     which products to classify (default herzliya pilot)
 *   --model=<id>             gemini-2.5-flash-lite (default) | gemini-2.5-flash
 *   --region=<r>             us-central1 (default; me-west1 has no Gemini)
 *   --account=<email>        gcloud account (or GOOGLE_CLOUD_ACCOUNT) — required
 *   --project=<id>           GCP project id (or GOOGLE_CLOUD_PROJECT) — required
 *   --batch-size=N           names per request (default 50)
 *   --concurrency=N          parallel requests (default 12)
 *   --limit=N                cap distinct names (bake-off / smoke)
 *   --only-missing           skip names already classified for the current name (default on)
 *   --all-rows               reclassify even if a row exists
 *   --dry-run                do not write to the DB
 *   --out=path.csv           also append name,l1,l2,l3,confidence rows (bake-off review)
 */

interface Args {
  scope: "herzliya" | "all";
  model: string;
  region: string;
  account: string;
  project: string;
  batchSize: number;
  concurrency: number;
  limit: number | null;
  onlyMissing: boolean;
  dryRun: boolean;
  out: string | null;
  namesFile: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    scope: "herzliya",
    model: "gemini-2.5-flash-lite",
    region: "us-central1",
    account: process.env.GOOGLE_CLOUD_ACCOUNT?.trim() ?? "",
    project: process.env.GOOGLE_CLOUD_PROJECT?.trim() ?? "",
    batchSize: 50,
    concurrency: 12,
    limit: null,
    onlyMissing: true,
    dryRun: false,
    out: null,
    namesFile: null,
  };
  for (const arg of argv) {
    if (arg.startsWith("--scope=")) {
      const v = arg.slice(8);
      if (v !== "herzliya" && v !== "all") throw new Error(`--scope must be herzliya|all`);
      a.scope = v;
    } else if (arg.startsWith("--model=")) a.model = arg.slice(8);
    else if (arg.startsWith("--region=")) a.region = arg.slice(9);
    else if (arg.startsWith("--account=")) a.account = arg.slice(10);
    else if (arg.startsWith("--project=")) a.project = arg.slice(10);
    else if (arg.startsWith("--batch-size=")) a.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--concurrency=")) a.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--limit=")) a.limit = Number(arg.slice(8));
    else if (arg === "--all-rows") a.onlyMissing = false;
    else if (arg === "--only-missing") a.onlyMissing = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg.startsWith("--out=")) a.out = arg.slice(6);
    else if (arg.startsWith("--names-file=")) a.namesFile = arg.slice(13);
    else throw new Error(`unknown arg ${arg}`);
  }
  if (!a.account.trim()) {
    throw new Error("classifyProducts requires --account=<email> or GOOGLE_CLOUD_ACCOUNT");
  }
  if (!a.project.trim()) {
    throw new Error("classifyProducts requires --project=<id> or GOOGLE_CLOUD_PROJECT");
  }
  return a;
}

// --- Vertex access token (gcloud), cached with periodic refresh -------------
let cachedToken: { value: string; at: number } | null = null;
function getToken(account: string): string {
  const now = Date.now();
  if (cachedToken && now - cachedToken.at < 40 * 60 * 1000) return cachedToken.value;
  const value = execFileSync("gcloud", ["auth", "print-access-token", `--account=${account}`], {
    encoding: "utf8",
  }).trim();
  cachedToken = { value, at: now };
  return value;
}

const CONF_MAP: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.4 };

function renderTaxonomy(): string {
  const lines: string[] = [];
  for (const l1 of TAXONOMY_L1) {
    const l2s = TAXONOMY_L2[l1]!;
    lines.push(`${l1}:`);
    for (const l2 of l2s) {
      const l3s = TAXONOMY_L3[l2];
      lines.push(`  ${l2}${l3s ? ` > [${l3s.join(", ")}]` : ""}`);
    }
  }
  return lines.join("\n");
}

const SYSTEM_RULES = `You classify Israeli supermarket product NAMES (Hebrew, may include brand/size/packaging) into a closed 3-level grocery taxonomy. Return the single best path per item.
Rules:
- l1 always required. l2 = best subcategory or "none". l3 only from the listed family for that l2, else "none".
- Classify by what the product fundamentally IS; ignore brand and pack size.
- Distinguish FRESH from pickled/canned/dried/sliced/roasted, and PRODUCE from SPICE:
  * פלפל אדום/ירוק (bell pepper) -> produce/vegetable_fresh/pepper_bell ; פלפל שחור/אנגלי (pepper spice/allspice) -> pantry_dry/spices_seasoning.
  * חומוס as a ready spread/salad -> spreads_condiments/hummus_tahini_salads/hummus_spread ; dry חומוס/גרגרי חומוס (chickpea grains) -> pantry_dry/legumes_dry ; חומוס קלוי (roasted snack) -> snacks_sweets.
  * בצל (dry onion) -> vegetable_fresh/onion ; בצל ירוק (scallion) -> vegetable_fresh/scallion ; לחם בצל -> bakery/bread.
  * לימון -> fruit_fresh/lemon ; ליים -> fruit_fresh/lime ; מלח לימון (citric acid) -> pantry_dry/spices_seasoning.
  * אבטיח (watermelon) -> fruit_fresh/watermelon — NEVER melon. מלון (cantaloupe/honeydew) -> fruit_fresh/melon.
  * מלח גס/שולחן -> pantry_dry/salt_sugar/salt.
  * קפה נמס / טייסטרס / נסקפה instant -> coffee/instant_coffee. קפה טורקי / ground Turkish coffee (no נמס) -> coffee/ground_coffee — NOT instant_coffee.
  * עוגת לימונים / lemon cake -> bakery/cake ; never fruit_fresh/lemon. לקריץ/סוכריות קולה -> snacks_sweets/candy ; never soda/cola.
- פיקדון/deposit/gift card/service fee -> non_food_other.
- variant: the cross-cutting form a shopper would NOT accept as a plain substitute.
  Default "regular" for a normal product. Use: diet_zero (דיאט/זירו/zero), sugar_free
  (ללא סוכר), decaf (נטול קפאין), organic (אורגני/ביו), premium (פרימיום/מובחר/בוטיק),
  baby_mini (בייבי/מיני), cherry_grape (שרי/מיני tomatoes/ענבניות), sliced_prepared
  (פרוס/קצוץ/מגורד/מרוסק ready-cut), whole_wheat (מלא/כוסמין), lactose_free (ללא לקטוז),
  spicy (חריף/פיקנטי). A plain product with none of these -> "regular".
- brand: the manufacturer/brand as it appears in the NAME (e.g. "קפה נמס טסטרס צ'ויס"
  -> "טסטרס צ'ויס"; "קוקה קולה" -> "קוקה קולה"; "עגבניות" -> ""). Empty string if no
  brand is present (loose produce, generic items). Do NOT invent a brand.
Taxonomy (l1 > l2 > [l3 options]):
`;

interface ClassResult {
  i: number;
  l1: string;
  l2: string;
  l3: string;
  variant: string;
  brand: string;
  confidence: string;
}

function buildRequestBody(names: string[]): unknown {
  const numbered = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return {
    systemInstruction: { parts: [{ text: SYSTEM_RULES + renderTaxonomy() }] },
    contents: [{ role: "user", parts: [{ text: `Products:\n${numbered}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            i: { type: "INTEGER" },
            l1: { type: "STRING", enum: [...TAXONOMY_L1] },
            l2: { type: "STRING", enum: [...ALL_L2, L3_NONE] },
            l3: { type: "STRING", enum: [...ALL_L3, L3_NONE] },
            variant: { type: "STRING", enum: [...VARIANTS] },
            brand: { type: "STRING" },
            confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          },
          required: ["i", "l1", "l2", "l3", "variant", "brand", "confidence"],
        },
      },
    },
  };
}

async function callVertex(args: Args, names: string[]): Promise<ClassResult[]> {
  const url = `https://${args.region}-aiplatform.googleapis.com/v1/projects/${args.project}/locations/${args.region}/publishers/google/models/${args.model}:generateContent`;
  const body = JSON.stringify(buildRequestBody(names));
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken(args.account)}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (res.status === 401) {
        cachedToken = null;
        throw new Error("401 (token refresh)");
      }
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`retryable HTTP ${res.status}`);
      }
      const json = (await res.json()) as any;
      if (json.error) throw new Error(`vertex ${json.error.status}: ${json.error.message}`);
      const text: string = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
      const parsed = JSON.parse(text) as ClassResult[];
      return parsed;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface NameRow {
  name: string;
  productIds: string[];
}

async function selectDistinctNames(args: Args): Promise<NameRow[]> {
  if (args.namesFile) {
    const { readFileSync } = await import("node:fs");
    const names = readFileSync(args.namesFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    return names.map((name) => ({ name, productIds: [] }));
  }
  const pool = getPool();
  const scopeJoin =
    args.scope === "herzliya"
      ? `JOIN listing l ON l.product_id = p.id
         JOIN store_price sp ON sp.listing_id = l.id AND sp.price > 0
         JOIN store s ON s.id = sp.store_id AND s.city ILIKE '%הרצליה%'`
      : "";
  const missingFilter = args.onlyMissing
    ? `AND NOT EXISTS (SELECT 1 FROM product_class_map m WHERE m.product_id = p.id AND m.input_name = p.name)`
    : "";
  const { rows } = await pool.query<{ name: string; ids: string[] }>(
    `SELECT p.name, array_agg(DISTINCT p.id) AS ids
     FROM product p
     ${scopeJoin}
     WHERE p.name IS NOT NULL AND p.name <> '' ${missingFilter}
     GROUP BY p.name
     ORDER BY p.name`,
  );
  const out = rows.map((r) => ({ name: r.name, productIds: r.ids }));
  return args.limit != null ? out.slice(0, args.limit) : out;
}

async function upsertBatch(
  rows: { productId: string; name: string; r: ClassResult; model: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPool();
  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const row of rows) {
    const l2 = row.r.l2 === L3_NONE ? null : row.r.l2;
    const l3 = row.r.l3 === L3_NONE ? null : row.r.l3;
    const variant = row.r.variant && row.r.variant.trim() ? row.r.variant : VARIANT_DEFAULT;
    const brand = row.r.brand && row.r.brand.trim() ? row.r.brand.trim() : null;
    values.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'llm', $${p++}, $${p++}, now())`,
    );
    params.push(
      row.productId,
      row.r.l1,
      l2,
      l3,
      variant,
      brand,
      CONF_MAP[row.r.confidence] ?? 0.5,
      row.model,
      row.name,
    );
  }
  await pool.query(
    `INSERT INTO product_class_map
       (product_id, class_l1, class_l2, class_l3, variant, brand_extracted, confidence, source, model, input_name, classified_at)
     VALUES ${values.join(", ")}
     ON CONFLICT (product_id) DO UPDATE SET
       class_l1 = EXCLUDED.class_l1, class_l2 = EXCLUDED.class_l2, class_l3 = EXCLUDED.class_l3,
       variant = EXCLUDED.variant, brand_extracted = EXCLUDED.brand_extracted,
       confidence = EXCLUDED.confidence, source = EXCLUDED.source, model = EXCLUDED.model,
       input_name = EXCLUDED.input_name, classified_at = now()`,
    params,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[classify] scope=${args.scope} model=${args.model} region=${args.region} dryRun=${args.dryRun}`);
  getToken(args.account); // fail fast on auth

  const names = await selectDistinctNames(args);
  console.log(`[classify] ${names.length} distinct names to classify`);
  if (args.out) writeFileSync(args.out, "name,l1,l2,l3,variant,brand,confidence\n");

  const batches: NameRow[][] = [];
  for (let i = 0; i < names.length; i += args.batchSize) {
    batches.push(names.slice(i, i + args.batchSize));
  }

  let done = 0;
  let misfits = 0;
  let promptTokens = 0;
  let outputTokens = 0;
  const dist = new Map<string, number>();

  await mapPool(batches, args.concurrency, async (batch) => {
    const results = await callVertex(args, batch.map((b) => b.name));
    const byIndex = new Map(results.map((r) => [r.i, r]));
    const upserts: { productId: string; name: string; r: ClassResult; model: string }[] = [];
    const csvLines: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const r = byIndex.get(j + 1);
      if (!r) {
        misfits++;
        continue;
      }
      const l2 = r.l2 === L3_NONE ? null : r.l2;
      const l3 = r.l3 === L3_NONE ? null : r.l3;
      if (!isValidClassPath(r.l1, l2, l3)) {
        misfits++;
        continue;
      }
      dist.set(r.l1, (dist.get(r.l1) ?? 0) + 1);
      if (args.out) {
        const q = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
        csvLines.push(`${q(batch[j]!.name)},${r.l1},${r.l2},${r.l3},${r.variant},${q(r.brand)},${r.confidence}`);
      }
      for (const productId of batch[j]!.productIds) {
        upserts.push({ productId, name: batch[j]!.name, r, model: args.model });
      }
    }
    if (args.out && csvLines.length) appendFileSync(args.out, csvLines.join("\n") + "\n");
    if (!args.dryRun) await upsertBatch(upserts);
    done += batch.length;
    if (done % 500 < args.batchSize) console.log(`[classify] ${done}/${names.length} names`);
  });

  console.log(`[classify] done. names=${names.length} misfits=${misfits}`);
  console.log(`[classify] L1 distribution: ${JSON.stringify(Object.fromEntries([...dist.entries()].sort((a, b) => b[1] - a[1])))}`);
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
