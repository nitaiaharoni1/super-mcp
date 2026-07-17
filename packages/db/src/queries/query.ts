import type { QueryResultRow } from "pg";
import { getPool } from "../client/index.js";

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  return getPool().query<T>(sql, params);
}
