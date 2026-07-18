/** Shared OpenAPI building blocks. */

export const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
    },
  },
};

export const freshnessSchema = {
  type: "object",
  properties: {
    sourceTs: { type: "string", format: "date-time", description: "When the chain published this price." },
    ingestedAt: { type: "string", format: "date-time", description: "When this service last ingested it." },
  },
};

export const apiKeyHeader = {
  BearerAuth: {
    type: "http",
    scheme: "bearer",
    description:
      "API key via Authorization: Bearer <key> (sha256-hashed and matched against api_key.key_hash). " +
      "Query-string ?api_key= is rejected by default and only accepted on /mcp when " +
      "SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1.",
  },
};

export function withData(schema: unknown): { type: "object"; properties: { data: unknown } } {
  return { type: "object", properties: { data: schema } };
}

export const errorResponses = {
  "400": { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
  "401": { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  "404": { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  "429": { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
};
