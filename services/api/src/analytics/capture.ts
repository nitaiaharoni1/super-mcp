import { AnalyticsEvent, AppError, type AnalyticsSurface } from "@super-mcp/shared";
import type { ApiKeyRole } from "../auth.js";
import type { AnalyticsRequestContext } from "./context.js";
import {
  extractRequestMeta,
  extractRestRequestMeta,
  extractResultMeta,
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
  apiKeyRole: ApiKeyRole;
  httpStatus?: number;
  errorCode?: string;
  requestMeta?: RequestAnalyticsMeta;
  resultMeta?: ResultAnalyticsMeta;
};

export function captureApiOperation(input: ApiOperationCapture): void {
  captureSafe(posthogDistinctId(input.apiKeyId), AnalyticsEvent.ApiOperation, {
    surface: input.surface,
    operation: input.operation,
    status: input.status,
    latency_ms: input.latencyMs,
    api_key_role: input.apiKeyRole,
    ...(input.httpStatus != null ? { http_status: input.httpStatus } : {}),
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
    ...input.requestMeta,
    ...input.resultMeta,
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
    httpStatus: args.statusCode,
    errorCode: args.errorCode ?? undefined,
    requestMeta: extractRestRequestMeta(args.body, args.query),
  });
}
