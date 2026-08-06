import { AnalyticsEvent, AppError, type AnalyticsSurface } from "@super-mcp/shared";
import { isAnonymousApiKeyId, type ApiKeyRole } from "../auth.js";
import type { AnalyticsRequestContext } from "./context.js";
import {
  extractRequestMeta,
  extractRestRequestMeta,
  extractResultMeta,
  type AnalyticsClientName,
  type RequestAnalyticsMeta,
  type ResultAnalyticsMeta,
} from "./metadata.js";
import { captureSafe, posthogDistinctId } from "./posthog.js";

export type ApiOperationCapture = {
  surface: Exclude<AnalyticsSurface, "web">;
  operation: string;
  status: "ok" | "error";
  latencyMs: number;
  apiKeyId: string;
  /** "none" when the request never authenticated, i.e. a 401 or a pre-auth 429. */
  apiKeyRole: ApiKeyRole | "none";
  /** Pseudonymous distinct id for keyless callers; key holders leave it unset. */
  analyticsId?: string;
  clientName?: AnalyticsClientName;
  /** Only meaningful on a rejection: whether any credential was sent. */
  credentialPresented?: boolean;
  httpStatus?: number;
  errorCode?: string;
  requestMeta?: RequestAnalyticsMeta;
  resultMeta?: ResultAnalyticsMeta;
};

/** Placeholder key id for callers who never authenticated. Never a real api_key row. */
const UNAUTHENTICATED_API_KEY_ID = "unauthenticated";

/** How the caller got in. Drives the keyless-vs-key funnel split. */
function authMode(input: ApiOperationCapture): "api_key" | "anonymous" | "rejected" {
  if (input.apiKeyRole === "none") return "rejected";
  return isAnonymousApiKeyId(input.apiKeyId) ? "anonymous" : "api_key";
}

export function captureApiOperation(input: ApiOperationCapture): void {
  captureSafe(posthogDistinctId(input.apiKeyId, input.analyticsId), AnalyticsEvent.ApiOperation, {
    surface: input.surface,
    operation: input.operation,
    status: input.status,
    latency_ms: input.latencyMs,
    api_key_role: input.apiKeyRole,
    auth_mode: authMode(input),
    ...(input.clientName ? { client_name: input.clientName } : {}),
    ...(input.credentialPresented != null
      ? { credential_presented: input.credentialPresented }
      : {}),
    ...(input.httpStatus != null ? { http_status: input.httpStatus } : {}),
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
    ...input.requestMeta,
    ...input.resultMeta,
  });
}

/**
 * A request that never got past authentication: a missing/invalid key (401) or a keyless caller
 * over the rate limit (429). Captured as an `api_operation` with `auth_mode: "rejected"` so the
 * install funnel has one event to end on, whether the connection worked or not. Without this the
 * commonest install failure, a config that 401s, is invisible in PostHog.
 */
export function captureAuthRejection(args: {
  surface: Exclude<AnalyticsSurface, "web">;
  operation: string;
  startedAt: number;
  /** An AppError supplies the code and status; anything else is reported as a plain 401. */
  error: unknown;
  analyticsId: string;
  clientName: AnalyticsClientName;
  /**
   * Whether the caller sent a credential at all. False is the install-funnel signal (a config
   * with no key, or one over the keyless ceiling); true is a key holder being throttled, who
   * must not be counted in the keyless cohort just because we cannot name them here.
   */
  credentialPresented?: boolean;
}): void {
  const appError = args.error instanceof AppError ? args.error : null;
  captureApiOperation({
    surface: args.surface,
    operation: args.operation,
    status: "error",
    latencyMs: Date.now() - args.startedAt,
    apiKeyId: UNAUTHENTICATED_API_KEY_ID,
    apiKeyRole: "none",
    analyticsId: args.analyticsId,
    clientName: args.clientName,
    credentialPresented: args.credentialPresented,
    httpStatus: appError?.statusCode ?? 401,
    errorCode: appError?.code ?? "unauthorized",
  });
}

export function captureMcpToolOperation(args: {
  toolName: string;
  startedAt: number;
  status: "ok" | "error";
  error?: unknown;
  toolArgs: unknown;
  result?: unknown;
  ctx: AnalyticsRequestContext | undefined;
}): void {
  if (!args.ctx) return;

  const errorCode =
    args.error instanceof AppError
      ? args.error.code
      : args.status === "error"
        ? "internal_error"
        : undefined;

  captureApiOperation({
    surface: "mcp",
    operation: args.toolName,
    status: args.status,
    latencyMs: Date.now() - args.startedAt,
    apiKeyId: args.ctx.apiKeyId,
    apiKeyRole: args.ctx.role,
    analyticsId: args.ctx.analyticsId,
    clientName: args.ctx.clientName,
    errorCode,
    requestMeta: extractRequestMeta(args.toolArgs),
    resultMeta: extractResultMeta(args.result),
  });
}

export function captureRestOperation(args: {
  route: string;
  statusCode: number;
  startedAt: number;
  apiKeyId: string;
  apiKeyRole: ApiKeyRole;
  analyticsId?: string;
  clientName?: AnalyticsClientName;
  errorCode?: string | null;
  body?: unknown;
  query?: unknown;
}): void {
  captureApiOperation({
    surface: "rest",
    operation: args.route,
    status: args.statusCode < 400 ? "ok" : "error",
    latencyMs: Date.now() - args.startedAt,
    apiKeyId: args.apiKeyId,
    apiKeyRole: args.apiKeyRole,
    analyticsId: args.analyticsId,
    clientName: args.clientName,
    httpStatus: args.statusCode,
    errorCode: args.errorCode ?? undefined,
    requestMeta: extractRestRequestMeta(args.body, args.query),
  });
}
