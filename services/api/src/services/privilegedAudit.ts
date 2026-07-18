import { query } from "@super-mcp/db";

interface BeginAuditInput {
  apiKeyId: string;
  method: string;
  route: string;
}

interface AuditRow {
  id: string;
}

export async function beginPrivilegedAudit(input: BeginAuditInput): Promise<string> {
  const path = input.route.split("?")[0] ?? input.route;
  const result = await query<AuditRow>(
    `INSERT INTO privileged_audit_event (api_key_id, method, route)
     VALUES ($1,$2,$3)
     RETURNING id`,
    [input.apiKeyId, input.method, path],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Privileged audit insert returned no row");
  return row.id;
}

export async function finalizePrivilegedAudit(
  id: string,
  statusCode: number,
  latencyMs: number,
  errorCode: string | null,
): Promise<void> {
  await query(
    `UPDATE privileged_audit_event
     SET status_code = $2, latency_ms = $3, error_code = $4, completed_at = now()
     WHERE id = $1`,
    [id, statusCode, Math.round(latencyMs), errorCode],
  );
}
