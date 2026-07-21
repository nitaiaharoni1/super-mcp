/**
 * Live canary for optimize_basket against a populated local DB.
 *
 * Fast default (one-call gates — Tel Aviv staples):
 *   CANARY_BASKET_LOCATION="רחוב בן גוריון, תל אביב" \
 *     pnpm --filter @super-mcp/api canary:basket
 *
 * Strict resumable mode (BBQ fixture):
 *   CANARY_BASKET_RESOLUTION_MODE=strict CANARY_BASKET_AUTO_RESUME=1 \
 *     pnpm --filter @super-mcp/api canary:basket
 *
 * Target branch verification for strict (default: Carrefour Neve Amal):
 *   CANARY_BASKET_STORE_ID=e0099e24-af29-49c0-976d-97e15c398436
 *
 * Prints phase timings, coverage, quantity decisions, and store names.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
import { resolveLocationInput } from "../lib/locationInput.js";
import { optimizeBasket } from "../services/basket/optimize.js";
import type {
  BasketItemInput,
  BasketLocationOrigin,
  BasketResolutionMode,
  BasketResponseDetail,
} from "../services/basket/types.js";
import { assertTargetBranchCoverage } from "./canary/assertTargetBranchCoverage.js";
import {
  pickAnswers,
  summarizeComplete,
  summarizeQuestions,
} from "./canary/basketCanaryReport.js";
import { BBQ_ITEMS, DEFAULT_NEVE_AMAL_STORE_ID } from "./canary/bbqBasketFixture.js";
import {
  FORBIDDEN_FAST_SELECTIONS,
  TEL_AVIV_LOCATION,
  TEL_AVIV_STAPLES_ITEMS,
} from "./canary/telAvivStaplesFixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const FAST_ELAPSED_BUDGET_MS = 3000;
const FAST_RESPONSE_BYTES_BUDGET = 15_000;

/** Canary stdout: keep precision/strategy diagnostics, never echo displayName/address. */
function locationOriginForLog(
  origin:
    | Pick<
        BasketLocationOrigin,
        "precision" | "provider" | "cached" | "fallbackApplied" | "attribution"
      > & { warning?: string | null }
    | null
    | undefined,
): Omit<BasketLocationOrigin, "displayName"> | null {
  if (!origin) return null;
  return {
    precision: origin.precision,
    provider: origin.provider,
    cached: origin.cached,
    fallbackApplied: origin.fallbackApplied,
    attribution: origin.attribution,
    warning: origin.warning ?? null,
  };
}

function resolveCanaryMode(): BasketResolutionMode {
  const raw = process.env.CANARY_BASKET_RESOLUTION_MODE?.trim().toLowerCase();
  if (raw === "strict") return "strict";
  return "fast";
}

