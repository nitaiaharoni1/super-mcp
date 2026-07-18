import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const transactionQuery = vi.fn();

vi.mock("@super-mcp/db", () => ({
  query: (...args: unknown[]) => query(...args),
  withTransaction: (fn: (client: { query: typeof transactionQuery }) => Promise<unknown>) =>
    fn({ query: transactionQuery }),
}));

import {
  createApiKey,
  generateApiKeyMaterial,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} from "../src/services/apiKeys.js";
import { beginPrivilegedAudit, finalizePrivilegedAudit } from "../src/services/privilegedAudit.js";

describe("API key administration", () => {
  beforeEach(() => {
    query.mockReset();
    transactionQuery.mockReset();
  });

  it("generates a prefixed raw key and stores only its hash", () => {
    const material = generateApiKeyMaterial();
    expect(material.rawKey).toMatch(/^smcp_[a-f0-9]{48}$/);
    expect(material.keyPrefix).toBe(material.rawKey.slice(0, 12));
    expect(material.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(material.keyHash).not.toContain(material.rawKey);
  });

  it("creates a key with role, expiry, and creator metadata and returns raw key once", async () => {
    query.mockResolvedValue({ rows: [{ id: "new-id", created_at: "2026-07-17T00:00:00Z" }] });

    const created = await createApiKey(
      { name: "automation", role: "master", expiresAt: "2026-08-01T00:00:00Z", rateLimitPerMinute: 10 },
      "creator-id",
    );

    expect(created.apiKey).toMatch(/^smcp_/);
    expect(query.mock.calls[0]?.[0]).not.toContain(created.apiKey);
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["automation", "master", "2026-08-01T00:00:00Z", "creator-id"]),
    );
  });

  it("lists key metadata without hashes or raw credentials", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "id",
          name: "agent",
          key_prefix: "smcp_1234567",
          role: "standard",
          rate_limit_per_minute: 60,
          created_at: "now",
          expires_at: null,
          revoked_at: null,
          created_by_api_key_id: "creator-id",
          revoked_by_api_key_id: null,
          rotated_from_api_key_id: "old-id",
        },
      ],
    });

    const keys = await listApiKeys();
    expect(keys[0]).toMatchObject({ createdByApiKeyId: "creator-id", rotatedFromApiKeyId: "old-id" });
    expect(keys[0]).not.toHaveProperty("key_hash");
    expect(keys[0]).not.toHaveProperty("apiKey");
  });

  it("revokes a key with actor metadata", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [] });
    await revokeApiKey("target-id", "actor-id");
    expect(query.mock.calls[0]?.[0]).toContain("revoked_by_api_key_id");
    expect(query.mock.calls[0]?.[1]).toEqual(["target-id", "actor-id"]);
  });

  it("rotates atomically by revoking the old key and inserting a successor", async () => {
    transactionQuery
      .mockResolvedValueOnce({
        rows: [{ name: "old", role: "master", rate_limit_per_minute: 5, expires_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: "new-id", created_at: "now" }], rowCount: 1 });

    const rotated = await rotateApiKey("old-id", "actor-id");
    expect(rotated.apiKey).toMatch(/^smcp_/);
    expect(transactionQuery.mock.calls[0]?.[0]).toContain("FOR UPDATE");
    expect(transactionQuery.mock.calls[0]?.[0]).toContain("revoked_at = now()");
    expect(transactionQuery.mock.calls[1]?.[0]).toContain("rotated_from_api_key_id");
  });
});

describe("durable privileged audit", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("inserts a redacted route before execution and finalizes outcome", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "audit-id" }] }).mockResolvedValueOnce({ rows: [] });

    const id = await beginPrivilegedAudit({
      apiKeyId: "master-id",
      method: "POST",
      route: "/v1/admin/keys?api_key=secret&name=x",
    });
    await finalizePrivilegedAudit(id, 201, 12.7, null);

    expect(query.mock.calls[0]?.[1]).toEqual(["master-id", "POST", "/v1/admin/keys"]);
    expect(query.mock.calls[1]?.[1]).toEqual(["audit-id", 201, 13, null]);
    expect(JSON.stringify(query.mock.calls)).not.toContain("secret");
  });

  it("fails closed when the initial audit insert fails", async () => {
    query.mockRejectedValue(new Error("database unavailable"));
    await expect(
      beginPrivilegedAudit({ apiKeyId: "master-id", method: "POST", route: "/mcp?api_key=secret" }),
    ).rejects.toThrow("database unavailable");
  });
});
