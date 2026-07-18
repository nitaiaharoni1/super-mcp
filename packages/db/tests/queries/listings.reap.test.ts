import { describe, expect, it, vi } from "vitest";
import { reapReclassifiedListing } from "../../src/queries/listings.js";
import type { PoolClient } from "pg";

function fakeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
}

describe("reapReclassifiedListing guard", () => {
  it("skips when the other key has fewer than 8 digits (not a GTIN flip)", async () => {
    const client = fakeClient();
    await reapReclassifiedListing("chain1", "AB-42", "42", client);
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });

  it("still reaps a genuine classification flip (8+ digit keys)", async () => {
    const client = fakeClient();
    await reapReclassifiedListing("chain1", "7290001234567", "07290001234567", client);
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledTimes(2);
  });
});
