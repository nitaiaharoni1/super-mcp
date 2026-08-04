/** Machine-checkable basket protocol identity for deployed MCP parity. */
export const BASKET_PROTOCOL_ID = "basket-optimize-fast-v2";

/**
 * The delivery surface's own identity.
 *
 * Deliberately a separate id rather than a suffix on the basket one: the two
 * surfaces version independently, and a canary that accepted either could not
 * tell "the online server is deployed at the wrong revision" from "the online
 * server is not deployed at all".
 */
export const DELIVERY_PROTOCOL_ID = "delivery-optimize-v1";

const DEV_FALLBACK_REVISION = "dev";

/**
 * Immutable build revision for the running process.
 * Prefer CI-injected SUPER_MCP_BUILD_REVISION / GIT_COMMIT_SHA; fall back to "dev".
 */
export function resolveBuildRevision(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv =
    env.SUPER_MCP_BUILD_REVISION?.trim() ||
    env.GIT_COMMIT_SHA?.trim() ||
    env.SOURCE_VERSION?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEV_FALLBACK_REVISION;
}

/** Single machine-parseable line embedded in MCP server instructions. */
export function protocolIdentityLine(
  env: NodeJS.ProcessEnv = process.env,
  protocolId: string = BASKET_PROTOCOL_ID,
): string {
  return `protocol=${protocolId}; build=${resolveBuildRevision(env)}`;
}

export function parseProtocolIdentityLine(
  instructions: string,
): { protocol: string; build: string } | null {
  const match = instructions.match(/protocol=([a-z0-9-]+);\s*build=([^\s]+)/i);
  if (!match?.[1] || !match[2]) return null;
  return { protocol: match[1], build: match[2] };
}

export interface McpToolDescriptor {
  name: string;
  /** JSON Schema-ish shape; we only inspect property keys / required. */
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface ContractCheckInput {
  toolNames: string[];
  tools: McpToolDescriptor[];
  instructions: string;
  expectedBuild?: string | null;
  requireDeployedRevision?: boolean;
}

export interface ContractCheckResult {
  ok: boolean;
  errors: string[];
  identity: { protocol: string; build: string } | null;
}

/**
 * Pure contract validation for the resumable basket MCP surface.
 * Used by the live canary and unit tests (no network).
 */
export function validateMcpBasketContract(input: ContractCheckInput): ContractCheckResult {
  const errors: string[] = [];
  const names = new Set(input.toolNames);

  if (names.has("prepare_basket")) {
    errors.push("legacy tool prepare_basket is still registered");
  }
  if (!names.has("optimize_basket")) {
    errors.push("optimize_basket is missing");
  }
  if (input.toolNames.length > 0 && input.toolNames[0] !== "optimize_basket") {
    errors.push("optimize_basket must be the first registered tool");
  }

  const optimize = input.tools.find((t) => t.name === "optimize_basket");
  const props = optimize?.inputSchema?.properties ?? {};
  if (optimize) {
    if (!("continuation" in props)) {
      errors.push("optimize_basket schema lacks continuation");
    }
    if (!("answers" in props)) {
      errors.push("optimize_basket schema lacks answers");
    }
    if (!("resolution_mode" in props)) {
      errors.push("optimize_basket schema lacks resolution_mode");
    }
    if (!("response_detail" in props)) {
      errors.push("optimize_basket schema lacks response_detail");
    }
    if ("qty" in props) {
      errors.push("optimize_basket schema still accepts deprecated qty");
    }
  }

  const identity = parseProtocolIdentityLine(input.instructions);
  if (!identity) {
    errors.push("server instructions lack protocol=…; build=… identity line");
  } else if (identity.protocol !== BASKET_PROTOCOL_ID) {
    errors.push(
      `unexpected protocol identity ${identity.protocol} (want ${BASKET_PROTOCOL_ID})`,
    );
  }

  const requireDeployed =
    input.requireDeployedRevision === true ||
    process.env.SUPER_MCP_REQUIRE_BUILD_REVISION === "1" ||
    process.env.NODE_ENV === "production";

  if (identity && requireDeployed && identity.build === DEV_FALLBACK_REVISION) {
    errors.push("deployed build revision is missing (still 'dev')");
  }

  if (input.expectedBuild && identity && identity.build !== input.expectedBuild) {
    errors.push(
      `build mismatch: server reports ${identity.build}, expected ${input.expectedBuild}`,
    );
  }

  return { ok: errors.length === 0, errors, identity };
}

/** Pure contract validation for the live online-delivery MCP surface. */
export function validateMcpDeliveryContract(input: ContractCheckInput): ContractCheckResult {
  const errors: string[] = [];
  const names = new Set(input.toolNames);

  if (!names.has("optimize_delivery")) {
    errors.push("optimize_delivery is missing");
  }
  if (names.has("optimize_basket")) {
    errors.push("disabled physical tool optimize_basket is still registered");
  }
  if (input.toolNames.length > 0 && input.toolNames[0] !== "optimize_delivery") {
    errors.push("optimize_delivery must be the first registered tool");
  }

  const optimize = input.tools.find((tool) => tool.name === "optimize_delivery");
  const props = optimize?.inputSchema?.properties ?? {};
  if (optimize) {
    for (const field of ["continuation", "answers", "resolution_mode", "address"]) {
      if (!(field in props)) {
        errors.push(`optimize_delivery schema lacks ${field}`);
      }
    }
    if ("qty" in props) {
      errors.push("optimize_delivery schema still accepts deprecated qty");
    }
  }

  const identity = parseProtocolIdentityLine(input.instructions);
  if (!identity) {
    errors.push("server instructions lack protocol=…; build=… identity line");
  } else if (identity.protocol !== DELIVERY_PROTOCOL_ID) {
    errors.push(
      `unexpected protocol identity ${identity.protocol} (want ${DELIVERY_PROTOCOL_ID})`,
    );
  }

  const requireDeployed =
    input.requireDeployedRevision === true ||
    process.env.SUPER_MCP_REQUIRE_BUILD_REVISION === "1" ||
    process.env.NODE_ENV === "production";

  if (identity && requireDeployed && identity.build === DEV_FALLBACK_REVISION) {
    errors.push("deployed build revision is missing (still 'dev')");
  }

  if (input.expectedBuild && identity && identity.build !== input.expectedBuild) {
    errors.push(
      `build mismatch: server reports ${identity.build}, expected ${input.expectedBuild}`,
    );
  }

  return { ok: errors.length === 0, errors, identity };
}
