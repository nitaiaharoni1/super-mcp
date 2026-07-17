import type { FastifyRequest } from "fastify";
import type { z } from "zod";

type Schemas<TQuery, TParams, TBody> = {
  query?: z.ZodType<TQuery>;
  params?: z.ZodType<TParams>;
  body?: z.ZodType<TBody>;
};

export type RouteInput<TQuery, TParams, TBody> = {
  query: TQuery;
  params: TParams;
  body: TBody;
};

export function dataResponse<T>(data: T): { data: T } {
  return { data };
}

/** Parse request inputs with Zod, run the handler, and wrap the result in `{ data }`. */
export function createHandler<TQuery = undefined, TParams = undefined, TBody = undefined, TResult = unknown>(
  schemas: Schemas<TQuery, TParams, TBody>,
  handler: (
    input: RouteInput<TQuery, TParams, TBody>,
    request: FastifyRequest,
  ) => Promise<TResult> | TResult,
) {
  return async (request: FastifyRequest) => {
    const query = (schemas.query?.parse(request.query) ?? undefined) as TQuery;
    const params = (schemas.params?.parse(request.params) ?? undefined) as TParams;
    const body = (schemas.body?.parse(request.body) ?? undefined) as TBody;
    const result = await handler({ query, params, body }, request);
    return dataResponse(result);
  };
}
