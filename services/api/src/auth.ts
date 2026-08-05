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
  // Every MCP surface, not just /mcp: clients that need the escape hatch on one
  // need it on the other, and leaving it off silently breaks only the new URL.
  const isMcpPath = path === "/mcp" || path?.startsWith("/mcp/");
  if (isMcpPath && process.env.SUPER_MCP_ALLOW_MCP_QUERY_API_KEY === "1") {
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
 * Fixed identity for keyless callers. Seeded by migration 035 as a revoked row whose key_hash
 * can never equal a sha256 digest, so usage/audit foreign keys hold while the row itself stays
 * unusable as a credential.
 */
export const ANONYMOUS_API_KEY_ID = "00000000-0000-0000-0000-0000000000a1";
export const ANONYMOUS_NAME = "anonymous";
/** Per-address and whole-server ceilings for keyless traffic, per minute. */
export const DEFAULT_ANONYMOUS_RATE_LIMIT = 30;
export const DEFAULT_ANONYMOUS_GLOBAL_RATE_LIMIT = 600;
const ANONYMOUS_GLOBAL_BUCKET = "anon:global";

/** Keyless access is opt-in per deployment so the kill switch is one env var, not a redeploy. */
export function anonymousAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPER_MCP_ALLOW_ANONYMOUS === "1";
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function anonymousRateLimits(env: NodeJS.ProcessEnv = process.env): {
  perIp: number;
  total: number;
} {
  return {
    perIp: positiveIntEnv(env.SUPER_MCP_ANONYMOUS_RATE_LIMIT, DEFAULT_ANONYMOUS_RATE_LIMIT),
    total: positiveIntEnv(env.SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT, DEFAULT_ANONYMOUS_GLOBAL_RATE_LIMIT),
  };
}

/** Client address as seen through the platform proxy (Fastify trustProxy resolves X-Forwarded-For). */
function clientIp(request: FastifyRequest): string {
  const ip = typeof request.ip === "string" ? request.ip.trim() : "";
  return ip || "unknown";
}

/**
 * Sliding 60s window per key, held in memory (single-instance only).
 * Follow-up: replace with a shared/DB limiter before horizontally scaling.
 * Master keys use a finite cap (configured rate, or DEFAULT_MASTER_RATE_LIMIT when unset/0).
 */
const RATE_WINDOWS = new Map<string, number[]>();
/**
 * Anonymous per-address windows live in their own map so their count can be capped: the client
 * address comes from a client-supplied header, so an address-rotating flood would otherwise mint
 * an entry per request. Past the cap, new addresses are limited by the shared ceiling alone.
 */
const ANON_IP_WINDOWS = new Map<string, number[]>();
export const MAX_ANONYMOUS_IP_BUCKETS = 20_000;
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
  for (const windows of [RATE_WINDOWS, ANON_IP_WINDOWS]) {
    for (const [key, timestamps] of windows) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! <= windowStart) {
        windows.delete(key);
      }
    }
  }
}

/** Test-only: clear the in-memory rate-limit windows so suites don't cross-contaminate. */
export function _resetRateLimitForTests(): void {
  RATE_WINDOWS.clear();
  ANON_IP_WINDOWS.clear();
  lastSweep = 0;
}

/** Test-only: how many anonymous address windows are currently retained. */
export function _anonymousBucketCountForTests(): number {
  return ANON_IP_WINDOWS.size;
}

function checkWindow(
  windows: Map<string, number[]>,
  bucket: string,
  limitPerMinute: number,
  scope?: string,
): void {
  const now = Date.now();
  sweepIdleWindows(now);
  const windowStart = now - WINDOW_MS;
  const timestamps = windows.get(bucket) ?? [];
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= limitPerMinute) {
    windows.set(bucket, recent);
    const oldest = recent[0] ?? now;
    throw new AppError("rate_limited", "Rate limit exceeded", 429, {
      limitPerMinute,
      retryAfterMs: Math.max(0, oldest + WINDOW_MS - now),
      ...(scope ? { scope } : {}),
    });
  }

  recent.push(now);
  windows.set(bucket, recent);
}

export function checkRateLimit(bucket: string, limitPerMinute: number, scope?: string): void {
  checkWindow(RATE_WINDOWS, bucket, limitPerMinute, scope);
}

/**
 * Keyless caller. The per-address window is charged first on purpose: a flooding address must be
 * rejected before it can spend a slot of the shared ceiling, or one client could lock everyone out.
 */
function authenticateAnonymous(request: FastifyRequest): AuthContext {
  const { perIp, total } = anonymousRateLimits();
  const ip = clientIp(request);
  // Skipped only when the address is new and the map is already full: tracking it would cost
  // memory an attacker chooses, and the shared ceiling below still applies.
  if (ANON_IP_WINDOWS.has(ip) || ANON_IP_WINDOWS.size < MAX_ANONYMOUS_IP_BUCKETS) {
    checkWindow(ANON_IP_WINDOWS, ip, perIp, "anonymous_ip");
  }
  checkRateLimit(ANONYMOUS_GLOBAL_BUCKET, total, "anonymous_total");
  return {
    apiKeyId: ANONYMOUS_API_KEY_ID,
    name: ANONYMOUS_NAME,
    role: "standard",
    rateLimitPerMinute: perIp,
  };
}

/**
 * Resolves + rate-limits the caller's API key, attaching the result to request.auth.
 * Throws AppError on failure. `allowAnonymous: false` keeps a route key-only even where
 * keyless access is enabled, for routes an operator has deliberately closed.
 */
export async function authenticate(
  request: FastifyRequest,
  opts: { allowAnonymous?: boolean } = {},
): Promise<AuthContext> {
  const raw = extractApiKey(request);
  if (!raw) {
    if (opts.allowAnonymous !== false && anonymousAccessEnabled()) {
      const anon = authenticateAnonymous(request);
      request.auth = anon;
      return anon;
    }
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
