export type TimedSample<T> = {
  elapsedMs: number;
  responseBytes: number;
  value: T;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export async function measure<T>(fn: () => Promise<T>): Promise<TimedSample<T>> {
  const started = Date.now();
  const value = await fn();
  const elapsedMs = Date.now() - started;
  const responseBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  return { elapsedMs, responseBytes, value };
}

export async function sampleN<T>(
  n: number,
  fn: () => Promise<T>,
): Promise<Array<TimedSample<T>>> {
  const out: Array<TimedSample<T>> = [];
  for (let i = 0; i < n; i += 1) {
    out.push(await measure(fn));
  }
  return out;
}

export type PerfSummary = {
  iterations: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  responseBytesP95: number;
  responseBytesMax: number;
};

export function summarize(samples: Array<{ elapsedMs: number; responseBytes: number }>): PerfSummary {
  const latencies = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const sizes = samples.map((s) => s.responseBytes).sort((a, b) => a - b);
  return {
    iterations: samples.length,
    medianMs: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    maxMs: latencies[latencies.length - 1] ?? 0,
    responseBytesP95: percentile(sizes, 95),
    responseBytesMax: sizes[sizes.length - 1] ?? 0,
  };
}

/** Env-tunable iteration count; keep CI/fixture runs short, local dumps can raise. */
export function perfIterations(defaultN = 5): number {
  const raw = Number(process.env.SUPER_MCP_PERF_ITERS ?? defaultN);
  if (!Number.isFinite(raw) || raw < 1) return defaultN;
  return Math.min(50, Math.trunc(raw));
}

export function logPerf(label: string, summary: PerfSummary, extra?: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event: "mcp_perf",
      label,
      ...summary,
      ...extra,
    }),
  );
}
