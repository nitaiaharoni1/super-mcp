import { getDatabaseUrl } from "../../src/client/index.js";

export function hasTestDatabase(): boolean {
  try {
    return Boolean(getDatabaseUrl());
  } catch {
    return false;
  }
}
