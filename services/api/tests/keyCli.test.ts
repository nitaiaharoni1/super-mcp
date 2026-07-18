import { describe, expect, it } from "vitest";
import { parseCreateKeyArgs } from "../src/keyCli.js";

describe("create-key CLI arguments", () => {
  it("accepts role and ISO expiry", () => {
    expect(
      parseCreateKeyArgs([
        "--name=bootstrap",
        "--role=master",
        "--expires-at=2026-08-01T00:00:00Z",
        "--rate-limit-per-minute=25",
      ]),
    ).toEqual({
      name: "bootstrap",
      role: "master",
      expiresAt: "2026-08-01T00:00:00Z",
      rateLimitPerMinute: 25,
    });
  });

  it("rejects unknown roles and invalid expiries", () => {
    expect(() => parseCreateKeyArgs(["--name=x", "--role=owner"])).toThrow(/role/);
    expect(() => parseCreateKeyArgs(["--name=x", "--expires-at=tomorrow"])).toThrow(/expires-at/);
  });
});
