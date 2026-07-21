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

function hasForbiddenSelection(payload: string): boolean {
  return FORBIDDEN_FAST_SELECTIONS.some((name) => payload.includes(name));
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
    const payload = JSON.stringify(result);
    const responseBytes = Buffer.byteLength(payload, "utf8");
    return {
      complete: result.status === "complete",
      safe: !hasForbiddenSelection(payload),
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

  const failures: string[] = [];
  if (result.completeInOneCallRate < 1.0) {
    failures.push(`completeInOneCallRate ${result.completeInOneCallRate} < 1.0`);
  }
  if (result.safeSelectionRate < 1.0) {
    failures.push(`safeSelectionRate ${result.safeSelectionRate} < 1.0`);
  }
  if (result.p95Ms > 3000) {
    failures.push(`p95Ms ${result.p95Ms} > 3000`);
  }
  if (result.responseBytesP95 > 15000) {
    failures.push(`responseBytesP95 ${result.responseBytesP95} > 15000`);
  }
  if (result.pricedLineCoverage < 0.8) {
    failures.push(`pricedLineCoverage ${result.pricedLineCoverage} < 0.8`);
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ event: "benchmark_fast_basket_gate_fail", failures }));
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
