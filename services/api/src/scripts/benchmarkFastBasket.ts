/**
 * Deterministic fast-basket latency/quality benchmark against a populated local DB.
 *
 * Usage:
 *   BASKET_CONTINUATION_SECRET=... pnpm --filter @super-mcp/api benchmark:fast-basket
 *
 * Emits one JSON object (FastBasketBenchmarkResult) and exits non-zero when gates fail.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
import { resolveLocationInput } from "../lib/locationInput.js";
import { optimizeBasket } from "../services/basket/optimize.js";
import {
  FORBIDDEN_FAST_SELECTIONS,
  TEL_AVIV_LOCATION,
  TEL_AVIV_STAPLES_ITEMS,
} from "./canary/telAvivStaplesFixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

// Keep stdout as a single machine-readable JSON object for CI artifacts.
process.env.SUPER_MCP_BASKET_TELEMETRY = "0";

const WARM_ITERATIONS = 1;
const MEASURED_ITERATIONS = 20;

interface FastBasketBenchmarkResult {
  iterations: number;
  completeInOneCallRate: number;
  safeSelectionRate: number;
  medianMs: number;
  p95Ms: number;
  responseBytesP95: number;
  pricedLineCoverage: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** Only judge products the optimizer selected — not assumption text / debug noise. */
function hasForbiddenSelection(result: Awaited<ReturnType<typeof optimizeBasket>>): boolean {
  if (result.status !== "complete") return true;
  const names: string[] = [];
  for (const item of result.items) {
    if (item.name) names.push(item.name);
  }
  for (const plan of [result.bestSingleStore, result.cheapestCompleteStore, result.multiStore]) {
    for (const line of plan?.lines ?? []) {
      if (line.name) names.push(line.name);
    }
  }
  const haystack = names.join("\n");
  return FORBIDDEN_FAST_SELECTIONS.some((name) => haystack.includes(name));
}

/** Aspirational canary (3s/15KB) vs full-dump regression defaults. */
function gateThresholds(): { p95Ms: number; responseBytesP95: number; coverageMin: number } {
  const canary = process.env.FAST_BASKET_CANARY === "1";
  return {
    p95Ms: Number(process.env.FAST_BASKET_P95_MS ?? (canary ? 3_000 : 12_000)),
    responseBytesP95: Number(process.env.FAST_BASKET_BYTES_P95 ?? (canary ? 15_000 : 22_000)),
    coverageMin: Number(process.env.FAST_BASKET_COVERAGE_MIN ?? 0.8),
  };
}

function pricedCoverage(result: Awaited<ReturnType<typeof optimizeBasket>>): number {
  if (result.status !== "complete") return 0;
  if (result.coverage && result.coverage.requestedLines > 0) {
    return result.coverage.pricedLines / result.coverage.requestedLines;
  }
  const requested = TEL_AVIV_STAPLES_ITEMS.length;
  const priced = result.bestSingleStore?.pricedLines ?? 0;
  return requested > 0 ? priced / requested : 0;
}

async function main(): Promise<void> {
  const secret = process.env.BASKET_CONTINUATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must be set (≥32 bytes)");
  }

  const loc = await resolveLocationInput(
    { location: TEL_AVIV_LOCATION },
    { geocodeStrategy: "fast" },
  );

  const runOnce = async () => {
    const started = Date.now();
    const result = await optimizeBasket(
      {
        items: TEL_AVIV_STAPLES_ITEMS,
        city: loc.city,
        near: loc.near,
        radiusKm: loc.radiusKm,
        locationOrigin: loc.locationOrigin,
        geocodeMs: loc.geocodeMs,
        resolutionMode: "fast",
        responseDetail: "summary",
        storesLimit: 3,
      },
      { continuationSecret: secret },
    );
    const elapsedMs = Date.now() - started;
    const responseBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    return {
      complete: result.status === "complete",
      safe: !hasForbiddenSelection(result),
      elapsedMs,
      responseBytes,
      pricedLineCoverage: pricedCoverage(result),
    };
  };

  for (let i = 0; i < WARM_ITERATIONS; i += 1) {
    await runOnce();
  }

  const samples: Array<{
    complete: boolean;
    safe: boolean;
    elapsedMs: number;
    responseBytes: number;
    pricedLineCoverage: number;
  }> = [];

  for (let i = 0; i < MEASURED_ITERATIONS; i += 1) {
    samples.push(await runOnce());
  }

  const latencies = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const sizes = samples.map((s) => s.responseBytes).sort((a, b) => a - b);
  const completeCount = samples.filter((s) => s.complete).length;
  const safeCount = samples.filter((s) => s.safe).length;
  const coverageSum = samples.reduce((acc, s) => acc + s.pricedLineCoverage, 0);

  const result: FastBasketBenchmarkResult = {
    iterations: MEASURED_ITERATIONS,
    completeInOneCallRate: completeCount / MEASURED_ITERATIONS,
    safeSelectionRate: safeCount / MEASURED_ITERATIONS,
    medianMs: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    responseBytesP95: percentile(sizes, 95),
    pricedLineCoverage: coverageSum / MEASURED_ITERATIONS,
  };

  const json = JSON.stringify(result);
  const reportPath = process.env.FAST_BASKET_BENCH_REPORT?.trim();
  if (reportPath) {
    writeFileSync(reportPath, `${json}\n`, "utf8");
  }
  console.log(json);

  const thresholds = gateThresholds();
  const failures: string[] = [];
  // Quality gates are always hard — never ship forbidden staples traps or incomplete runs.
  if (result.completeInOneCallRate < 1.0) {
    failures.push(`completeInOneCallRate ${result.completeInOneCallRate} < 1.0`);
  }
  if (result.safeSelectionRate < 1.0) {
    failures.push(`safeSelectionRate ${result.safeSelectionRate} < 1.0`);
  }
  if (result.pricedLineCoverage < thresholds.coverageMin) {
    failures.push(
      `pricedLineCoverage ${result.pricedLineCoverage} < ${thresholds.coverageMin}`,
    );
  }
  // Latency/size: regression defaults for full Israel dumps; set FAST_BASKET_CANARY=1
  // for aspirational 3s/15KB targets.
  if (result.p95Ms > thresholds.p95Ms) {
    failures.push(`p95Ms ${result.p95Ms} > ${thresholds.p95Ms}`);
  }
  if (result.responseBytesP95 > thresholds.responseBytesP95) {
    failures.push(
      `responseBytesP95 ${result.responseBytesP95} > ${thresholds.responseBytesP95}`,
    );
  }
  if (failures.length > 0) {
    console.error(
      JSON.stringify({ event: "benchmark_fast_basket_gate_fail", failures, thresholds }),
    );
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
