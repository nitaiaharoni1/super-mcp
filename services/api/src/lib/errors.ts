import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@super-mcp/shared";

/** Normalizes any thrown value into an AppError so responses are always { error: {...} }. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError("bad_request", "Invalid request parameters", 400, err.issues);
  }
  if (err instanceof Error) {
    // Do not leak internal error text (pg messages expose schema/SQL) to clients.
    return new AppError("internal_error", "Internal server error", 500);
  }
  return new AppError("internal_error", "Internal server error", 500);
}

export function sendError(reply: FastifyReply, err: unknown): void {
  const appErr = toAppError(err);
  void reply.status(appErr.statusCode).send({
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    },
  });
}
