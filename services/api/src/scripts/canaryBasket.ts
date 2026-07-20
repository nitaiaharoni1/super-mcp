/**
 * Live canary for resumable optimize_basket against a populated local DB.
 *
 * Usage:
 *   BASKET_CONTINUATION_SECRET=... pnpm --filter @super-mcp/api canary:basket
 *
 * Opt-in auto-resume (safe; does not place orders):
 *   CANARY_BASKET_AUTO_RESUME=1 pnpm --filter @super-mcp/api canary:basket
 *
 * Target branch verification (default: Carrefour Neve Amal):
 *   CANARY_BASKET_STORE_ID=e0099e24-af29-49c0-976d-97e15c398436
 *
 * Free-text location (requires GEOCODING_CACHE_SECRET):
 *   CANARY_BASKET_LOCATION="נווה עמל, הרצליה"
 *
 * Prints phase timings, coverage, quantity decisions, and store names.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closePool } from "@super-mcp/db";
import { resolveLocationInput } from "../lib/locationInput.js";
import { optimizeBasket } from "../services/basket/optimize.js";
import { assertTargetBranchCoverage } from "./canary/assertTargetBranchCoverage.js";
import {
  pickAnswers,
  summarizeComplete,
  summarizeQuestions,
} from "./canary/basketCanaryReport.js";
import { BBQ_ITEMS, DEFAULT_NEVE_AMAL_STORE_ID } from "./canary/bbqBasketFixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function main(): Promise<void> {
  const secret = process.env.BASKET_CONTINUATION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must be set (≥32 bytes)");
  }

  const city = process.env.CANARY_BASKET_CITY ?? "הרצליה";
  // Optional free-text neighborhood/address, or lat,lng anchor:
  //   CANARY_BASKET_LOCATION="נווה עמל, הרצליה"
  //   CANARY_BASKET_NEAR="lat,lng" [CANARY_BASKET_RADIUS_KM]
  const locationText = process.env.CANARY_BASKET_LOCATION?.trim() || undefined;
  const radiusEnv = process.env.CANARY_BASKET_RADIUS_KM;
  const loc = await resolveLocationInput({
    city,
    near: process.env.CANARY_BASKET_NEAR,
    location: locationText,
    radiusKm: radiusEnv != null ? Number(radiusEnv) : undefined,
  });
  const targetStoreId = process.env.CANARY_BASKET_STORE_ID ?? DEFAULT_NEVE_AMAL_STORE_ID;
  const autoResume = process.env.CANARY_BASKET_AUTO_RESUME === "1";

  const started = Date.now();
  const first = await optimizeBasket(
    {
      items: BBQ_ITEMS,
      city: loc.city,
      near: loc.near,
      radiusKm: loc.radiusKm,
      locationOrigin: loc.locationOrigin,
      // All verbose stores so the target branch can be located even when not recommended.
      verbose: true,
      storesLimit: 0,
    },
    { continuationSecret: secret },
  );
  const initialMs = Date.now() - started;

  if (first.status === "needs_confirmation") {
    const answers = autoResume ? pickAnswers(first) : null;
    console.log(
      JSON.stringify(
        {
          event: "canary_basket",
          phase: "initial",
          city: loc.city,
          near: loc.near,
          locationOrigin: loc.locationOrigin,
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
        console.error(`canary slow initial: ${initialMs}ms (budget 5s preferred)`);
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
          city: loc.city,
          near: loc.near,
          locationOrigin: loc.locationOrigin ?? second.location.origin ?? null,
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
      console.error(`canary slow: ${totalMs}ms (budget 10s for complete)`);
    }
    return;
  }

  const targetBranch = assertTargetBranchCoverage(first, targetStoreId);
  console.log(
    JSON.stringify(
      {
        event: "canary_basket",
        phase: "complete",
        city: loc.city,
        near: loc.near,
        locationOrigin: loc.locationOrigin ?? first.location.origin ?? null,
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
    console.error(`canary slow: ${initialMs}ms (budget 10s for complete / 5s preferred for initial)`);
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
