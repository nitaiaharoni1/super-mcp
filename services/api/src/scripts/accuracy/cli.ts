import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
dotenv.config({ path: path.resolve(repoRoot, ".env") });

// Basket telemetry is one JSON line per call and would bury the report.
process.env.SUPER_MCP_BASKET_TELEMETRY ??= "0";

const { closePool } = await import("@super-mcp/db");
const { runBenchmark } = await import("./runner.js");
const { findRegressions } = await import("./scorer.js");
import type { BenchmarkReport } from "./types.js";

/**
 * Accuracy benchmark CLI.
 *
 *   pnpm --filter @super-mcp/api accuracy
 *   pnpm --filter @super-mcp/api accuracy -- --only=topup,produce --concurrency=3
 *   pnpm --filter @super-mcp/api accuracy -- --out=baseline.json
 *   pnpm --filter @super-mcp/api accuracy -- --baseline=baseline.json --tolerance=0.02
 *
 * Exits non-zero only when a baseline is supplied AND a higher-is-better metric
 * dropped past the tolerance, so it is safe to run without gating a build.
 */

interface Args {
  only: string[];
  concurrency: number;
  radiusKm: number;
  out: string | null;
  baseline: string | null;
  tolerance: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    only: [],
    concurrency: 2,
    radiusKm: 10,
    out: null,
    baseline: null,
    tolerance: 0.02,
    json: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--only=")) a.only = arg.slice(7).split(",").filter(Boolean);
    else if (arg.startsWith("--concurrency=")) a.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--radius-km=")) a.radiusKm = Number(arg.slice(12));
    else if (arg.startsWith("--out=")) a.out = arg.slice(6);
    else if (arg.startsWith("--baseline=")) a.baseline = arg.slice(11);
    else if (arg.startsWith("--tolerance=")) a.tolerance = Number(arg.slice(12));
    else if (arg === "--json") a.json = true;
    else if (arg === "--help") {
      console.log("see the header of src/scripts/accuracy/cli.ts");
      process.exit(0);
    }
  }
  if (!Number.isFinite(a.concurrency) || a.concurrency < 1) a.concurrency = 2;
  return a;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(report: BenchmarkReport): void {
  const m = report.metrics;
  console.log("");
  console.log("ACCURACY BENCHMARK  (labels are MACHINE-PROPOSED, pending human review)");
  console.log(`  labels ${report.labelCount}   baskets ${report.basketCount}`);
  console.log("");
  console.log(`  resolutionAccuracy   ${pct(m.resolutionAccuracy)}   lines resolving to an accepted product`);
  console.log(`  coverage             ${pct(m.coverage)}   requested lines priced at the recommended store`);
  console.log(`  conditionalExposure  ${pct(m.conditionalExposure)}   priced lines needing a club card or coupon`);
  console.log(`  imputedShare         ${pct(m.imputedShare)}   share of the headline total that is estimated`);
  // Print the denominator and any failures: two runs are only comparable when the
  // denominator matches, and an errored basket must never look like a clean run.
  console.log(`  requestedLines       ${m.requestedLines}     denominator; runs are comparable only when equal`);
  if (m.erroredBaskets > 0) {
    console.log(`  erroredBaskets       ${m.erroredBaskets}     COUNTED AS FAILURES, scores above are depressed`);
  }
  console.log("");

  const cats = Object.entries(report.byCategory).sort((a, b) => a[1].accuracy - b[1].accuracy);
  console.log("  weakest categories:");
  for (const [name, c] of cats.slice(0, 12)) {
    console.log(`    ${pct(c.accuracy).padStart(6)}  ${String(c.accepted).padStart(2)}/${String(c.total).padEnd(2)}  ${name}`);
  }
  console.log("");
  console.log("  per basket:");
  for (const b of report.baskets) {
    if (b.error) {
      console.log(`    ${b.basketId.padEnd(14)} ERROR ${b.error}`);
      continue;
    }
    console.log(
      `    ${b.basketId.padEnd(14)} resolved ${String(b.acceptedLines).padStart(2)}/${String(b.requestedLines).padEnd(2)}` +
        `  priced ${String(b.pricedLines).padStart(2)}/${String(b.requestedLines).padEnd(2)}` +
        `  imputed ${String(b.imputedLines).padStart(2)}` +
        `  ${b.elapsedMs}ms  ${b.storeName ?? "-"}`,
    );
  }

  const failures = report.baskets.flatMap((b) => b.lines.filter((l) => !l.accepted));
  if (failures.length > 0) {
    console.log("");
    console.log(`  failing lines (${failures.length}), deduped by label:`);
    const seen = new Set<string>();
    for (const f of failures) {
      if (seen.has(f.labelId)) continue;
      seen.add(f.labelId);
      const got = f.resolvedName ? `"${f.resolvedName.slice(0, 44)}"` : "(unresolved)";
      console.log(`    ${f.labelId.padEnd(18)} ${f.query.padEnd(16)} -> ${got}`);
      console.log(`      ${f.failures.join("; ")}`);
    }
  }
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runBenchmark({
    only: args.only,
    concurrency: args.concurrency,
    radiusKm: args.radiusKm,
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);

  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`  wrote ${args.out}`);
  }

  let exitCode = 0;
  if (args.baseline) {
    const baseline = JSON.parse(readFileSync(args.baseline, "utf8")) as BenchmarkReport;
    const regressions = findRegressions(report.metrics, baseline.metrics, args.tolerance);
    if (regressions.length > 0) {
      console.error(`REGRESSION vs ${args.baseline} (tolerance ${args.tolerance}):`);
      for (const r of regressions) console.error(`  ${r}`);
      exitCode = 1;
    } else {
      console.log(`  no regression vs ${args.baseline} (tolerance ${args.tolerance})`);
    }
  }

  await closePool();
  process.exit(exitCode);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  await closePool();
  process.exit(1);
});