function assertNoForbiddenSelections(payload: string): void {
  for (const name of FORBIDDEN_FAST_SELECTIONS) {
    if (payload.includes(name)) {
      throw new Error(`canary: forbidden selection present: ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const secret = process.env.BASKET_CONTINUATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must be set (≥32 bytes)");
  }

  const resolutionMode = resolveCanaryMode();
  const responseDetail: BasketResponseDetail =
    resolutionMode === "strict" ? "debug" : "summary";
  // Fast default: Tel Aviv staples + city-fallback location. Strict keeps BBQ + Herzliya.
  const locationText =
    process.env.CANARY_BASKET_LOCATION?.trim() ||
    (resolutionMode === "fast" ? TEL_AVIV_LOCATION : undefined);
  const cityEnv = process.env.CANARY_BASKET_CITY?.trim();
  const city =
    cityEnv ||
    (locationText ? undefined : resolutionMode === "strict" ? "הרצליה" : undefined);
  // Optional lat,lng anchor: CANARY_BASKET_NEAR="lat,lng" [CANARY_BASKET_RADIUS_KM]
  const radiusEnv = process.env.CANARY_BASKET_RADIUS_KM;
  const loc = await resolveLocationInput(
    {
      city,
      near: process.env.CANARY_BASKET_NEAR,
      location: locationText,
      radiusKm: radiusEnv != null ? Number(radiusEnv) : undefined,
    },
    { geocodeStrategy: resolutionMode === "fast" ? "fast" : "precise" },
  );
  const targetStoreId = process.env.CANARY_BASKET_STORE_ID ?? DEFAULT_NEVE_AMAL_STORE_ID;
  const autoResume = process.env.CANARY_BASKET_AUTO_RESUME === "1";
  const items: BasketItemInput[] =
    resolutionMode === "fast" ? TEL_AVIV_STAPLES_ITEMS : BBQ_ITEMS;

  const baseInput = {
    items,
    city: loc.city,
    near: loc.near,
    radiusKm: loc.radiusKm,
    locationOrigin: loc.locationOrigin,
    geocodeMs: loc.geocodeMs,
    // All verbose stores so the target branch can be located even when not recommended.
    verbose: resolutionMode === "strict",
    storesLimit: resolutionMode === "strict" ? 0 : 3,
    resolutionMode,
    responseDetail,
  } as const;

  // Warm-up so cold caches do not fail the fast latency gate.
  await optimizeBasket(baseInput, { continuationSecret: secret });

  const started = Date.now();
  const first = await optimizeBasket(baseInput, { continuationSecret: secret });
  const initialMs = Date.now() - started;
  const firstPayload = JSON.stringify(first);
  const firstBytes = Buffer.byteLength(firstPayload, "utf8");

  if (resolutionMode === "fast") {
    if (first.status !== "complete") {
      throw new Error(`canary fast: expected complete on initial call, got ${first.status}`);
    }
    if (initialMs > FAST_ELAPSED_BUDGET_MS) {
      throw new Error(`canary fast: elapsed ${initialMs}ms > ${FAST_ELAPSED_BUDGET_MS}ms after warm-up`);
    }
    if (firstBytes > FAST_RESPONSE_BYTES_BUDGET) {
      throw new Error(
        `canary fast: response ${firstBytes} bytes > ${FAST_RESPONSE_BYTES_BUDGET} bytes`,
      );
    }
    assertNoForbiddenSelections(firstPayload);

    console.log(
      JSON.stringify(
        {
          event: "canary_basket",
          phase: "complete",
          resolutionMode,
          responseDetail,
          city: loc.city,
          near: loc.near,
          locationOrigin: locationOriginForLog(
            loc.locationOrigin ?? first.location.origin ?? null,
          ),
          locationChars: locationText?.length ?? null,
          geocodeMs: loc.geocodeMs,
          targetStoreId,
          elapsedMs: initialMs,
          responseBytes: firstBytes,
          ...summarizeComplete(first),
        },
        null,
        2,
      ),
    );
    return;
  }

  // Strict path — may pause for confirmation.
  if (first.status === "needs_confirmation") {
    const answers = autoResume ? pickAnswers(first) : null;
    console.log(
      JSON.stringify(
        {
          event: "canary_basket",
          phase: "initial",
          resolutionMode,
          city: loc.city,
          near: loc.near,
          locationOrigin: locationOriginForLog(loc.locationOrigin),
          locationChars: locationText?.length ?? null,
          targetStoreId,
          elapsedMs: initialMs,
          autoResume,
          ...summarizeQuestions(first),
          chosenAnswers: answers,
          hint: autoResume
            ? undefined
            : "Set CANARY_BASKET_AUTO_RESUME=1 to resume with locally priced options; do not reconstruct items.",
        },
        null,
        2,
      ),
    );

    if (!autoResume) {
      if (initialMs > 5_000) {
        throw new Error(`canary strict slow initial: ${initialMs}ms (budget 5s)`);
      }
      return;
    }

    const resumeStarted = Date.now();
    const second = await optimizeBasket(
      {
        continuation: first.continuation,
        answers: answers!,
      },
      { continuationSecret: secret },
    );
    const resumeMs = Date.now() - resumeStarted;
    const totalMs = Date.now() - started;

    if (second.status !== "complete") {
      throw new Error(`canary: expected complete after resume, got ${second.status}`);
    }

    const targetBranch = assertTargetBranchCoverage(second, targetStoreId);
    console.log(
      JSON.stringify(
        {
          event: "canary_basket",
          phase: "complete",
          resolutionMode,
          city: loc.city,
          near: loc.near,
          locationOrigin: locationOriginForLog(
            loc.locationOrigin ?? second.location.origin ?? null,
          ),
          targetStoreId,
          initialMs,
          resumeMs,
          elapsedMs: totalMs,
          chosenAnswers: answers,
          targetBranch,
          ...summarizeComplete(second),
        },
        null,
        2,
      ),
    );

    if (totalMs > 10_000) {
      throw new Error(`canary strict slow: ${totalMs}ms (budget 10s for complete)`);
    }
    return;
  }

  const targetBranch = assertTargetBranchCoverage(first, targetStoreId);
  console.log(
    JSON.stringify(
      {
        event: "canary_basket",
        phase: "complete",
        resolutionMode,
        city: loc.city,
        near: loc.near,
        locationOrigin: locationOriginForLog(
          loc.locationOrigin ?? first.location.origin ?? null,
        ),
        targetStoreId,
        elapsedMs: initialMs,
        targetBranch,
        ...summarizeComplete(first),
      },
      null,
      2,
    ),
  );

  if (initialMs > 10_000) {
    throw new Error(`canary strict slow: ${initialMs}ms (budget 10s for complete)`);
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
