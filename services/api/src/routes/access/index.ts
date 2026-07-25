import type { FastifyInstance, FastifyRequest } from "fastify";
import { query } from "@super-mcp/db";
import { AppError } from "@super-mcp/shared";
import { z } from "zod";
import { createHandler } from "../shared/handlers.js";

const accessRequestBodySchema = z.object({
  email: z.string().trim().email().max(320).transform((v) => v.toLowerCase()),
  use_case: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const submissionsByIp = new Map<string, number[]>();
let lastSweep = 0;

function sweepIdleWindows(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  const windowStart = now - WINDOW_MS;
  for (const [key, times] of submissionsByIp) {
    if (times.length === 0 || times[times.length - 1]! <= windowStart) {
      submissionsByIp.delete(key);
    }
  }
}

/**
 * In-memory IP limiter (single-instance). Prefer Fastify `request.ip` with
 * `trustProxy` enabled behind a proxy that overwrites X-Forwarded-For — never
 * read the raw header here (client-spoofable).
 */
function assertRateLimit(request: FastifyRequest): void {
  const ip = request.ip || "unknown";
  const now = Date.now();
  sweepIdleWindows(now);
  const windowStart = now - WINDOW_MS;
  const recent = (submissionsByIp.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_PER_WINDOW) {
    submissionsByIp.set(ip, recent);
    const oldest = recent[0] ?? now;
    throw new AppError("rate_limited", "too many access requests, try again later", 429, {
      retryAfterMs: Math.max(0, oldest + WINDOW_MS - now),
    });
  }
  recent.push(now);
  submissionsByIp.set(ip, recent);
}

/** Test-only: clear the in-memory access-request rate-limit windows. */
export function _resetAccessRateLimitForTests(): void {
  submissionsByIp.clear();
  lastSweep = 0;
}

export async function registerAccessRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/access-requests",
    createHandler({ body: accessRequestBodySchema }, async ({ body }, request) => {
      assertRateLimit(request);
      await query(`INSERT INTO access_requests (email, use_case) VALUES ($1, $2)`, [
        body.email,
        body.use_case ?? null,
      ]);
      request.log.info("access request received");
      return { received: true };
    }),
  );
}
