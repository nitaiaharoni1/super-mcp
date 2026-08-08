import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { enabledSurfaces } from "./mcp/surfaces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * How long boot will wait for the embedding model before serving without it.
 * Observed warms are 12-20s on Cloud Run, so this is roughly double the worst
 * seen, and far inside the 240s startup probe.
 */
const WARM_TIMEOUT_MS = 45_000;

async function main(): Promise<void> {
  const app = await buildApp();

  // Load the embedding model before opening the port, not after.
  //
  // Cloud Run throttles an instance's CPU to near zero whenever no request is in
  // flight, so warming in the background after listen() does not finish: measured
  // at 63s of wall clock for ~1-2s of actual work, and it only completed when a
  // real request arrived and handed the container CPU — that request paid 12.4s.
  // Startup is the one window where the instance gets full CPU (plus the
  // startup-cpu-boost the service sets), so the same load costs a couple of
  // seconds and every request afterwards is served warm.
  //
  // A failure here must not stop the server booting: lexical search still works
  // without embeddings, so log it and serve.
  //
  // The deadline covers the case a try/catch cannot: a warm that HANGS rather than
  // throws. @huggingface/transformers ships allowRemoteModels=true, and the model name
  // comes from SUPER_MCP_EMBED_MODEL while the cache is baked by the Dockerfile, so a
  // mismatch between the two makes pipeline() fall through to a live fetch of ~448MB
  // from huggingface.co. On an instance with restricted egress that can outlast Cloud
  // Run's startup probe, and a revision that never opens its port is worse than a slow
  // one. We cannot simply set allowRemoteModels=false: the embedding CLI scripts
  // legitimately download the model on first run. So bound it here, where the cost of
  // waiting is a failed deploy, and let the model load lazily if the deadline wins.
  const warmStartedAt = Date.now();
  try {
    const { warmEmbeddingModel } = await import("./services/search/queryEmbedding.js");
    const warm = warmEmbeddingModel();
    // A rejection arriving after the deadline already won must not go unhandled.
    warm.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        warm,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`embedding warmup exceeded ${WARM_TIMEOUT_MS}ms`)),
            WARM_TIMEOUT_MS,
          );
          timer.unref();
        }),
      ]);
      app.log.info({ ms: Date.now() - warmStartedAt }, "embedding model warm");
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    app.log.warn({ err, ms: Date.now() - warmStartedAt }, "embedding model warmup failed");
  }

  await app.listen({ port: PORT, host: HOST });
  const mcpPaths = enabledSurfaces()
    .map((surface) => surface.path)
    .join(", ");
  app.log.info(`super-mcp API + MCP listening on http://${HOST}:${PORT} (MCP at ${mcpPaths})`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      // Triggers onClose → PostHog flush.
      await app.close();
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
