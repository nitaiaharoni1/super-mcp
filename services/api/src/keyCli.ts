import type { ApiKeyRole } from "./auth.js";

export interface CreateKeyArgs {
  name: string;
  role: ApiKeyRole;
  rateLimitPerMinute: number;
  expiresAt?: string;
}

export function parseCreateKeyArgs(argv: string[]): CreateKeyArgs {
  const flags: Record<string, string> = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match?.[1]) flags[match[1]] = match[2] ?? "";
  }

  const name = flags.name?.trim();
  if (!name) throw new Error("--name is required");

  const role = flags.role ?? "standard";
  if (role !== "standard" && role !== "master") {
    throw new Error("--role must be standard or master");
  }

  const rateLimitPerMinute = flags["rate-limit-per-minute"]
    ? Number(flags["rate-limit-per-minute"])
    : 60;
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0) {
    throw new Error("--rate-limit-per-minute must be a positive integer");
  }

  const expiresAt = flags["expires-at"];
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("--expires-at must be an ISO timestamp");
  }

  return {
    name,
    role,
    rateLimitPerMinute,
    ...(expiresAt ? { expiresAt } : {}),
  };
}
