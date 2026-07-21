import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "@super-mcp/shared";
import { query } from "@super-mcp/db";

export interface AuthContext {
  apiKeyId: string;
  name: string;
  role: ApiKeyRole;
  rateLimitPerMinute: number;
}

export type ApiKeyRole = "standard" | "master";
export type Capability = "shopping" | "key_admin" | "global_usage";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    startTime: number;
    privilegedAuditId: string | null;
    privilegedAuditErrorCode: string | null;
  }
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Accepts Bearer auth. Query auth is an opt-in MCP-only compatibility escape hatch. */
export function extractApiKey(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const path = request.url.split("?")[0];
  if (path === "/mcp" && process.env.SUPER_MCP_ALLOW_MCP_QUERY_API_KEY === "1") {
    const q = (request.query as Record<string, unknown> | undefined)?.["api_key"];
    if (typeof q === "string" && q.trim().length > 0) return q.trim();
  }
  return null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  role: ApiKeyRole;
  rate_limit_per_minute: number;
}

export async function resolveApiKey(rawKey: string): Promise<AuthContext> {
  const hash = sha256Hex(rawKey);
  const res = await query<ApiKeyRow>(
    `SELECT id, name, role, rate_limit_per_minute
     FROM api_key
     WHERE key_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AppError("unauthorized", "Invalid or revoked API key", 401);
  }
  return {
    apiKeyId: row.id,
    name: row.name,
    role: row.role,
    rateLimitPerMinute: row.rate_limit_per_minute,
  };
}

export function authorize(auth: AuthContext, capability: Capability): void {
  if (capability === "shopping" || auth.role === "master") return;
  throw new AppError("forbidden", "Master API key required", 403);
}

/**
 * Sliding 60s window per key, held in memory (single-instance only).
 * Follow-up: replace with a shared/DB limiter before horizontally scaling.
 * Master keys use a finite cap (configured rate, or DEFAULT_MASTER_RATE_LIMIT when unset/0).
 */
const RATE_WINDOWS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
/** Default rpm when a master key has rate_limit_per_minute <= 0. */
export const DEFAULT_MASTER_RATE_LIMIT = 6_000;
let lastSweep = 0;

export function effectiveRateLimit(role: ApiKeyRole, rateLimitPerMinute: number): number {
  if (rateLimitPerMinute > 0) return rateLimitPerMinute;
  return role === "master" ? DEFAULT_MASTER_RATE_LIMIT : 60;
}

/**
 * Drops keys whose window has fully expired so the Map doesn't retain an entry for every
 * key ever seen. Runs at most once per window to keep the hot path cheap.
 */
function sweepIdleWindows(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  const windowStart = now - WINDOW_MS;
  for (const [key, timestamps] of RATE_WINDOWS) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= windowStart) {
      RATE_WINDOWS.delete(key);
    }
  }
}

/** Test-only: clear the in-memory rate-limit windows so suites don't cross-contaminate. */
export function _resetRateLimitForTests(): void {
  RATE_WINDOWS.clear();
  lastSweep = 0;
}

export function checkRateLimit(apiKeyId: string, limitPerMinute: number): void {
  const now = Date.now();
  sweepIdleWindows(now);
  const windowStart = now - WINDOW_MS;
  const timestamps = RATE_WINDOWS.get(apiKeyId) ?? [];
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= limitPerMinute) {
    RATE_WINDOWS.set(apiKeyId, recent);
    const oldest = recent[0] ?? now;
    throw new AppError("rate_limited", "Rate limit exceeded", 429, {
      limitPerMinute,
      retryAfterMs: Math.max(0, oldest + WINDOW_MS - now),
    });
  }

  recent.push(now);
  RATE_WINDOWS.set(apiKeyId, recent);
}

/** Resolves + rate-limits the caller's API key, attaching the result to request.auth. Throws AppError on failure. */
export async function authenticate(request: FastifyRequest): Promise<AuthContext> {
  const raw = extractApiKey(request);
  if (!raw) {
    throw new AppError("unauthorized", "Missing API key. Use Authorization: Bearer <key>", 401);
  }
  const ctx = await resolveApiKey(raw);
  checkRateLimit(ctx.apiKeyId, effectiveRateLimit(ctx.role, ctx.rateLimitPerMinute));
  request.auth = ctx;
  return ctx;
}

/** Fire-and-forget usage metering; never blocks or fails the request it's recording. */
export function recordUsage(apiKeyId: string, route: string, statusCode: number, latencyMs: number): void {
  query(`INSERT INTO usage_event (api_key_id, route, status_code, latency_ms) VALUES ($1,$2,$3,$4)`, [
    apiKeyId,
    route,
    statusCode,
    Math.round(latencyMs),
  ]).catch((err: unknown) => {
    console.error("failed to record usage_event", err);
  });
}
