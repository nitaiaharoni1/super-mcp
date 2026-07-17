/**
 * Compare a semantic-benchmark report against a committed baseline.
 * Usage: tsx src/scripts/compareBenchmark.ts <baseline.json> <report.json>
 * Exits 1 on regression; exits 0 with a warning if the baseline is missing
 * (bootstrap mode: commit the first CI report as the baseline).
 */
import fs from "node:fs";

const RECALL_DROP_TOLERANCE = 0.05;
const UNSAFE_RISE_TOLERANCE = 0.02;

const [baselinePath, reportPath] = process.argv.slice(2);
if (!baselinePath || !reportPath) {
  console.error("usage: compareBenchmark.ts <baseline.json> <report.json>");
  process.exit(2);
}
if (!fs.existsSync(baselinePath)) {
  console.warn(
    `no baseline at ${baselinePath}; commit the current report there to enable regression checks`,
  );
  process.exit(0);
}

interface Metrics {
  fusedRecallAtK: number | null;
  lexicalRecallAtK: number | null;
  unsafeSubstitutionRate: number;
  bbqForbiddenHitRate: number;
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")).metrics as Metrics;
const report = JSON.parse(fs.readFileSync(reportPath, "utf8")).metrics as Metrics;

const failures: string[] = [];
if (
  baseline.fusedRecallAtK != null &&
  report.fusedRecallAtK != null &&
  report.fusedRecallAtK < baseline.fusedRecallAtK - RECALL_DROP_TOLERANCE
) {
  failures.push(
    `fusedRecallAtK ${report.fusedRecallAtK} < baseline ${baseline.fusedRecallAtK} - ${RECALL_DROP_TOLERANCE}`,
  );
}
if (report.unsafeSubstitutionRate > baseline.unsafeSubstitutionRate + UNSAFE_RISE_TOLERANCE) {
  failures.push(
    `unsafeSubstitutionRate ${report.unsafeSubstitutionRate} > baseline ${baseline.unsafeSubstitutionRate} + ${UNSAFE_RISE_TOLERANCE}`,
  );
}
if (report.bbqForbiddenHitRate > 0) {
  failures.push(
    `bbqForbiddenHitRate ${report.bbqForbiddenHitRate} > 0 (Herzliya golden set must stay clean)`,
  );
}

if (failures.length > 0) {
  console.error("benchmark regression:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("benchmark vs baseline: OK");
