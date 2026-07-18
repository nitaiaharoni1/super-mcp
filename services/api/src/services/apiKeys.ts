import { randomBytes } from "node:crypto";
import { query, withTransaction } from "@super-mcp/db";
import { AppError } from "@super-mcp/shared";
import { sha256Hex, type ApiKeyRole } from "../auth.js";

export interface CreateApiKeyInput {
  name: string;
  role?: ApiKeyRole;
  rateLimitPerMinute?: number;
  expiresAt?: string | null;
}

export interface ApiKeyMaterial {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

interface CreatedRow {
  id: string;
  created_at: string;
}

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  role: ApiKeyRole;
  rate_limit_per_minute: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by_api_key_id: string | null;
  revoked_by_api_key_id: string | null;
  rotated_from_api_key_id: string | null;
}

interface RotationRow {
  name: string;
  role: ApiKeyRole;
  rate_limit_per_minute: number;
  expires_at: string | null;
}

export function generateApiKeyMaterial(): ApiKeyMaterial {
  const rawKey = `smcp_${randomBytes(24).toString("hex")}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 12),
    keyHash: sha256Hex(rawKey),
  };
}

async function insertApiKey(
  execute: (sql: string, values: unknown[]) => Promise<{ rows: CreatedRow[] }>,
  input: Required<Pick<CreateApiKeyInput, "name" | "role" | "rateLimitPerMinute">> &
    Pick<CreateApiKeyInput, "expiresAt">,
  creatorId: string | null,
  rotatedFromId: string | null,
): Promise<ReturnType<typeof createResult>> {
  const material = generateApiKeyMaterial();
  const result = await execute(
    `INSERT INTO api_key
       (name, key_hash, key_prefix, role, rate_limit_per_minute, expires_at,
        created_by_api_key_id, rotated_from_api_key_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, created_at`,
    [
      input.name,
      material.keyHash,
      material.keyPrefix,
      input.role,
      input.rateLimitPerMinute,
      input.expiresAt ?? null,
      creatorId,
      rotatedFromId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("API key insert returned no row");
  return createResult(row, input, material);
}

function createResult(
  row: CreatedRow,
  input: Required<Pick<CreateApiKeyInput, "name" | "role" | "rateLimitPerMinute">> &
    Pick<CreateApiKeyInput, "expiresAt">,
  material: ApiKeyMaterial,
) {
  return {
    id: row.id,
    name: input.name,
    role: input.role,
    rateLimitPerMinute: input.rateLimitPerMinute,
    expiresAt: input.expiresAt ?? null,
    createdAt: row.created_at,
    keyPrefix: material.keyPrefix,
    apiKey: material.rawKey,
  };
}

export async function createApiKey(input: CreateApiKeyInput, creatorId: string | null) {
  return insertApiKey(
    (sql, values) => query<CreatedRow>(sql, values),
    {
      name: input.name,
      role: input.role ?? "standard",
      rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      expiresAt: input.expiresAt,
    },
    creatorId,
    null,
  );
}

export async function listApiKeys() {
  const result = await query<KeyRow>(
    `SELECT id, name, key_prefix, role, rate_limit_per_minute, created_at, expires_at, revoked_at,
            created_by_api_key_id, revoked_by_api_key_id, rotated_from_api_key_id
     FROM api_key
     ORDER BY created_at DESC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    role: row.role,
    rateLimitPerMinute: row.rate_limit_per_minute,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdByApiKeyId: row.created_by_api_key_id,
    revokedByApiKeyId: row.revoked_by_api_key_id,
    rotatedFromApiKeyId: row.rotated_from_api_key_id,
  }));
}

export async function revokeApiKey(id: string, actorId: string): Promise<void> {
  const result = await query(
    `UPDATE api_key
     SET revoked_at = now(), revoked_by_api_key_id = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [id, actorId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError("not_found", "Active API key not found", 404);
  }
}

export async function rotateApiKey(id: string, actorId: string) {
  return withTransaction(async (client) => {
    const result = await client.query<RotationRow>(
      `WITH target AS (
         SELECT id, name, role, rate_limit_per_minute, expires_at
         FROM api_key
         WHERE id = $1 AND revoked_at IS NULL
         FOR UPDATE
       ), revoked AS (
         UPDATE api_key current
         SET revoked_at = now(), revoked_by_api_key_id = $2
         FROM target
         WHERE current.id = target.id
         RETURNING target.name, target.role, target.rate_limit_per_minute, target.expires_at
       )
       SELECT * FROM revoked`,
      [id, actorId],
    );
    const previous = result.rows[0];
    if (!previous) throw new AppError("not_found", "Active API key not found", 404);
    return insertApiKey(
      (sql, values) => client.query<CreatedRow>(sql, values),
      {
        name: previous.name,
        role: previous.role,
        rateLimitPerMinute: previous.rate_limit_per_minute,
        expiresAt: previous.expires_at,
      },
      actorId,
      id,
    );
  });
}
