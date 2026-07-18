import { describe, expect, it } from "vitest";
import { isTransientIngestionError } from "../src/transient.js";

describe("isTransientIngestionError", () => {
  it.each([
    "fetch failed",
    "The operation was aborted",
    "TimeoutError: signal timed out",
    "connect ECONNREFUSED 10.0.0.1:5432",
    "connect EHOSTUNREACH",
    "sorry, too many clients already",
    "terminating connection due to administrator command",
    "timeout exceeded when trying to connect",
    "ftp pool acquire timeout",
  ])("treats %s as transient", (msg) => {
    expect(isTransientIngestionError(msg)).toBe(true);
  });

  it("still rejects genuine data errors", () => {
    expect(isTransientIngestionError("invalid input syntax for type uuid")).toBe(false);
  });
});
